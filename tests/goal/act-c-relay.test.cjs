// Act C: the executor disappears, and the operator safely hands the same payment
// goal to someone else.
//
// This is the act that no plain refund tool and no plain retry gives you. The
// operator does not have to know whether the old payment happened before deciding
// to relay: the source-chain one-shot gate makes a second payment impossible, so
// "hand it to someone else" can never turn into "pay twice".
//
// Two sub-cases are both real and both covered:
//   C1 the old executor genuinely never paid — the replacement round wins;
//   C2 the old executor HAD paid and the proof was merely late — the replacement
//      round's payment attempt is rejected on the source chain, the late round is
//      settled from its own guarantee, and the replacement round's budget comes
//      back untouched.

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

const OWNER = 1;
const EXECUTOR_1 = 2; // the one who goes missing
const RECIPIENT = 3;
const GUARANTOR = 4;
const EXECUTOR_2 = 5; // the replacement

const PAY_BY_OFFSET = 600;
const CLEAR_BY_OFFSET = 900; // D = T + 300

let compiled;
test.before(() => {
  compiled = compileAll();
});

async function setup() {
  const env = await twoChain(compiled);
  await env.fundExecutor(EXECUTOR_1);
  await env.fundExecutor(EXECUTOR_2);
  await env.depositCapital(GUARANTOR, DEMO_B * 4n);
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

const openE = (s, roundNumber) =>
  s.openRound({
    goalId: s.g.goalId,
    roundNumber,
    payByOffset: PAY_BY_OFFSET,
    clearByOffset: CLEAR_BY_OFFSET,
  });

test("Act C1: executor vanishes, operator recovers R1 and a replacement round completes the goal", async (t) => {
  const s = await setup();
  t.after(s.close);

  // --- Round 1: opened, nobody pays.
  const e1 = await openE(s, 1);
  assert.equal(await s.router.isFilled(s.g.goalId), false);

  // Past D1 the operator recovers the budget; the guarantee stays locked because
  // the CTC side still cannot rule out that a payment happened.
  await s.ctcTravelTo(e1.quote.clearBy + 1);
  await (await s.escrow.claimRefund(e1.roundId)).wait();
  assert.equal(await s.escrow.credits(s.ownerAddress), DEMO_R);
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), DEMO_B);

  // --- Round 2: same goal, new executor, new deadlines and new funding.
  const e2 = await openE(s, 2);
  const round2 = await s.escrow.getRound(e2.roundId);
  assert.equal(round2.roundNumber, 2n);
  assert.equal(round2.principal, DEMO_R);
  assert.equal(round2.guarantee, DEMO_B);
  assert.notEqual(round2.payBy, (await s.escrow.getRound(e1.roundId)).payBy);

  const filled2 = await s.fillAndProve({
    goal: s.g.ref,
    roundNumber: 2,
    payBy: e2.quote.payBy,
    executorIndex: EXECUTOR_2,
  });
  // Exactly one payment reached the recipient, made by the replacement executor.
  assert.equal(await s.token.balanceOf(s.g.terms.recipient), AMOUNT);
  assert.equal(
    filled2.winner,
    await s.src.signers[EXECUTOR_2].getAddress(),
  );

  await s.settle(e2.roundId, filled2.encoded);
  assert.equal((await s.escrow.getRound(e2.roundId)).state, 2n);
  assert.equal(await s.escrow.credits(filled2.winner), DEMO_R);

  const goal = await s.escrow.getGoal(s.g.goalId);
  assert.equal(goal.state, 2n, "Paid");
  assert.equal(goal.filledRound, 2n, "round 2 is the winner");
  assert.equal(goal.winnerPaid, filled2.winner);

  // --- Round 1's guarantee can now be released: round 1 can never win.
  await s.releaseByWinner(e1.roundId, filled2.encoded);
  const round1 = await s.escrow.getRound(e1.roundId);
  assert.equal(round1.state, 5n, "Released");
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), 0n);
  assert.equal(
    await s.escrow.capitalAvailable(s.guarantorAddress),
    DEMO_B * 4n,
    "both guarantees came back; neither round cost the guarantor capital",
  );
  // The guarantor earned both premiums.
  assert.equal(await s.escrow.credits(s.guarantorAddress), DEMO_PREMIUM * 2n);
  // The operator paid for one payment and got the stranded budget back.
  assert.equal(await s.escrow.credits(s.ownerAddress), DEMO_R);

  const inv = await s.invariant();
  assert.equal(inv.held, 0n);
  assert.equal(inv.locked, 0n);
});

