// Act A: the ordinary case. The payment happens, the proof arrives before D,
// the winner is paid out of the operator's budget R and the guarantee is released.
//
// This is the round that must NOT cost the guarantor anything: the premium is
// earned, B comes back, and the operator's budget has done its job.

const test = require("node:test");
const assert = require("node:assert/strict");
const { ZeroAddress } = require("ethers");
const {
  compileAll,
  twoChain,
  AMOUNT,
  DEMO_R,
  DEMO_B,
  DEMO_PREMIUM,
} = require("../fixtures/two-chain.cjs");

// Distinct roles on purpose: if the operator and the winning executor share an
// address, "winner paid R" and "operator refunded R" become indistinguishable.
const OWNER = 1;
const EXECUTOR = 2;
const RECIPIENT = 3;
const GUARANTOR = 4;

let compiled;
test.before(() => {
  compiled = compileAll();
});

async function setup() {
  const env = await twoChain(compiled);
  await env.fundExecutor(EXECUTOR);
  await env.fundExecutor(5);
  await env.depositCapital(GUARANTOR, DEMO_B * 3n);
  const g = await env.escrowGoal({ ownerIndex: OWNER, recipientIndex: RECIPIENT });
  return {
    ...env,
    g,
    guarantorAddress: await env.ctc.signers[GUARANTOR].getAddress(),
    ownerAddress: g.ownerAddress,
  };
}

/// The full happy path, used by several assertions below.
async function runActA(s) {
  const { quote, roundId } = await s.openRound({ goalId: s.g.goalId });
  const filled = await s.fillAndProve({
    goal: s.g.ref,
    roundNumber: 1,
    payBy: quote.payBy,
    executorIndex: EXECUTOR,
  });
  return { quote, roundId, filled };
}

test("Act A: proof before D pays the winner from R and releases B", async (t) => {
  const s = await setup();
  t.after(s.close);

  const before = await s.invariant();
  assert.equal(before.available, DEMO_B * 3n);

  const { quote, roundId, filled } = await runActA(s);

  // The recipient really received the payment on the source chain.
  assert.equal(await s.token.balanceOf(s.g.terms.recipient), AMOUNT);

  const opened = await s.invariant();
  assert.equal(opened.held, DEMO_R);
  assert.equal(opened.locked, DEMO_B);
  assert.equal(opened.creditsTotal, DEMO_PREMIUM);

  // Settled by an unrelated third party: neither the operator nor the winner may
  // hold the proof switch.
  const receipt = await s.settle(roundId, filled.encoded, { signerIndex: 0 });

  const round = await s.escrow.getRound(roundId);
  assert.equal(round.state, 2n, "SettledFromPrincipal");
  assert.equal(round.principalReturned, false, "R went to the winner, not back");

  const goal = await s.escrow.getGoal(s.g.goalId);
  assert.equal(goal.state, 2n, "Paid");
  assert.equal(goal.filledRound, 1n);
  assert.equal(goal.winnerPaid, filled.winner);

  // Winner is paid R exactly once; B returns to available capital.
  assert.equal(await s.escrow.credits(filled.winner), DEMO_R);
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), 0n);
  assert.equal(
    await s.escrow.capitalAvailable(s.guarantorAddress),
    DEMO_B * 3n,
    "the guarantee came back untouched",
  );
  // The guarantor keeps only the premium.
  assert.equal(await s.escrow.credits(s.guarantorAddress), DEMO_PREMIUM);
  // The operator gets nothing back: the budget paid for the payment.
  assert.equal(await s.escrow.credits(s.ownerAddress), 0n);

  const after = await s.invariant();
  assert.equal(after.held, 0n);
  assert.equal(after.locked, 0n);
  assert.equal(after.creditsTotal, DEMO_R + DEMO_PREMIUM);

  const settled = receipt.logs
    .map((l) => {
      try {
        return s.escrow.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((l) => l?.name === "RoundSettled");
  assert.ok(settled);
  assert.equal(settled.args.fromGuarantee, false, "settled from R, not from B");
  assert.equal(settled.args.winner, filled.winner);
  assert.equal(settled.args.amount, DEMO_R);
  assert.equal(settled.args.sourceTimestamp, BigInt(filled.block.timestamp));
});

test("Act A: the winner can withdraw exactly once", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { roundId, filled } = await runActA(s);
  await s.settle(roundId, filled.encoded);

  const winnerSigner = s.ctc.signers.find(
    async (x) => (await x.getAddress()) === filled.winner,
  );
  // The winner address is the same on both chains (same mnemonic).
  const onCtc = s.ctc.signers[EXECUTOR];
  assert.equal(await onCtc.getAddress(), filled.winner);

  await (await s.escrow.connect(onCtc).withdraw(filled.winner)).wait();
  assert.equal(await s.escrow.credits(filled.winner), 0n);
  await assert.rejects(
    s.escrow
      .connect(onCtc)
      .withdraw(filled.winner)
      .then((tx) => tx.wait()),
  );
  const inv = await s.invariant();
  assert.equal(inv.creditsTotal, DEMO_PREMIUM);
  assert.ok(winnerSigner !== undefined);
});

