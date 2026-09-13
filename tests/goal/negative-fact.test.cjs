// Task 9: the negative fact — proving the goal was STILL UNFILLED at a source
// block at or after a round's payment deadline T.
//
// Why this matters commercially: without it, a guarantor who underwrote a round
// nobody ever filled has to wait for the clearing deadline before their committed
// capacity comes back. With it, they can reclaim it as soon as T has demonstrably
// passed with no payment. Crucially this does NOT close the goal — nobody was
// paid, so the operator can still relay.

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
  encodeUnfilled,
} = require("../fixtures/two-chain.cjs");

const OWNER = 1;
const EXECUTOR = 2;
const RECIPIENT = 3;
const GUARANTOR = 4;

const PAY_BY_OFFSET = 600;
const CLEAR_BY_OFFSET = 900;

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

const openE = (s, roundNumber) =>
  s.openRound({
    goalId: s.g.goalId,
    roundNumber,
    payByOffset: PAY_BY_OFFSET,
    clearByOffset: CLEAR_BY_OFFSET,
  });

test("an unfilled goal produces a negative fact carrying the source timestamp", async (t) => {
  const s = await setup();
  t.after(s.close);

  const proof = await s.proveUnfilledAt(s.g.goalId, 0);
  const fact = await s.fillVerifier.proveUnfilled(proof.evidence);
  assert.equal(fact.goalId, s.g.goalId);
  assert.equal(fact.sourceTimestamp, BigInt(proof.sourceTimestamp));
  assert.equal(fact.sourceHeight, BigInt(Number(BigInt(proof.block.number))));
});

test("a negative fact is refused once the goal really has been filled", async (t) => {
  const s = await setup();
  t.after(s.close);
  const e1 = await openE(s, 1);
  await s.fillAndProve({
    goal: s.g.ref,
    roundNumber: 1,
    payBy: e1.quote.payBy,
    executorIndex: EXECUTOR,
  });
  assert.equal(await s.token.balanceOf(s.g.terms.recipient), AMOUNT);

  const proof = await s.proveUnfilledAt(s.g.goalId, 0);
  await assert.rejects(
    s.fillVerifier.proveUnfilled.staticCall(proof.evidence),
    (e) => /GoalWasAlreadyFilled|revert/i.test(e.message),
    "the router's storage now says otherwise",
  );
});

test("expiry release frees the guarantee and the budget without closing the goal", async (t) => {
  const s = await setup();
  t.after(s.close);
  const e1 = await openE(s, 1);

  const before = await s.invariant();
  assert.equal(before.held, DEMO_R);
  assert.equal(before.locked, DEMO_B);

  // Prove the goal was still unfilled at a source block past T1.
  const proof = await s.proveUnfilledAt(s.g.goalId, e1.quote.payBy);
  assert.ok(proof.sourceTimestamp >= e1.quote.payBy);

  const receipt = await s.releaseByExpiry(e1.roundId, proof.encoded);

  const round = await s.escrow.getRound(e1.roundId);
  assert.equal(round.state, 5n, "Released");
  assert.equal(round.principalReturned, true);

  // Guarantee capacity is back immediately, without waiting for D.
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), 0n);
  assert.equal(await s.escrow.capitalAvailable(s.guarantorAddress), DEMO_B * 3n);
  // The operator has the budget back, and the guarantor keeps the premium.
  assert.equal(await s.escrow.credits(s.ownerAddress), DEMO_R);
  assert.equal(await s.escrow.credits(s.guarantorAddress), DEMO_PREMIUM);

  // The goal itself is untouched: nobody was paid, so relay is still possible.
  const goal = await s.escrow.getGoal(s.g.goalId);
  assert.equal(goal.state, 1n, "still Open");
  assert.equal(goal.filledRound, 0n);
  assert.equal(goal.winnerPaid, ZeroAddress);

  const released = receipt.logs
    .map((l) => {
      try {
        return s.escrow.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((l) => l?.name === "GuaranteeReleased");
  assert.ok(released);
  assert.equal(released.args.winningRound, 0n, "released by expiry, not by a winner");
  assert.equal(released.args.amount, DEMO_B);

  const after = await s.invariant();
  assert.equal(after.held, 0n);
  assert.equal(after.locked, 0n);
});

test("expiry release before T proves nothing and is refused", async (t) => {
  const s = await setup();
  t.after(s.close);
  const e1 = await openE(s, 1);

  // A source block from before T1: the round could still be filled.
  const proof = await s.proveUnfilledAt(s.g.goalId, 0);
  assert.ok(
    proof.sourceTimestamp < e1.quote.payBy,
    `expected ${proof.sourceTimestamp} < ${e1.quote.payBy}`,
  );

  await assert.rejects(
    s.escrow
      .releaseGuaranteeByExpiry(e1.roundId, proof.encoded)
      .then((tx) => tx.wait()),
    (e) => /RoundCouldStillBeFilled|revert/i.test(e.message),
  );
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), DEMO_B);
  assert.equal(await s.escrow.credits(s.ownerAddress), 0n);
});