test("Act C2: the old payment had happened, so the replacement payment is rejected on the source chain", async (t) => {
  const s = await setup();
  t.after(s.close);

  // Round 1's executor DID pay, but the proof is not settled.
  const e1 = await openE(s, 1);
  const filled1 = await s.fillAndProve({
    goal: s.g.ref,
    roundNumber: 1,
    payBy: e1.quote.payBy,
    executorIndex: EXECUTOR_1,
  });
  assert.equal(await s.token.balanceOf(s.g.terms.recipient), AMOUNT);

  // The operator does not know that, and relays anyway.
  await s.ctcTravelTo(e1.quote.payBy + 1);
  const e2 = await openE(s, 2);

  const executor2Before = await s.token.balanceOf(
    await s.src.signers[EXECUTOR_2].getAddress(),
  );

  // The replacement executor's payment attempt reverts on the source chain and
  // costs them nothing. This is what makes relay safe without any proof.
  await assert.rejects(
    s.executeFill({
      goal: s.g.ref,
      roundNumber: 2,
      payBy: e2.quote.payBy,
      executorIndex: EXECUTOR_2,
    }),
    (e) => /AlreadyFilled|revert/i.test(e.message),
  );
  assert.equal(
    await s.token.balanceOf(
      await s.src.signers[EXECUTOR_2].getAddress(),
    ),
    executor2Before,
    "the replacement executor was not debited",
  );
  assert.equal(
    await s.token.balanceOf(s.g.terms.recipient),
    AMOUNT,
    "still exactly one payment",
  );

  // --- The late round-1 fact settles round 1 from its own guarantee.
  await s.ctcTravelTo(e1.quote.clearBy + 1);
  await (await s.escrow.claimRefund(e1.roundId)).wait();
  await s.settle(e1.roundId, filled1.encoded);

  assert.equal((await s.escrow.getRound(e1.roundId)).state, 4n);
  assert.equal(await s.escrow.credits(filled1.winner), DEMO_R);
  const goal = await s.escrow.getGoal(s.g.goalId);
  assert.equal(goal.filledRound, 1n);
  assert.equal(goal.winnerPaid, filled1.winner);

  // --- Round 2 can never win, so its budget and guarantee come back in full.
  await s.releaseByWinner(e2.roundId, filled1.encoded);
  const round2 = await s.escrow.getRound(e2.roundId);
  assert.equal(round2.state, 5n, "Released");
  assert.equal(round2.principalReturned, true);

  // The operator recovered both budgets; only round 1's guarantee was consumed.
  assert.equal(await s.escrow.credits(s.ownerAddress), DEMO_R * 2n);
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), 0n);
  assert.equal(
    await s.escrow.capitalAvailable(s.guarantorAddress),
    DEMO_B * 3n,
    "exactly one dedicated guarantee was spent",
  );
  assert.equal(await s.escrow.credits(s.guarantorAddress), DEMO_PREMIUM * 2n);
  await s.invariant();
});

test("Act C: a late fact for the old round cannot pay a second winner", async (t) => {
  const s = await setup();
  t.after(s.close);

  // Round 1 paid but unproven; relay opened; round 2 cannot fill.
  const e1 = await openE(s, 1);
  const filled1 = await s.fillAndProve({
    goal: s.g.ref,
    roundNumber: 1,
    payBy: e1.quote.payBy,
    executorIndex: EXECUTOR_1,
  });
  await s.ctcTravelTo(e1.quote.payBy + 1);
  const e2 = await openE(s, 2);

  // Round 1 settles from its guarantee after D1.
  await s.ctcTravelTo(e1.quote.clearBy + 1);
  await s.settle(e1.roundId, filled1.encoded);
  assert.equal(await s.escrow.credits(filled1.winner), DEMO_R);

  // Replaying the same fact against round 2 must not create a second reward.
  await assert.rejects(
    s.escrow
      .settleRound(e2.roundId, filled1.encoded)
      .then((tx) => tx.wait()),
    (e) => /FactRoundMismatch|revert/i.test(e.message),
  );
  // And replaying it against round 1 must not pay again.
  await assert.rejects(
    s.escrow
      .settleRound(e1.roundId, filled1.encoded)
      .then((tx) => tx.wait()),
    (e) => /RoundNotPending|WinnerAlreadyPaid|revert/i.test(e.message),
  );
  assert.equal(await s.escrow.credits(filled1.winner), DEMO_R);

  const goal = await s.escrow.getGoal(s.g.goalId);
  assert.equal(goal.winnerPaid, filled1.winner, "one winner, once");
  await s.invariant();
});

test("Act C: a round cannot release its own guarantee by claiming it lost", async (t) => {
  const s = await setup();
  t.after(s.close);
  const e1 = await openE(s, 1);
  const filled1 = await s.fillAndProve({
    goal: s.g.ref,
    roundNumber: 1,
    payBy: e1.quote.payBy,
    executorIndex: EXECUTOR_1,
  });
  // The fact names round 1, so round 1 still could win: releasing is refused.
  await assert.rejects(
    s.escrow
      .releaseGuaranteeByWinner(e1.roundId, filled1.encoded)
      .then((tx) => tx.wait()),
    (e) => /ThisRoundStillCouldWin|revert/i.test(e.message),
  );
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), DEMO_B);
});

