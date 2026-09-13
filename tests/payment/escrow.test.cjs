const test = require("node:test"),
  assert = require("node:assert/strict");
const { AbiCoder, keccak256, toUtf8Bytes, ZeroAddress } = require("ethers");
const { compile, environment, deploy } = require("../helpers.cjs");
const mock = {
  content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
contract MockFacts {struct Fact{bytes32 termsHash;uint8 outcome;uint64 sourceTimestamp;}function verify(bytes calldata e)external pure returns(Fact memory){return abi.decode(e,(Fact));}}`,
};
let compiled;
const coder = AbiCoder.defaultAbiCoder();
const h = (s) => keccak256(toUtf8Bytes(s));
test.before(() => {
  compiled = compile({ "tests/MockFacts.sol": mock });
});
async function setup(automaticRetry = true) {
  const env = await environment();
  const [owner, solver, recipient, prover] = env.signers;
  const verifier = await deploy(
    compiled["tests/MockFacts.sol"].MockFacts,
    owner,
  );
  const escrow = await deploy(
    compiled["contracts/payment/StateLiftEscrow.sol"].StateLiftEscrow,
    owner,
    [await verifier.getAddress()],
  );
  const goal = {
    sourceDomain: h("source"),
    manifestId: h("manifest"),
    token: await prover.getAddress(),
    recipient: await recipient.getAddress(),
    usdcAmount: 100000000n,
    principalCap: 1000n,
    serviceCap: 100n,
    maxAttempts: 3,
    automaticRetry,
  };
  const tx = await (await escrow.createGoal(goal, { value: 1100 })).wait();
  const id = tx.logs
    .map((l) => {
      try {
        return escrow.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((l) => l?.name === "GoalCreated").args.goalId;
  await (await escrow.connect(solver).depositBond({ value: 60 })).wait();
  const q = {
    goalId: id,
    attemptNumber: 1,
    solver: await solver.getAddress(),
    authorizer: await solver.getAddress(),
    validAfter: 10,
    validBefore: 100,
    acceptBefore: 4000000000,
    principal: 700,
    serviceCap: 40,
    proofReward: 10,
    bond: 20,
    nonfulfillmentPenalty: 5,
    solverNonce: 1,
  };
  async function activate(quote = q, actor = owner) {
    const digest = await escrow.quoteDigest(quote);
    const sig = env.wallets[1].signingKey.sign(digest).serialized;
    await (await escrow.connect(actor).activate(quote, sig)).wait();
    return keccak256(
      coder.encode(["bytes32", "uint32"], [id, quote.attemptNumber]),
    );
  }
  async function evidence(aid, outcome, time = 50) {
    const a = await escrow.getAttempt(aid);
    return coder.encode(
      ["tuple(bytes32 termsHash,uint8 outcome,uint64 sourceTimestamp)"],
      [[a.termsHash, outcome, time]],
    );
  }
  return {
    ...env,
    owner,
    solver,
    recipient,
    prover,
    escrow,
    id,
    q,
    goal,
    activate,
    evidence,
  };
}
test("paid principal goes to solver, never Ethereum recipient; one settlement only", async (t) => {
  const s = await setup();
  t.after(s.close);
  const aid = await s.activate();
  const proof = await s.evidence(aid, 1);
  const terms = await import("../../lib/terms.js");
  const order = {
    targetChainId: 1337,
    hub: await s.escrow.getAddress(),
    goalId: s.id,
    owner: await s.owner.getAddress(),
    goal: s.goal,
  };
  const computed = terms.quoteTermsHash(terms.goalContextHash(order), s.q);
  assert.equal(computed, (await s.escrow.getAttempt(aid)).termsHash);
  assert.equal(
    terms.sourceNonce(computed),
    (await s.escrow.getAttempt(aid)).sourceNonce,
  );
  await (await s.escrow.connect(s.prover).resolve(aid, proof)).wait();
  assert.equal(await s.escrow.credits(await s.solver.getAddress()), 700n);
  assert.equal(await s.escrow.credits(await s.recipient.getAddress()), 0n);
  assert.equal(await s.escrow.credits(await s.owner.getAddress()), 390n);
  assert.equal(await s.escrow.credits(await s.prover.getAddress()), 10n);
  assert.equal(await s.escrow.bondAvailable(await s.solver.getAddress()), 60n);
  assert.equal((await s.escrow.getGoal(s.id)).state, 3n);
  await assert.rejects(s.escrow.resolve.staticCall(aid, proof));
  await assert.rejects(
    s.activate({ ...s.q, attemptNumber: 2, solverNonce: 2 }),
  );
  assert.equal(await s.escrow.totalLiability(), 1160n);
});
test("expiry before deadline cannot refund; valid expiry recycles Q without also crediting Q", async (t) => {
  const s = await setup();
  t.after(s.close);
  const aid = await s.activate();
  await assert.rejects(
    s.escrow.resolve.staticCall(aid, await s.evidence(aid, 2, 99)),
  );
  await (
    await s.escrow.connect(s.prover).resolve(aid, await s.evidence(aid, 2, 100))
  ).wait();
  const g = await s.escrow.getGoal(s.id);
  assert.equal(g.state, 1n);
  assert.equal(g.principalAvailable, 1000n);
  assert.equal(g.serviceAvailable, 90n);
  assert.equal(await s.escrow.credits(await s.owner.getAddress()), 5n); // bond penalty only, not refunded Q
  const q2 = {
    ...s.q,
    attemptNumber: 2,
    solverNonce: 2,
    validAfter: 101,
    validBefore: 200,
  };
  const a2 = await s.activate(q2, s.prover);
  assert.notEqual(
    (await s.escrow.getAttempt(aid)).sourceNonce,
    (await s.escrow.getAttempt(a2)).sourceNonce,
  );
  await assert.rejects(
    s.escrow.resolve.staticCall(a2, await s.evidence(aid, 1, 50)),
  );
  await (await s.escrow.resolve(a2, await s.evidence(a2, 1, 150))).wait();
  assert.equal((await s.escrow.getGoal(s.id)).state, 3n);
  assert.equal(await s.escrow.totalLiability(), 1160n);
});
test("bad signatures, concurrent attempt and over-budget quote are rejected", async (t) => {
  const s = await setup();
  t.after(s.close);
  const digest = await s.escrow.quoteDigest(s.q),
    bad = s.wallets[0].signingKey.sign(digest).serialized;
  await assert.rejects(s.escrow.activate.staticCall(s.q, bad));
  await assert.rejects(s.activate({ ...s.q, principal: 1001 }));
  await assert.rejects(
    s.activate({ ...s.q, authorizer: await s.recipient.getAddress() }),
  );
  await s.activate();
  await assert.rejects(
    s.activate({ ...s.q, attemptNumber: 2, solverNonce: 2 }),
  );
});
test("mismatched consumption closes into exception; principal refund cannot be retried", async (t) => {
  const s = await setup();
  t.after(s.close);
  const aid = await s.activate();
  await (
    await s.escrow.connect(s.prover).resolve(aid, await s.evidence(aid, 4))
  ).wait();
  assert.equal((await s.escrow.getGoal(s.id)).state, 5n);
  assert.equal(await s.escrow.credits(await s.owner.getAddress()), 1095n);
  await assert.rejects(
    s.activate({ ...s.q, attemptNumber: 2, solverNonce: 2 }),
  );
  await (await s.escrow.withdraw(await s.owner.getAddress())).wait();
  assert.equal(await s.escrow.totalLiability(), 65n);
});
test("no local timeout action: owner cannot close an active goal, and paid window is strict", async (t) => {
  const s = await setup(false);
  t.after(s.close);
  const aid = await s.activate();
  await s.provider.send("evm_increaseTime", [100000]);
  await s.provider.send("evm_mine", []);
  await assert.rejects(s.escrow.closeReadyGoal.staticCall(s.id));
  await assert.rejects(
    s.escrow.resolve.staticCall(aid, await s.evidence(aid, 1, 100)),
  );
  await (await s.escrow.resolve(aid, await s.evidence(aid, 3, 20))).wait();
  assert.equal((await s.escrow.getGoal(s.id)).state, 4n);
});