test("after expiry release the operator can still relay and win on the same goal", async (t) => {
  const s = await setup();
  t.after(s.close);
  const e1 = await openE(s, 1);

  const proof = await s.proveUnfilledAt(s.g.goalId, e1.quote.payBy);
  await s.releaseByExpiry(e1.roundId, proof.encoded);

  // Relay: round 2 on the same goal, paid and settled normally.
  await s.ctcTravelTo(e1.quote.payBy + 1);
  const e2 = await openE(s, 2);
  const filled2 = await s.fillAndProve({
    goal: s.g.ref,
    roundNumber: 2,
    payBy: e2.quote.payBy,
    executorIndex: EXECUTOR,
  });
  await s.settle(e2.roundId, filled2.encoded);

  assert.equal(await s.token.balanceOf(s.g.terms.recipient), AMOUNT);
  assert.equal(await s.escrow.credits(filled2.winner), DEMO_R);
  const goal = await s.escrow.getGoal(s.g.goalId);
  assert.equal(goal.state, 2n);
  assert.equal(goal.filledRound, 2n);
  // Round 1's budget was returned earlier; the guarantor spent no capital at all.
  assert.equal(await s.escrow.credits(s.ownerAddress), DEMO_R);
  assert.equal(await s.escrow.capitalAvailable(s.guarantorAddress), DEMO_B * 3n);
  await s.invariant();
});

test("a negative fact for another goal cannot release this round", async (t) => {
  const s = await setup();
  t.after(s.close);
  const e1 = await openE(s, 1);
  const proof = await s.proveUnfilledAt(s.g.goalId, e1.quote.payBy);

  const tampered = encodeUnfilled({
    ...proof.evidence,
    goalId: "0x" + "ef".repeat(32),
  });
  await assert.rejects(
    s.escrow
      .releaseGuaranteeByExpiry(e1.roundId, tampered)
      .then((tx) => tx.wait()),
  );
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), DEMO_B);
});

test("a negative fact from an unanchored source block is refused", async (t) => {
  const s = await setup();
  t.after(s.close);
  const e1 = await openE(s, 1);

  await s.srcTravel(PAY_BY_OFFSET + 100);
  const latest = await s.src.rpc.request({
    method: "eth_getBlockByNumber",
    params: ["latest", false],
  });
  const number = Number(BigInt(latest.number));
  const slot = await s.fillVerifier.fillSlot(s.g.goalId);
  const p = await s.src.stateProof(s.routerAddress, [slot], number);

  // Deliberately not anchored.
  await assert.rejects(
    s.fillVerifier.proveUnfilled.staticCall({
      goalId: s.g.goalId,
      blockHash: latest.hash,
      accountProof: p.accountProof,
      slotProof: p.storageProof[0].proof,
    }),
  );
});

test("a negative fact cannot be forged against an address that is not the router", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { deploy } = require("../helpers.cjs");

  // A verifier pinned to the right router address but the wrong code hash must
  // reject: this is the guard against proving "zero slot" on a foreign account.
  const wrong = await deploy(
    compiled["contracts/payment/GoalFillFactVerifier.sol"].GoalFillFactVerifier,
    s.ctc.signers[0],
    [
      await s.inbox.getAddress(),
      await s.stateVerifier.getAddress(),
      s.routerAddress,
      "0x" + "ab".repeat(32),
    ],
  );
  const proof = await s.proveUnfilledAt(s.g.goalId, 0);
  await assert.rejects(
    wrong.proveUnfilled.staticCall(proof.evidence),
    (e) => /RouterCodeMismatch|revert/i.test(e.message),
  );
  // The correctly pinned verifier accepts the same proof.
  const ok = await s.fillVerifier.proveUnfilled(proof.evidence);
  assert.equal(ok.goalId, s.g.goalId);
  assert.notEqual(s.routerCodeHash, "0x" + "ab".repeat(32));
});

test("expiry release also works on an already refunded round", async (t) => {
  const s = await setup();
  t.after(s.close);
  const e1 = await openE(s, 1);

  await s.ctcTravelTo(e1.quote.clearBy + 1);
  await (await s.escrow.claimRefund(e1.roundId)).wait();
  assert.equal((await s.escrow.getRound(e1.roundId)).state, 3n);
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), DEMO_B);

  const proof = await s.proveUnfilledAt(s.g.goalId, e1.quote.payBy);
  await s.releaseByExpiry(e1.roundId, proof.encoded);

  assert.equal((await s.escrow.getRound(e1.roundId)).state, 5n);
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), 0n);
  // R was already returned once and must not be credited a second time.
  assert.equal(await s.escrow.credits(s.ownerAddress), DEMO_R);
  await s.invariant();
});