test("Act A: the operator cannot claim a refund on a settled round", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { quote, roundId, filled } = await runActA(s);
  await s.settle(roundId, filled.encoded);

  // Even after D has passed, a settled round is not refundable.
  await s.ctcTravel(quote.clearBy - (await s.ctcNow()) + 10);
  await assert.rejects(
    s.escrow
      .connect(s.ctc.signers[OWNER])
      .claimRefund(roundId)
      .then((tx) => tx.wait()),
    (e) => /RoundNotPending|revert/i.test(e.message),
  );
  assert.equal(await s.escrow.credits(s.ownerAddress), 0n);
});

test("Act A: replaying the same success fact does not pay twice", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { roundId, filled } = await runActA(s);
  await s.settle(roundId, filled.encoded);
  assert.equal(await s.escrow.credits(filled.winner), DEMO_R);

  await assert.rejects(
    s.escrow.settleRound(roundId, filled.encoded).then((tx) => tx.wait()),
    (e) => /RoundNotPending|WinnerAlreadyPaid|revert/i.test(e.message),
  );
  assert.equal(await s.escrow.credits(filled.winner), DEMO_R);
  await s.invariant();
});

test("Act A: no further round can open once the goal is paid", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { quote, roundId, filled } = await runActA(s);
  await s.settle(roundId, filled.encoded);

  await s.ctcTravel(quote.payBy - (await s.ctcNow()) + 10);
  await assert.rejects(
    s.openRound({ goalId: s.g.goalId, roundNumber: 2 }),
    (e) => /GoalAlreadyPaid|revert/i.test(e.message),
  );
});

test("Act A: a fact naming a different round cannot settle this round", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { quote, roundId } = await s.openRound({ goalId: s.g.goalId });
  // Executor fills quoting round 2 while the escrow only knows round 1.
  const filled = await s.fillAndProve({
    goal: s.g.ref,
    roundNumber: 2,
    payBy: quote.payBy,
    executorIndex: EXECUTOR,
  });
  await assert.rejects(
    s.escrow.settleRound(roundId, filled.encoded).then((tx) => tx.wait()),
    (e) => /FactRoundMismatch|revert/i.test(e.message),
  );
  const round = await s.escrow.getRound(roundId);
  assert.equal(round.state, 1n, "still Pending");
});

test("Act A: a fill quoting a deadline other than the round's T cannot settle it", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { quote, roundId } = await s.openRound({ goalId: s.g.goalId });
  // Same goal, same round number, but the executor chose their own deadline.
  const filled = await s.fillAndProve({
    goal: s.g.ref,
    roundNumber: 1,
    payBy: quote.payBy + 5000,
    executorIndex: EXECUTOR,
  });
  await assert.rejects(
    s.escrow.settleRound(roundId, filled.encoded).then((tx) => tx.wait()),
    (e) => /FactDeadlineMismatch|revert/i.test(e.message),
  );
  const round = await s.escrow.getRound(roundId);
  assert.equal(round.state, 1n);
});

test("Act A: a fact for a different goal cannot settle this round", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { quote, roundId } = await s.openRound({ goalId: s.g.goalId });

  const otherRef = { ...s.g.ref, businessRef: "0x" + "ab".repeat(32) };
  const filled = await s.fillAndProve({
    goal: otherRef,
    roundNumber: 1,
    payBy: quote.payBy,
    executorIndex: 5,
  });
  await assert.rejects(
    s.escrow.settleRound(roundId, filled.encoded).then((tx) => tx.wait()),
    (e) => /FactGoalMismatch|revert/i.test(e.message),
  );
  const goal = await s.escrow.getGoal(s.g.goalId);
  assert.equal(goal.state, 1n, "still Open");
  assert.equal(goal.winnerPaid, ZeroAddress);
});

test("Act A: settling an unknown round fails", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { quote } = await s.openRound({ goalId: s.g.goalId });
  const filled = await s.fillAndProve({
    goal: s.g.ref,
    roundNumber: 1,
    payBy: quote.payBy,
    executorIndex: EXECUTOR,
  });
  const bogus = await s.escrow.roundIdOf(s.g.goalId, 7);
  await assert.rejects(
    s.escrow.settleRound(bogus, filled.encoded).then((tx) => tx.wait()),
    (e) => /RoundUnknown|revert/i.test(e.message),
  );
});

test("Act A: a proof sitting in the inbox is not settlement by itself", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { quote, roundId } = await s.openRound({ goalId: s.g.goalId });
  const filled = await s.fillAndProve({
    goal: s.g.ref,
    roundNumber: 1,
    payBy: quote.payBy,
    executorIndex: EXECUTOR,
  });

  // The header is anchored and the fact is already provable...
  const fact = await s.fillVerifier.proveFill(filled.evidence);
  assert.equal(fact.roundNumber, 1n);
  // ...yet nothing has moved, and the round is still uncleared.
  const round = await s.escrow.getRound(roundId);
  assert.equal(round.state, 1n, "Pending until settleRound actually runs");
  assert.equal(await s.escrow.credits(filled.winner), 0n);
  const inv = await s.invariant();
  assert.equal(inv.held, DEMO_R);
  assert.equal(inv.locked, DEMO_B);
});
