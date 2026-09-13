const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const {
  keccak256,
  hexlify,
  encodeRlp,
  toBeHex,
  decodeRlp,
  zeroPadValue,
} = require("ethers");
const { compile, environment, deploy } = require("../helpers.cjs");
const observed = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../evidence/testnet/usdc-manifest-probe.json"),
    "utf8",
  ),
);
const harness = {
  content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;import {MerklePatricia}from'contracts/proof/MerklePatricia.sol';contract MPTReadHarness{function read(bytes32 root,bytes calldata key,bytes[] calldata nodes)external pure returns(bool,bytes memory){return MerklePatricia.get(root,key,nodes);}}`,
};
test("saved real USDC MPT witnesses agree in Solidity and JS; header bytes match observed block hash", async (t) => {
  const compiled = compile({ "tests/Harness.sol": harness }),
    env = await environment();
  t.after(env.close);
  const verifier = await deploy(
    compiled["tests/Harness.sol"].MPTReadHarness,
    env.signers[0],
  );
  const account = await verifier.read(
    observed.block.stateRoot,
    keccak256(observed.proxy),
    observed.proof.accountProof,
  );
  assert.equal(account[0], true);
  const decoded = decodeRlp(account[1]);
  assert.equal(decoded[2], observed.proof.storageHash);
  assert.equal(decoded[3], observed.proxyCodeHash);
  for (let i = 0; i < observed.proof.storageProof.length; i++) {
    const p = observed.proof.storageProof[i],
      r = await verifier.read(
        observed.proof.storageHash,
        keccak256(zeroPadValue(p.key, 32)),
        p.proof,
      );
    const value = r[0] ? decodeRlp(r[1]) : "0x";
    assert.equal(
      value === "0x" ? 0n : BigInt(value),
      BigInt(observed.values[i].value),
    );
  }
  const b = observed.block,
    s = (v) => (BigInt(v) === 0n ? "0x" : toBeHex(BigInt(v)));
  const fields = [
    b.parentHash,
    b.sha3Uncles,
    b.miner,
    b.stateRoot,
    b.transactionsRoot,
    b.receiptsRoot,
    b.logsBloom,
    s(b.difficulty),
    s(b.number),
    s(b.gasLimit),
    s(b.gasUsed),
    s(b.timestamp),
    b.extraData,
    b.mixHash,
    b.nonce,
  ];
  if (b.baseFeePerGas !== undefined) fields.push(s(b.baseFeePerGas));
  if (b.withdrawalsRoot) fields.push(b.withdrawalsRoot);
  if (b.blobGasUsed !== undefined)
    fields.push(s(b.blobGasUsed), s(b.excessBlobGas), b.parentBeaconBlockRoot);
  if (b.requestsHash) fields.push(b.requestsHash);
  const raw = encodeRlp(fields);
  assert.equal(keccak256(raw), b.hash);
  const js = await import("../../lib/primitives.js");
  const header = js.verifyHeaderRlp(raw, b.hash);
  assert.equal(header.timestamp, BigInt(b.timestamp));
});
