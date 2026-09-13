// Act B: the payment really happened, but the proof did not clear before D.
//
// This is the act the operator is buying. At D the budget goes back to the
// operator by chain-accepted time, and when the late proof finally lands, the
// winner is paid out of that round's dedicated guarantee capital instead. The
// recipient is still paid exactly once.
//
// The load-bearing test here is the anti-front-run one: the late proof must draw
// on B even when the operator has NOT yet called claimRefund. Otherwise an
// executor could simply wait past D and race the operator for R.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  compileAll,
  twoChain,
  AMOUNT,
  DEMO_R,
  DEMO_B,
  DEMO_PREMIUM,
} = require("../fixtures/two-chain.cjs");

const OWNER = 1;
const EXECUTOR = 2;
const RECIPIENT = 3;
const GUARANTOR = 4;
const THIRD_PARTY = 0;

// A wide clearing window so tests can sit on either side of D deliberately.
const PAY_BY_OFFSET = 600;
const CLEAR_BY_OFFSET = 900; // D = T + 300

let compiled;
test.before(() => {
  compiled = compileAll();
});

async function setup() {
  const env = await twoChain(compiled);
  await env.fundExecutor(EXECUTOR);
  await env.depositCapital(GUARANTOR, DEMO_B * 3n);
  const g = await env.escrowGoal({
    ownerIndex: OWNER,
    recipientIndex: RECIPIENT,
  });
  return {
    ...env,
    g,
    guarantorAddress: await env.ctc.signers[GUARANTOR].getAddress(),
    ownerAddress: g.ownerAddress,
  };
}

/// Pays on the source chain inside T, anchors the proof, but does not settle.
async function payButDoNotClear(s) {
  const { quote, roundId } = await s.openRound({
    goalId: s.g.goalId,
    payByOffset: PAY_BY_OFFSET,
    clearByOffset: CLEAR_BY_OFFSET,
  });
  const filled = await s.fillAndProve({
    goal: s.g.ref,
    roundNumber: 1,
    payBy: quote.payBy,
    executorIndex: EXECUTOR,
  });
  // The recipient has genuinely been paid on the source chain.
  assert.equal(await s.token.balanceOf(s.g.terms.recipient), AMOUNT);
  return { quote, roundId, filled };
}

test("Act B: at D the operator recovers R while the guarantee stays liable", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { quote, roundId } = await payButDoNotClear(s);

  await assert.rejects(
    s.escrow
      .connect(s.ctc.signers[OWNER])
      .claimRefund(roundId)
      .then((tx) => tx.wait()),
    (e) => /NotYetClearingDeadline|revert/i.test(e.message),
    "the budget is not recoverable before D",
  );

  await s.ctcTravelTo(quote.clearBy + 1);
  await (
    await s.escrow.connect(s.ctc.signers[THIRD_PARTY]).claimRefund(roundId)
  ).wait();

  const round = await s.escrow.getRound(roundId);
  assert.equal(round.state, 3n, "Refunded");
  assert.equal(round.principalReturned, true);

  // R is the operator's; B has NOT been released — it still answers for the
  // payment that may already have happened.
  assert.equal(await s.escrow.credits(s.ownerAddress), DEMO_R);
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), DEMO_B);
  assert.equal(await s.escrow.capitalAvailable(s.guarantorAddress), DEMO_B * 2n);

  const inv = await s.invariant();
  assert.equal(inv.held, 0n, "no round principal is escrowed any more");
  assert.equal(inv.locked, DEMO_B);

  // The goal is not marked paid: the CTC side genuinely does not know yet.
  const goal = await s.escrow.getGoal(s.g.goalId);
  assert.equal(goal.state, 1n, "Open");
  assert.equal(goal.filledRound, 0n);
});

test("Act B: a late proof pays the winner from B and never touches the returned R", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { quote, roundId, filled } = await payButDoNotClear(s);

  await s.ctcTravelTo(quote.clearBy + 1);
  await (await s.escrow.claimRefund(roundId)).wait();
  assert.equal(await s.escrow.credits(s.ownerAddress), DEMO_R);

  const receipt = await s.settle(roundId, filled.encoded, {
    signerIndex: GUARANTOR,
  });

  const round = await s.escrow.getRound(roundId);
  assert.equal(round.state, 4n, "SettledFromGuarantee");

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
  assert.equal(settled.args.fromGuarantee, true, "the guarantee paid, not R");
  assert.equal(settled.args.winner, filled.winner);
  assert.equal(settled.args.amount, DEMO_R);

  // The operator keeps the recovered budget: exactly R, not more, not less.
  assert.equal(await s.escrow.credits(s.ownerAddress), DEMO_R);
  // The winner is made whole out of the guarantee.
  assert.equal(await s.escrow.credits(filled.winner), DEMO_R);
  // B == R here, so the entire dedicated guarantee was consumed.
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), 0n);
  assert.equal(
    await s.escrow.capitalAvailable(s.guarantorAddress),
    DEMO_B * 2n,
    "none of the dedicated guarantee came back",
  );
  // The guarantor's worst case, realised: they keep the premium and lose R.
  assert.equal(await s.escrow.credits(s.guarantorAddress), DEMO_PREMIUM);

  const goal = await s.escrow.getGoal(s.g.goalId);
  assert.equal(goal.state, 2n, "Paid");
  assert.equal(goal.winnerPaid, filled.winner);
  // Still exactly one payment on the source chain.
  assert.equal(await s.token.balanceOf(s.g.terms.recipient), AMOUNT);
  await s.invariant();
});