test("a round retired by an expiry proof lets a replacement open immediately", async (t) => {
  const s = await setup();
  t.after(s.close);
  const e1 = await openE(s, 1);

  const proof = await s.proveUnfilledAt(s.g.goalId, e1.quote.payBy);
  await s.releaseByExpiry(e1.roundId, proof.encoded);

  // The CTC clock has NOT reached T1, but the round is provably retired, so the
  // clock rail must not stand in the operator's way.
  const now = await s.ctcNow();
  assert.ok(
    now < Number(e1.quote.payBy),
    `expected the CTC clock (${now}) to still be before T1 (${e1.quote.payBy})`,
  );
  const e2 = await s.openRound({
    goalId: s.g.goalId,
    roundNumber: 2,
    // The source chain was deliberately pushed past T1 to build the expiry proof,
    // so round 2 needs a window that is still in the future for BOTH clocks.
    payByOffset: 5000,
    clearByOffset: 5000 + 300,
  });
  assert.equal((await s.escrow.getRound(e2.roundId)).state, 1n, "Pending");

  const filled = await s.fillAndProve({
    goal: s.g.ref,
    roundNumber: 2,
    payBy: e2.quote.payBy,
    executorIndex: EXECUTOR,
  });
  await s.settle(e2.roundId, filled.encoded);
  assert.equal(await s.escrow.credits(filled.winner), DEMO_R);
  await s.invariant();
});

test("two expired rounds keep their guarantees independent while the same goal relays", async (t) => {
  const s = await setup();
  t.after(s.close);

  // Each round is retired by its own post-T source absence fact.  The CTC
  // clock need not advance between these operations: expiry is a source fact,
  // and retiring a round is what permits the next relay.
  const e1 = await openE(s, 1);
  const p1 = await s.proveUnfilledAt(s.g.goalId, e1.quote.payBy);
  await s.releaseByExpiry(e1.roundId, p1.encoded);
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), 0n);

  const e2 = await openE(s, 2);
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), DEMO_B);
  const p2 = await s.proveUnfilledAt(s.g.goalId, e2.quote.payBy);
  await s.releaseByExpiry(e2.roundId, p2.encoded);
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), 0n);

  // Both old rounds are released, while G remains open and a third round can
  // still win normally.  No round's B was reused to settle another round.
  const goalBefore = await s.escrow.getGoal(s.g.goalId);
  assert.equal(goalBefore.state, 1n, "goal remains Open after both expiries");
  const e3 = await openE(s, 3);
  const filled3 = await s.fillAndProve({
    goal: s.g.ref,
    roundNumber: 3,
    payBy: e3.quote.payBy,
    executorIndex: EXECUTOR,
  });
  await s.settle(e3.roundId, filled3.encoded);

  assert.equal(await s.token.balanceOf(s.g.terms.recipient), AMOUNT);
  assert.equal(await s.escrow.credits(filled3.winner), DEMO_R);
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), 0n);
  assert.equal(await s.escrow.capitalAvailable(s.guarantorAddress), DEMO_B * 3n);
  assert.equal((await s.escrow.getRound(e1.roundId)).state, 5n);
  assert.equal((await s.escrow.getRound(e2.roundId)).state, 5n);
  assert.equal((await s.escrow.getRound(e3.roundId)).state, 4n, "winner paid");
  await s.invariant();
});

test("a still-live previous round is not retired, so relay still waits", async (t) => {
  const s = await setup();
  t.after(s.close);
  const e1 = await openE(s, 1);
  // No release; the round is merely Pending and its T has not passed.
  await assert.rejects(
    openE(s, 2),
    (e) => /PreviousRoundStillLive|revert/i.test(e.message),
  );
  assert.equal((await s.escrow.getRound(e1.roundId)).state, 1n);
});

test("a released round cannot be released or settled again", async (t) => {
  const s = await setup();
  t.after(s.close);
  const e1 = await openE(s, 1);
  const proof = await s.proveUnfilledAt(s.g.goalId, e1.quote.payBy);
  await s.releaseByExpiry(e1.roundId, proof.encoded);

  await assert.rejects(
    s.escrow
      .releaseGuaranteeByExpiry(e1.roundId, proof.encoded)
      .then((tx) => tx.wait()),
    (e) => /RoundNotPending|revert/i.test(e.message),
  );
  assert.equal(await s.escrow.credits(s.ownerAddress), DEMO_R);
  await s.invariant();
});
