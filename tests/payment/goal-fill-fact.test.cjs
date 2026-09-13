// Task 4: the CTC side learns "which round won, and who the winner is" from an
// anchored source-chain receipt alone — no trusted operator, no off-chain claim.

const test = require("node:test");
const assert = require("node:assert/strict");
const { keccak256, toUtf8Bytes, ZeroAddress } = require("ethers");
const { compileAll, twoChain, AMOUNT, encodeEvidence } = require("../fixtures/two-chain.cjs");

let compiled;
test.before(() => {
  compiled = compileAll();
});

async function setup() {
  const env = await twoChain(compiled);
  await env.fundExecutor(1);
  await env.fundExecutor(2);
  const goal = await env.goalRef({
    escrow: await env.ctc.signers[0].getAddress(),
    owner: await env.ctc.signers[1].getAddress(),
  });
  const now = () => Math.floor(Date.now() / 1000);
  return { ...env, goal, now };
}

test("an anchored fill receipt yields the winning round and winner", async (t) => {
  const s = await setup();
  t.after(s.close);

  const payBy = s.now() + 1800;
  const r = await s.fillAndProve({
    goal: s.goal,
    roundNumber: 1,
    payBy,
    executorIndex: 1,
  });

  const fact = await s.fillVerifier.proveFill(r.evidence);
  assert.equal(fact.goalId, r.goalId);
  assert.equal(fact.roundNumber, 1n);
  assert.equal(fact.winner, r.winner);
  assert.equal(fact.recipient, s.goal.recipient);
  assert.equal(fact.amount, AMOUNT);
  assert.equal(fact.payer, r.payer);
  assert.equal(fact.payBy, BigInt(payBy));
  assert.equal(fact.sourceTimestamp, BigInt(r.block.timestamp));

  // The ABI-encoded entry point used by the escrow returns the same fact.
  const viaBytes = await s.fillVerifier.verifyFill(r.encoded);
  assert.equal(viaBytes.goalId, fact.goalId);
  assert.equal(viaBytes.winner, fact.winner);
  assert.equal(viaBytes.roundNumber, fact.roundNumber);
});

test("the fact reports the round that actually filled, not the round asked about", async (t) => {
  const s = await setup();
  t.after(s.close);

  // Round 4 is the one that really pays.
  const r = await s.fillAndProve({
    goal: s.goal,
    roundNumber: 4,
    payBy: s.now() + 1800,
    executorIndex: 2,
    winnerIndex: 2,
  });
  const fact = await s.fillVerifier.proveFill(r.evidence);
  assert.equal(fact.roundNumber, 4n);
  assert.equal(fact.winner, await s.src.signers[2].getAddress());
});

test("a goal id that was not the one filled does not appear in the fact", async (t) => {
  const s = await setup();
  t.after(s.close);

  const other = await s.goalRef({
    escrow: await s.ctc.signers[0].getAddress(),
    owner: await s.ctc.signers[1].getAddress(),
    businessRef: keccak256(toUtf8Bytes("invoice-2026-9999")),
  });
  const otherId = await s.router.goalIdOf(other);

  const r = await s.fillAndProve({
    goal: s.goal,
    roundNumber: 1,
    payBy: s.now() + 1800,
  });
  const fact = await s.fillVerifier.proveFill(r.evidence);
  assert.notEqual(fact.goalId, otherId);
  assert.equal(fact.goalId, r.goalId);
});

test("an unanchored block cannot produce a fact", async (t) => {
  const s = await setup();
  t.after(s.close);

  const payBy = s.now() + 1800;
  const filled = await s.executeFill({ goal: s.goal, roundNumber: 1, payBy });
  const block = await s.src.block(filled.receipt.blockNumber);
  const rp = await s.src.receiptProof(filled.receipt.blockNumber, filled.receipt.index);

  // Deliberately skipped anchoring.
  await assert.rejects(
    s.fillVerifier.proveFill.staticCall({
      blockHash: block.hash,
      transactionIndex: filled.receipt.index,
      receiptProof: rp.proof,
    }),
  );
});