test("Act C: a fact from an unrelated goal cannot release a guarantee", async (t) => {
  const s = await setup();
  t.after(s.close);
  const e1 = await openE(s, 1);

  const otherRef = { ...s.g.ref, businessRef: "0x" + "cd".repeat(32) };
  const otherFilled = await s.fillAndProve({
    goal: otherRef,
    roundNumber: 9,
    payBy: e1.quote.payBy,
    executorIndex: EXECUTOR_2,
  });
  await assert.rejects(
    s.escrow
      .releaseGuaranteeByWinner(e1.roundId, otherFilled.encoded)
      .then((tx) => tx.wait()),
    (e) => /FactGoalMismatch|revert/i.test(e.message),
  );
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), DEMO_B);
  const goal = await s.escrow.getGoal(s.g.goalId);
  assert.equal(goal.state, 1n, "unrelated payments do not close this goal");
  assert.equal(goal.filledRound, 0n);
});

test("Act C: an outsider filling an unregistered round closes the goal without paying anyone", async (t) => {
  const s = await setup();
  t.after(s.close);
  const e1 = await openE(s, 1);

  // Somebody pays the goal at their own expense quoting a round the escrow never
  // registered. The recipient is paid, but no registered round may claim a reward.
  const rogue = await s.fillAndProve({
    goal: s.g.ref,
    roundNumber: 7,
    payBy: e1.quote.payBy,
    executorIndex: EXECUTOR_2,
  });
  assert.equal(await s.token.balanceOf(s.g.terms.recipient), AMOUNT);

  // It cannot settle round 1...
  await assert.rejects(
    s.escrow.settleRound(e1.roundId, rogue.encoded).then((tx) => tx.wait()),
    (e) => /FactRoundMismatch|revert/i.test(e.message),
  );
  // ...but it does prove round 1 can never win, so round 1 unwinds cleanly.
  await s.releaseByWinner(e1.roundId, rogue.encoded);

  const round1 = await s.escrow.getRound(e1.roundId);
  assert.equal(round1.state, 5n, "Released");
  const goal = await s.escrow.getGoal(s.g.goalId);
  assert.equal(goal.state, 2n, "Paid: the goal really is filled on the source chain");
  assert.equal(goal.filledRound, 7n);
  assert.equal(
    goal.winnerPaid,
    ZeroAddress,
    "no reward was paid: the winning round was never registered or funded here",
  );
  // Operator got the budget back; guarantor kept the premium and all capital.
  assert.equal(await s.escrow.credits(s.ownerAddress), DEMO_R);
  assert.equal(await s.escrow.capitalAvailable(s.guarantorAddress), DEMO_B * 4n);
  assert.equal(await s.escrow.credits(s.guarantorAddress), DEMO_PREMIUM);
  await s.invariant();
});

test("Act C: relay is refused while the previous round can still be filled", async (t) => {
  const s = await setup();
  t.after(s.close);
  const e1 = await openE(s, 1);
  // Before T1 the old round is still live on the source chain.
  await assert.rejects(
    openE(s, 2),
    (e) => /PreviousRoundStillLive|revert/i.test(e.message),
  );
  // After T1 relay is allowed, well before D1.
  await s.ctcTravelTo(e1.quote.payBy + 1);
  const e2 = await openE(s, 2);
  assert.equal((await s.escrow.getRound(e2.roundId)).state, 1n);
  // Both rounds are funded simultaneously and accounted separately.
  const inv = await s.invariant();
  assert.equal(inv.held, DEMO_R * 2n);
  assert.equal(inv.locked, DEMO_B * 2n);
  assert.equal(inv.available, DEMO_B * 2n);
});

test("Act C: a third round can follow a second failed relay", async (t) => {
  const s = await setup();
  t.after(s.close);
  const e1 = await openE(s, 1);
  await s.ctcTravelTo(e1.quote.payBy + 1);
  const e2 = await openE(s, 2);
  await s.ctcTravelTo(e2.quote.payBy + 1);
  const e3 = await openE(s, 3);

  const filled3 = await s.fillAndProve({
    goal: s.g.ref,
    roundNumber: 3,
    payBy: e3.quote.payBy,
    executorIndex: EXECUTOR_2,
  });
  await s.settle(e3.roundId, filled3.encoded);

  assert.equal(await s.token.balanceOf(s.g.terms.recipient), AMOUNT);
  assert.equal(await s.escrow.credits(filled3.winner), DEMO_R);

  // The two abandoned rounds unwind with the same winner fact.
  await s.releaseByWinner(e1.roundId, filled3.encoded);
  await s.releaseByWinner(e2.roundId, filled3.encoded);
  assert.equal(await s.escrow.credits(s.ownerAddress), DEMO_R * 2n);
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), 0n);
  assert.equal(await s.escrow.capitalAvailable(s.guarantorAddress), DEMO_B * 4n);
  assert.equal(await s.escrow.credits(s.guarantorAddress), DEMO_PREMIUM * 3n);
  const inv = await s.invariant();
  assert.equal(inv.held, 0n);
});
