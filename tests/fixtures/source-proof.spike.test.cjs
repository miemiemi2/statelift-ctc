// Task 2 spike: prove that facts produced by REAL execution on a separate source
// chain can be verified by the CTC-side contracts via real MPT proofs.
//
// If this test fails, the whole "external-chain evidence decides who gets paid"
// claim degrades to hand-authored fixtures and must be relabelled.

const test = require("node:test");
const assert = require("node:assert/strict");
const { keccak256, zeroPadValue, toBeHex } = require("ethers");
const { compile, environment, deploy } = require("../helpers.cjs");
const {
  MOCK_PROVER_SOURCE,
  sourceEnvironment,
  anchorSourceBlock,
  deployTo,
  headerRlp,
} = require("./source-chain.cjs");

const SPIKE_STORAGE = {
  "tests/fixtures/SpikeStorage.sol": {
    content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
/// @notice Minimal source-chain contract used only to produce real storage + logs.
contract SpikeStorage {
    mapping(bytes32 => uint256) public values;
    event Stored(bytes32 indexed key, uint256 value);
    function store(bytes32 key, uint256 value) external {
        values[key] = value;
        emit Stored(key, value);
    }
}`,
  },
};

const SOURCE_CHAIN_ID = 31337;
const CHAIN_KEY = 3;

let compiled;
test.before(() => {
  compiled = compile({ ...MOCK_PROVER_SOURCE, ...SPIKE_STORAGE });
});

async function setup() {
  const source = await sourceEnvironment({ chainId: SOURCE_CHAIN_ID });
  const ctc = await environment();
  const [ctcOwner] = ctc.signers;

  const prover = await deploy(
    compiled["tests/fixtures/MockAttestcoinProver.sol"].MockAttestcoinProver,
    ctcOwner,
    [CHAIN_KEY],
  );
  const headerAnchor = await deploy(
    compiled["contracts/proof/HeaderAnchor.sol"].HeaderAnchor,
    ctcOwner,
  );
  const inbox = await deploy(
    compiled["contracts/proof/RootInbox.sol"].RootInbox,
    ctcOwner,
    [
      await prover.getAddress(),
      CHAIN_KEY,
      SOURCE_CHAIN_ID,
      await headerAnchor.getAddress(),
    ],
  );
  const spv = await deploy(
    compiled["contracts/proof/StateProofVerifier.sol"].StateProofVerifier,
    ctcOwner,
    [await inbox.getAddress()],
  );
  const storage = await deployTo(
    compiled["tests/fixtures/SpikeStorage.sol"].SpikeStorage,
    source.signers[0],
  );
  return {
    source,
    ctc,
    inbox,
    spv,
    storage,
    anchorAddress: await headerAnchor.getAddress(),
    close: () => Promise.all([source.close(), ctc.close()]),
  };
}

test("real source-chain storage is verified on the CTC side through real MPT proofs", async (t) => {
  const s = await setup();
  t.after(s.close);

  const key = keccak256(zeroPadValue(toBeHex(7), 32));
  const receipt = await (await s.storage.store(key, 4242n)).wait();
  const block = await s.source.block(receipt.blockNumber);

  // Header RLP rebuilt from the node must hash to the node-reported block hash.
  assert.equal(keccak256(headerRlp(block)), block.hash);

  const blockHash = await anchorSourceBlock({
    inbox: s.inbox,
    anchorAddress: s.anchorAddress,
    sourceChainId: SOURCE_CHAIN_ID,
    block,
  });
  assert.equal(blockHash, block.hash);

  const anchored = await s.inbox.getHeader(blockHash);
  assert.equal(anchored.receiptsRoot, block.receiptsRoot);
  assert.equal(anchored.stateRoot, block.stateRoot);
  assert.equal(anchored.timestamp, BigInt(block.timestamp));

  // mapping(bytes32 => uint256) values at slot 0
  const slot = keccak256(
    "0x" + key.slice(2) + "00".repeat(32),
  );
  const address = await s.storage.getAddress();
  const proof = await s.source.stateProof(address, [slot], receipt.blockNumber);

  const fact = await s.spv.storageFact(
    blockHash,
    address,
    slot,
    proof.accountProof,
    proof.storageProof[0].proof,
  );
  assert.equal(fact.accountPresent, true);
  assert.equal(fact.slotPresent, true);
  assert.equal(fact.value, 4242n);
  assert.equal(fact.storageRoot, proof.storageHash);
  assert.equal(fact.timestamp, BigInt(block.timestamp));
});

test("real source-chain receipt is verified on the CTC side and its trie root matches the header", async (t) => {
  const s = await setup();
  t.after(s.close);

  const key = keccak256(zeroPadValue(toBeHex(9), 32));
  const receipt = await (await s.storage.store(key, 1n)).wait();
  const block = await s.source.block(receipt.blockNumber);
  const blockHash = await anchorSourceBlock({
    inbox: s.inbox,
    anchorAddress: s.anchorAddress,
    sourceChainId: SOURCE_CHAIN_ID,
    block,
  });

  // receiptProof() itself asserts the rebuilt root equals the header receiptsRoot.
  const rp = await s.source.receiptProof(receipt.blockNumber, receipt.index);
  assert.equal(rp.receiptsRoot, block.receiptsRoot);

  const [raw, timestamp] = await s.spv.receipt(blockHash, receipt.index, rp.proof);
  assert.equal(raw, rp.rawReceipt);
  assert.equal(timestamp, BigInt(block.timestamp));
});

test("a source block that was never anchored cannot be used as a fact source", async (t) => {
  const s = await setup();
  t.after(s.close);

  const key = keccak256(zeroPadValue(toBeHex(11), 32));
  const receipt = await (await s.storage.store(key, 5n)).wait();
  const block = await s.source.block(receipt.blockNumber);
  const address = await s.storage.getAddress();
  const slot = keccak256("0x" + key.slice(2) + "00".repeat(32));
  const proof = await s.source.stateProof(address, [slot], receipt.blockNumber);

  await assert.rejects(
    s.spv.storageFact.staticCall(
      block.hash,
      address,
      slot,
      proof.accountProof,
      proof.storageProof[0].proof,
    ),
  );
});