test("a tampered receipt proof cannot produce a fact", async (t) => {
  const s = await setup();
  t.after(s.close);

  const r = await s.fillAndProve({
    goal: s.goal,
    roundNumber: 1,
    payBy: s.now() + 1800,
  });
  const bad = r.evidence.receiptProof.slice();
  // Flip one byte in the last proof node.
  const last = bad[bad.length - 1];
  bad[bad.length - 1] =
    last.slice(0, last.length - 2) +
    (last.slice(-2) === "ff" ? "fe" : "ff");

  await assert.rejects(
    s.fillVerifier.proveFill.staticCall({
      blockHash: r.blockHash,
      transactionIndex: r.evidence.transactionIndex,
      receiptProof: bad,
    }),
  );
});

test("a receipt from an anchored block with no router fill log is rejected", async (t) => {
  const s = await setup();
  t.after(s.close);

  // A plain token transfer, anchored, but containing no GoalFilled log.
  const tx = await (
    await s.token
      .connect(s.src.signers[1])
      .transfer(await s.src.signers[4].getAddress(), 1n)
  ).wait();
  const packed = await s.anchorAndPack(tx);

  await assert.rejects(s.fillVerifier.proveFill.staticCall(packed.evidence), (e) =>
    /NoFillLog|revert/i.test(e.message),
  );
});

test("the verifier is bound to one router and one inbox", async (t) => {
  const s = await setup();
  t.after(s.close);

  assert.equal(await s.fillVerifier.router(), s.routerAddress);
  assert.equal(await s.fillVerifier.inbox(), await s.inbox.getAddress());
  assert.equal(await s.fillVerifier.sourceDomain(), await s.inbox.sourceDomain());

  // A verifier pointing at a different router must reject this router's facts.
  const { deploy } = require("../helpers.cjs");
  const wrong = await deploy(
    compiled["contracts/payment/GoalFillFactVerifier.sol"].GoalFillFactVerifier,
    s.ctc.signers[0],
    [
      await s.inbox.getAddress(),
      await s.stateVerifier.getAddress(),
      await s.src.signers[4].getAddress(),
      s.routerCodeHash,
    ],
  );
  const r = await s.fillAndProve({
    goal: s.goal,
    roundNumber: 1,
    payBy: s.now() + 1800,
  });
  await assert.rejects(wrong.proveFill.staticCall(r.evidence));
  // ...while the correctly bound verifier accepts it.
  const ok = await s.fillVerifier.proveFill(r.evidence);
  assert.equal(ok.roundNumber, 1n);
});

test("a verifier cannot be constructed with a mismatched state verifier or zero router", async (t) => {
  const s = await setup();
  t.after(s.close);
  const { deploy } = require("../helpers.cjs");
  const artifact =
    compiled["contracts/payment/GoalFillFactVerifier.sol"].GoalFillFactVerifier;

  await assert.rejects(
    deploy(artifact, s.ctc.signers[0], [
      await s.inbox.getAddress(),
      await s.stateVerifier.getAddress(),
      ZeroAddress,
      s.routerCodeHash,
    ]),
  );
  // A zero code hash is refused too: negative proofs would become meaningless.
  await assert.rejects(
    deploy(artifact, s.ctc.signers[0], [
      await s.inbox.getAddress(),
      await s.stateVerifier.getAddress(),
      s.routerAddress,
      "0x" + "00".repeat(32),
    ]),
  );

  // A StateProofVerifier wired to a different inbox must be refused.
  const otherInbox = await deploy(
    compiled["contracts/proof/RootInbox.sol"].RootInbox,
    s.ctc.signers[0],
    [
      await s.prover.getAddress(),
      99,
      s.src.chainId,
      await s.headerAnchor.getAddress(),
    ],
  );
  await assert.rejects(
    deploy(artifact, s.ctc.signers[0], [
      await otherInbox.getAddress(),
      await s.stateVerifier.getAddress(),
      s.routerAddress,
      s.routerCodeHash,
    ]),
  );
});
