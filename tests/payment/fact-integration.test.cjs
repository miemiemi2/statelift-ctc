const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  AbiCoder,
  keccak256,
  id,
  encodeRlp,
  zeroPadValue,
  toBeHex,
  getBytes,
  hexlify,
} = require("ethers");
const { Trie } = require("@ethereumjs/trie");
const { compile, environment, deploy } = require("../helpers.cjs");
const coder = AbiCoder.defaultAbiCoder(),
  zero = "0x" + "00".repeat(32),
  bloom = "0x" + "00".repeat(256),
  token = "0x" + "11".repeat(20),
  implementation = "0x" + "44".repeat(20);
const mockNative = {
  content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;import {IAttestcoinBlockProver}from'contracts/proof/RootInbox.sol';
contract MockNative{function verify(uint64 k,uint64 height,bytes calldata,IAttestcoinBlockProver.MerkleProof calldata,IAttestcoinBlockProver.ContinuityProof calldata)external pure returns(bool){return k==3&&height==9;}}`,
};
let compiled;
test.before(() => (compiled = compile({ "tests/MockNative.sol": mockNative })));
const proof = async (trie, key) =>
  (await trie.createProof(getBytes(key))).map(hexlify);
async function setup({ expired = false, upgrade = false } = {}) {
  const env = await environment();
  const [owner, solver, recipient, submitter] = env.signers;
  const native = await deploy(
    compiled["tests/MockNative.sol"].MockNative,
    owner,
  );
  const sourceAnchor = await deploy(
    compiled["contracts/proof/HeaderAnchor.sol"].HeaderAnchor,
    owner,
  );
  const inbox = await deploy(
    compiled["contracts/proof/RootInbox.sol"].RootInbox,
    owner,
    [await native.getAddress(), 3, 1, await sourceAnchor.getAddress()],
  );
  const generic = await deploy(
    compiled["contracts/proof/StateProofVerifier.sol"].StateProofVerifier,
    owner,
    [await inbox.getAddress()],
  );
  // Synthetic fixture manifest, deliberately not claimed to be the mainnet USDC layout.
  const manifest = {
    token,
    proxyCodeHash: id("fixture proxy"),
    implementationSlot: id("fixture pointer"),
    implementation,
    implementationCodeHash: id("fixture implementation"),
    authorizationMappingSlot: 7,
  };
  const facts = await deploy(
    compiled["contracts/payment/StateLiftFactVerifier.sol"]
      .StateLiftFactVerifier,
    owner,
    [await inbox.getAddress(), await generic.getAddress(), manifest],
  );
  const escrow = await deploy(
    compiled["contracts/payment/StateLiftEscrow.sol"].StateLiftEscrow,
    owner,
    [await facts.getAddress()],
  );
  const goal = {
    sourceDomain: await inbox.sourceDomain(),
    manifestId: await facts.manifestId(),
    token,
    recipient: await recipient.getAddress(),
    usdcAmount: 100000000n,
    principalCap: 1000n,
    serviceCap: 100n,
    maxAttempts: 3,
    automaticRetry: true,
  };
  const create = await (await escrow.createGoal(goal, { value: 1100 })).wait();
  const goalId = create.logs
    .map((l) => {
      try {
        return escrow.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((x) => x?.name === "GoalCreated").args.goalId;
  await (await escrow.connect(solver).depositBond({ value: 50 })).wait();
  const quote = {
    goalId,
    attemptNumber: 1,
    solver: await solver.getAddress(),
    authorizer: await solver.getAddress(),
    validAfter: 10,
    validBefore: 200,
    acceptBefore: 4000000000,
    principal: 700,
    serviceCap: 40,
    proofReward: 10,
    bond: 20,
    nonfulfillmentPenalty: 5,
    solverNonce: 1,
  };
  const signature = env.wallets[1].signingKey.sign(
    await escrow.quoteDigest(quote),
  ).serialized;
  await (await escrow.activate(quote, signature)).wait();
  const attemptId = keccak256(coder.encode(["bytes32", "uint32"], [goalId, 1]));
  const attempt = await escrow.getAttempt(attemptId);
  const slot = keccak256(
    coder.encode(
      ["bytes32", "bytes32"],
      [
        attempt.sourceNonce,
        keccak256(coder.encode(["address", "uint256"], [quote.authorizer, 7])),
      ],
    ),
  );
  const storage = new Trie({ useKeyHashing: false });
  await storage.put(
    getBytes(keccak256(manifest.implementationSlot)),
    getBytes(encodeRlp(implementation)),
  );
  if (!expired)
    await storage.put(getBytes(keccak256(slot)), getBytes(encodeRlp("0x01")));
  const state = new Trie({ useKeyHashing: false }),
    emptyRoot = hexlify(new Trie().root());
  await state.put(
    getBytes(keccak256(token)),
    getBytes(
      encodeRlp(["0x", "0x", hexlify(storage.root()), manifest.proxyCodeHash]),
    ),
  );
  await state.put(
    getBytes(keccak256(implementation)),
    getBytes(
      encodeRlp(["0x", "0x", emptyRoot, manifest.implementationCodeHash]),
    ),
  );
  const logs = [
    [
      token,
      [
        id("AuthorizationUsed(address,bytes32)"),
        zeroPadValue(quote.authorizer, 32),
        attempt.sourceNonce,
      ],
      "0x",
    ],
    [
      token,
      [
        id("Transfer(address,address,uint256)"),
        zeroPadValue(quote.authorizer, 32),
        zeroPadValue(goal.recipient, 32),
      ],
      coder.encode(["uint256"], [goal.usdcAmount]),
    ],
  ];
  if (upgrade)
    logs.push([
      token,
      [id("Upgraded(address)")],
      coder.encode(["address"], [implementation]),
    ]);
  const receipts = new Trie({ useKeyHashing: false });
  const rawReceipt = encodeRlp(["0x01", "0x5208", bloom, expired ? [] : logs]);
  await receipts.put(getBytes("0x80"), getBytes(rawReceipt));
  const time = expired ? 200 : 100;
  const header = encodeRlp([
    zero,
    zero,
    token,
    hexlify(state.root()),
    zero,
    hexlify(receipts.root()),
    bloom,
    "0x",
    "0x08",
    "0x010000",
    "0x",
    toBeHex(time),
    "0x",
    zero,
    "0x" + "00".repeat(8),
  ]);
  const blockHash = keccak256(header);
  const anchorLogs = [
    [
      await sourceAnchor.getAddress(),
      [
        id("HeaderAnchored(uint256,uint256,bytes32)"),
        zeroPadValue("0x01", 32),
        zeroPadValue("0x08", 32),
      ],
      coder.encode(["bytes32"], [blockHash]),
    ],
  ];
  const rx = coder.encode(
    ["uint8", "uint64", "tuple(address,bytes32[],bytes)[]", "bytes"],
    [1, 21000, anchorLogs, bloom],
  );
  const txBytes = coder.encode(["uint8", "bytes[]"], [2, ["0x", "0x", rx]]);
  await (await inbox.accept(9, txBytes, [zero, []], [zero, []], header)).wait();
  const evidence = {
    hub: await escrow.getAddress(),
    owner: await owner.getAddress(),
    goal,
    quote,
    blockHash,
    tokenAccountProof: await proof(state, keccak256(token)),
    implementationPointerProof: await proof(
      storage,
      keccak256(manifest.implementationSlot),
    ),
    implementationAccountProof: await proof(state, keccak256(implementation)),
    nonceProof: await proof(storage, keccak256(slot)),
    expiredUnused: expired,
    transactionIndex: 0,
    blockReceiptProofs: [await proof(receipts, "0x80")],
    endReceiptProof: await proof(receipts, "0x01"),
  };
  const encode = (e) =>
    facts.interface
      .encodeFunctionData("verifyEvidence", [e])
      .replace(/^0x[0-9a-f]{8}/, "0x");
  return {
    ...env,
    escrow,
    facts,
    inbox,
    generic,
    owner,
    solver,
    submitter,
    goalId,
    attemptId,
    attempt,
    evidence,
    encode,
    signature,
  };
}
test("actual MPT and native receipt policy produce paid fact consumed by native CTC escrow", async (t) => {
  const s = await setup();
  t.after(s.close);
  const f = await s.facts.verify(s.encode(s.evidence));
  assert.equal(f.termsHash, s.attempt.termsHash);
  assert.equal(f.outcome, 1n);
  await (
    await s.escrow
      .connect(s.submitter)
      .resolve(s.attemptId, s.encode(s.evidence))
  ).wait();
  assert.equal(await s.escrow.credits(await s.solver.getAddress()), 700n);
  assert.equal((await s.escrow.getGoal(s.goalId)).state, 3n);
});
test("proven expired unused nonce yields refundable fact; tampered goal does not spend the original budget", async (t) => {
  const s = await setup({ expired: true });
  t.after(s.close);
  const f = await s.facts.verify(s.encode(s.evidence));
  assert.equal(f.outcome, 2n);
  assert.equal(f.termsHash, s.attempt.termsHash);
  const bad = { ...s.evidence, goal: { ...s.evidence.goal, usdcAmount: 1n } };
  await assert.rejects(s.escrow.resolve.staticCall(s.attemptId, s.encode(bad)));
  await (
    await s.escrow
      .connect(s.submitter)
      .resolve(s.attemptId, s.encode(s.evidence))
  ).wait();
  const g = await s.escrow.getGoal(s.goalId);
  assert.equal(g.state, 1n);
  assert.equal(g.principalAvailable, 1000n);
  assert.equal(await s.escrow.credits(await s.owner.getAddress()), 5n);
});
test("known code at block end does not bypass same-block upgrade exclusion", async (t) => {
  const s = await setup({ upgrade: true });
  t.after(s.close);
  await assert.rejects(s.facts.verify(s.encode(s.evidence)));
  assert.equal((await s.escrow.getGoal(s.goalId)).state, 2n);
});
