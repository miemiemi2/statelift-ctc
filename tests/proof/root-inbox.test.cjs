const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  AbiCoder,
  keccak256,
  toUtf8Bytes,
  encodeRlp,
  toBeHex,
  zeroPadValue,
  hexlify,
  getBytes,
} = require("ethers");
const { Trie } = require("@ethereumjs/trie");
const { compile, environment, deploy } = require("../helpers.cjs");
const coder = AbiCoder.defaultAbiCoder(),
  zero = "0x" + "00".repeat(32),
  bloom = "0x" + "00".repeat(256);
const nativeSource = {
  content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {IAttestcoinBlockProver} from 'contracts/proof/RootInbox.sol';
// Test double only: not cryptographic attestation.
contract MockNative is IAttestcoinBlockProver {bytes32 public expected;function setPayload(bytes calldata b)external{expected=keccak256(b);}function verify(uint64 k,uint64 h,bytes calldata b,MerkleProof calldata,ContinuityProof calldata)external view returns(bool){return k==3&&h==9&&keccak256(b)==expected;}}`,
};
let compiled;
test.before(
  () => (compiled = compile({ "tests/MockNative.sol": nativeSource })),
);
const treeProof = async (t, k) =>
  (await t.createProof(getBytes(k))).map(hexlify);
function header({
  height = 8,
  time = 100,
  parent = zero,
  state = zero,
  receipts = zero,
} = {}) {
  return encodeRlp([
    parent,
    zero,
    "0x" + "11".repeat(20),
    state,
    zero,
    receipts,
    bloom,
    "0x",
    toBeHex(height),
    "0x010000",
    "0x",
    toBeHex(time),
    "0x",
    zero,
    "0x" + "00".repeat(8),
  ]);
}
async function setup() {
  const e = await environment();
  const signer = e.signers[0];
  const anchor = await deploy(
    compiled["contracts/proof/HeaderAnchor.sol"].HeaderAnchor,
    signer,
  );
  const native = await deploy(
    compiled["tests/MockNative.sol"].MockNative,
    signer,
  );
  const inbox = await deploy(
    compiled["contracts/proof/RootInbox.sol"].RootInbox,
    signer,
    [await native.getAddress(), 3, 1, await anchor.getAddress()],
  );
  const verifier = await deploy(
    compiled["contracts/proof/StateProofVerifier.sol"].StateProofVerifier,
    signer,
    [await inbox.getAddress()],
  );
  const merkle = [zero, []],
    continuity = [zero, []];
  async function payload(
    raw,
    { status = 1, emitter, chain = 1, eventHash, height = 8 } = {},
  ) {
    const logs = [
      [
        emitter ?? (await anchor.getAddress()),
        [
          keccak256(toUtf8Bytes("HeaderAnchored(uint256,uint256,bytes32)")),
          zeroPadValue(toBeHex(chain), 32),
          zeroPadValue(toBeHex(height), 32),
        ],
        coder.encode(["bytes32"], [eventHash ?? keccak256(raw)]),
      ],
    ];
    const rx = coder.encode(
      ["uint8", "uint64", "tuple(address,bytes32[],bytes)[]", "bytes"],
      [status, 21000, logs, bloom],
    );
    const encoded = coder.encode(["uint8", "bytes[]"], [2, ["0x", "0x", rx]]);
    await (await native.setPayload(encoded)).wait();
    return encoded;
  }
  const accept = async (raw, opts) => {
    const p = await payload(raw, opts);
    await (await inbox.accept(9, p, merkle, continuity, raw)).wait();
    return keccak256(raw);
  };
  return {
    ...e,
    anchor,
    native,
    inbox,
    verifier,
    merkle,
    continuity,
    payload,
    accept,
  };
}
test("native HeaderAnchor reports actual previous local block hash and rejects unavailable height", async (t) => {
  const e = await setup();
  t.after(e.close);
  const b = await e.provider.send("eth_getBlockByNumber", ["latest", false]);
  const r = await (await e.anchor.anchor(BigInt(b.number))).wait();
  const event = e.anchor.interface.parseLog(r.logs[0]);
  assert.equal(event.args.canonicalBlockHash, b.hash);
  assert.equal(event.args.sourceChainId, 1337n);
  await assert.rejects(e.anchor.anchor.staticCall(1000000000));
});
test("RootInbox requires correct authenticated emitter, status, chain and header hash; parent is linked", async (t) => {
  const e = await setup();
  t.after(e.close);
  const parent = header({ height: 7, time: 99 });
  const raw = header({ parent: keccak256(parent) });
  for (const opts of [
    { status: 0 },
    { emitter: await e.signers[3].getAddress() },
    { chain: 2 },
    { eventHash: zero },
  ]) {
    const p = await e.payload(raw, opts);
    await assert.rejects(
      e.inbox.accept.staticCall(9, p, e.merkle, e.continuity, raw),
    );
  }
  const hash = await e.accept(raw);
  const got = await e.inbox.getHeader(hash);
  assert.equal(got.height, 8n);
  assert.equal(got.timestamp, 100n);
  await (await e.inbox.acceptParent(hash, parent)).wait();
  assert.equal(await e.inbox.canonicalHash(7), keccak256(parent));
  await assert.rejects(
    e.inbox.acceptParent.staticCall(hash, header({ height: 7, time: 98 })),
  );
});
test("EthereumJS generated MPT proves account/storage/receipt and separates nonmembership from missing proof", async (t) => {
  const e = await setup();
  t.after(e.close);
  const account = await e.signers[2].getAddress(),
    slot = zeroPadValue("0x02", 32),
    missing = zeroPadValue("0x03", 32);
  const storage = new Trie({ useKeyHashing: false });
  await storage.put(getBytes(keccak256(slot)), getBytes(encodeRlp("0x03e8")));
  const codeHash = keccak256(toUtf8Bytes("synthetic token runtime"));
  const state = new Trie({ useKeyHashing: false });
  await state.put(
    getBytes(keccak256(account)),
    getBytes(encodeRlp(["0x", "0x", hexlify(storage.root()), codeHash])),
  );
  const receipts = new Trie({ useKeyHashing: false });
  const rawReceipt = encodeRlp(["0x01", "0x5208", bloom, []]);
  await receipts.put(getBytes("0x80"), getBytes(rawReceipt));
  const rawHeader = header({
    state: hexlify(state.root()),
    receipts: hexlify(receipts.root()),
  });
  const blockHash = await e.accept(rawHeader);
  const ap = await treeProof(state, keccak256(account)),
    sp = await treeProof(storage, keccak256(slot));
  const f = await e.verifier.storageFact(blockHash, account, slot, ap, sp);
  assert.equal(f.accountPresent, true);
  assert.equal(f.slotPresent, true);
  assert.equal(f.value, 1000n);
  assert.equal(f.codeHash, codeHash);
  const absent = await e.verifier.storageFact(
    blockHash,
    account,
    missing,
    ap,
    await treeProof(storage, keccak256(missing)),
  );
  assert.equal(absent.slotPresent, false);
  assert.equal(absent.value, 0n);
  await assert.rejects(
    e.verifier.storageFact(blockHash, account, slot, ap, []),
  );
  const other = await e.signers[4].getAddress();
  const absentAccount = await e.verifier.storageFact(
    blockHash,
    other,
    slot,
    await treeProof(state, keccak256(other)),
    [],
  );
  assert.equal(absentAccount.accountPresent, false);
  const rx = await e.verifier.receipt(
    blockHash,
    0,
    await treeProof(receipts, "0x80"),
  );
  assert.equal(rx.raw, rawReceipt);
  const js = await import("../../lib/primitives.js");
  const accountJS = await js.verifyAccountProof({
    stateRoot: hexlify(state.root()),
    address: account,
    proof: ap,
  });
  assert.equal(accountJS.storageRoot, hexlify(storage.root()));
  assert.equal(
    (
      await js.verifyStorageProof({
        storageRoot: hexlify(storage.root()),
        slot,
        proof: sp,
      })
    ).value,
    1000n,
  );
});