test("Act B anti-front-run: a late proof draws on B even if the operator never claimed", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { quote, roundId, filled } = await payButDoNotClear(s);

  await s.ctcTravelTo(quote.clearBy + 1);
  // Deliberately NO claimRefund. The executor settles first, trying to reach R.
  const round0 = await s.escrow.getRound(roundId);
  assert.equal(round0.state, 1n, "still Pending, nothing claimed");

  await s.settle(roundId, filled.encoded, { signerIndex: EXECUTOR });

  const round = await s.escrow.getRound(roundId);
  assert.equal(round.state, 4n, "SettledFromGuarantee");
  assert.equal(round.principalReturned, true, "R was routed to the operator");

  // Ownership of R was fixed at D, not by who transacted first.
  assert.equal(await s.escrow.credits(s.ownerAddress), DEMO_R);
  assert.equal(await s.escrow.credits(filled.winner), DEMO_R);
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), 0n);
  assert.equal(await s.escrow.capitalAvailable(s.guarantorAddress), DEMO_B * 2n);
  await s.invariant();
});

test("Act B boundary: settling just before D uses R and releases B", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { quote, roundId, filled } = await payButDoNotClear(s);

  // Land clearly inside the window but close to D.
  await s.ctcTravelTo(quote.clearBy - 30);
  const before = await s.ctcNow();
  assert.ok(before < quote.clearBy, `expected ${before} < ${quote.clearBy}`);

  await s.settle(roundId, filled.encoded);

  const round = await s.escrow.getRound(roundId);
  assert.equal(round.state, 2n, "SettledFromPrincipal");
  assert.equal(await s.escrow.credits(filled.winner), DEMO_R);
  assert.equal(await s.escrow.credits(s.ownerAddress), 0n);
  assert.equal(await s.escrow.capitalAvailable(s.guarantorAddress), DEMO_B * 3n);
});

test("Act B boundary: settling once D has been reached uses B", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { quote, roundId, filled } = await payButDoNotClear(s);

  await s.ctcTravelTo(quote.clearBy);
  const at = await s.ctcNow();
  assert.ok(at >= quote.clearBy, `expected ${at} >= ${quote.clearBy}`);

  await s.settle(roundId, filled.encoded);

  const round = await s.escrow.getRound(roundId);
  assert.equal(round.state, 4n, "SettledFromGuarantee at D itself");
  assert.equal(await s.escrow.credits(s.ownerAddress), DEMO_R);
  assert.equal(await s.escrow.credits(filled.winner), DEMO_R);
  assert.equal(await s.escrow.capitalAvailable(s.guarantorAddress), DEMO_B * 2n);
});

test("Act B: the refund cannot be claimed twice and the winner cannot be paid twice", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { quote, roundId, filled } = await payButDoNotClear(s);

  await s.ctcTravelTo(quote.clearBy + 1);
  await (await s.escrow.claimRefund(roundId)).wait();
  await assert.rejects(
    s.escrow.claimRefund(roundId).then((tx) => tx.wait()),
    (e) => /RoundNotPending|revert/i.test(e.message),
  );
  assert.equal(await s.escrow.credits(s.ownerAddress), DEMO_R);

  await s.settle(roundId, filled.encoded);
  assert.equal(await s.escrow.credits(filled.winner), DEMO_R);

  await assert.rejects(
    s.escrow.settleRound(roundId, filled.encoded).then((tx) => tx.wait()),
    (e) => /RoundNotPending|WinnerAlreadyPaid|revert/i.test(e.message),
  );
  assert.equal(await s.escrow.credits(filled.winner), DEMO_R);
  await s.invariant();
});

test("Act B: after a late settlement the goal is closed to new rounds", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { quote, roundId, filled } = await payButDoNotClear(s);
  await s.ctcTravelTo(quote.clearBy + 1);
  await s.settle(roundId, filled.encoded);

  await assert.rejects(
    s.openRound({
      goalId: s.g.goalId,
      roundNumber: 2,
      payByOffset: PAY_BY_OFFSET,
      clearByOffset: CLEAR_BY_OFFSET,
    }),
    (e) => /GoalAlreadyPaid|revert/i.test(e.message),
  );
});

test("Act B: everyone can withdraw their own side of the outcome", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { quote, roundId, filled } = await payButDoNotClear(s);
  await s.ctcTravelTo(quote.clearBy + 1);
  await (await s.escrow.claimRefund(roundId)).wait();
  await s.settle(roundId, filled.encoded);

  // Operator withdraws the recovered budget.
  await (
    await s.escrow.connect(s.ctc.signers[OWNER]).withdraw(s.ownerAddress)
  ).wait();
  // Winner withdraws the guarantee payout.
  await (
    await s.escrow.connect(s.ctc.signers[EXECUTOR]).withdraw(filled.winner)
  ).wait();
  // Guarantor withdraws the premium, and the capital that was never committed.
  await (
    await s.escrow
      .connect(s.ctc.signers[GUARANTOR])
      .withdrawCapital(DEMO_B * 2n)
  ).wait();
  await (
    await s.escrow
      .connect(s.ctc.signers[GUARANTOR])
      .withdraw(s.guarantorAddress)
  ).wait();

  const inv = await s.invariant();
  assert.equal(inv.balance, 0n, "the escrow is fully drained and consistent");
  assert.equal(inv.held, 0n);
  assert.equal(inv.locked, 0n);
  assert.equal(inv.available, 0n);
  assert.equal(inv.creditsTotal, 0n);
});
