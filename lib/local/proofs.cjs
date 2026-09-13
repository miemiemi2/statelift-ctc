// Canonical source-chain proof helpers.
//
// Single source of truth, shared by the test fixtures and the operator CLI. Every
// function here is pure or takes an explicit `call(method, params)` JSON-RPC
// function, so it works identically against an in-process ganache provider and
// against a real RPC endpoint.
//
// Nothing here fabricates chain data: block headers are re-encoded from what the
// node reports (and asserted to hash back to the node's block hash), receipt tries
// are rebuilt from the node's own receipts (and asserted to match the header's
// receiptsRoot), and storage proofs come from eth_getProof.

const {
  AbiCoder,
  encodeRlp,
  getBytes,
  hexlify,
  id,
  keccak256,
  zeroPadValue,
} = require("ethers");
const { Trie } = require("@ethereumjs/trie");

const coder = AbiCoder.defaultAbiCoder();
const ZERO32 = "0x" + "00".repeat(32);
const BLOOM = "0x" + "00".repeat(256);

/// RLP scalar: minimal big-endian, empty string for zero.
const scalar = (hex) => {
  let s = String(hex ?? "0x").slice(2).replace(/^0+/, "");
  if (s.length % 2) s = "0" + s;
  return s.length ? "0x" + s : "0x";
};
const asIs = (hex) => hex ?? "0x";

// Post-merge header field order. Optional trailing fields are included only when
// the node actually reports them, which keeps the re-encoded RLP byte-identical to
// the block hash preimage across hardforks.
const HEADER_FIELDS = [
  ["parentHash", asIs],
  ["sha3Uncles", asIs],
  ["miner", asIs],
  ["stateRoot", asIs],
  ["transactionsRoot", asIs],
  ["receiptsRoot", asIs],
  ["logsBloom", asIs],
  ["difficulty", scalar],
  ["number", scalar],
  ["gasLimit", scalar],
  ["gasUsed", scalar],
  ["timestamp", scalar],
  ["extraData", asIs],
  ["mixHash", asIs],
  ["nonce", asIs],
  ["baseFeePerGas", scalar],
  ["withdrawalsRoot", asIs],
  ["blobGasUsed", scalar],
  ["excessBlobGas", scalar],
  ["parentBeaconBlockRoot", asIs],
  ["requestsHash", asIs],
];

function headerRlp(block) {
  const parts = [];
  for (const [name, enc] of HEADER_FIELDS) {
    if (block[name] === undefined || block[name] === null) continue;
    parts.push(enc(block[name]));
  }
  return encodeRlp(parts);
}

/// Canonical receipt encoding: typed receipts are `type || rlp(body)`.
function encodeReceipt(r) {
  const body = encodeRlp([
    scalar(r.status),
    scalar(r.cumulativeGasUsed),
    r.logsBloom,
    r.logs.map((l) => [l.address, l.topics, l.data === "0x" ? "0x" : l.data]),
  ]);
  const type = Number(r.type ?? "0x0");
  if (type === 0) return body;
  return hexlify(Uint8Array.from([type, ...getBytes(body)]));
}

/// Same index key as StateProofVerifier.indexKey.
const indexKey = (i) => encodeRlp(scalar("0x" + Number(i).toString(16)));

const hexQuantity = (n) => "0x" + Number(n).toString(16);

async function getBlock(call, number) {
  const b = await call("eth_getBlockByNumber", [hexQuantity(number), true]);
  if (!b) throw Error(`no source block ${number}`);
  return b;
}

async function latestBlock(call) {
  return call("eth_getBlockByNumber", ["latest", false]);
}

async function blockTimestamp(call) {
  return Number(BigInt((await latestBlock(call)).timestamp));
}

/// Real account + storage proofs straight out of the node.
async function stateProof(call, address, slots, number) {
  const p = await call("eth_getProof", [address, slots, hexQuantity(number)]);
  return {
    accountProof: p.accountProof,
    storageProof: p.storageProof,
    storageHash: p.storageHash,
    codeHash: p.codeHash,
  };
}

/// Rebuilds the block's receipt trie from the node's own receipts and returns a
/// proof for one index. Throws if the rebuilt root disagrees with the header, so a
/// wrong reconstruction can never be passed off as a valid proof.
async function receiptProof(call, number, transactionIndex) {
  const b = await getBlock(call, number);
  const trie = new Trie({ useKeyHashing: false });
  const raws = [];
  for (const tx of b.transactions) {
    const r = await call("eth_getTransactionReceipt", [tx.hash]);
    const raw = encodeReceipt(r);
    raws[Number(r.transactionIndex)] = raw;
    await trie.put(getBytes(indexKey(r.transactionIndex)), getBytes(raw));
  }
  const root = hexlify(trie.root());
  if (root !== b.receiptsRoot)
    throw Error(
      `rebuilt receiptsRoot ${root} != header ${b.receiptsRoot} (block ${number})`,
    );
  const proof = (
    await trie.createProof(getBytes(indexKey(transactionIndex)))
  ).map(hexlify);
  const endProof = (
    await trie.createProof(getBytes(indexKey(b.transactions.length)))
  ).map(hexlify);
  return {
    proof,
    endProof,
    rawReceipt: raws[transactionIndex],
    receiptCount: b.transactions.length,
    receiptsRoot: root,
  };
}

/// Builds the Attestcoin-style anchor payload RootInbox.accept consumes.
function anchorTxBytes({ anchorAddress, sourceChainId, height, blockHash }) {
  const logs = [
    [
      anchorAddress,
      [
        id("HeaderAnchored(uint256,uint256,bytes32)"),
        zeroPadValue(
          "0x" + BigInt(sourceChainId).toString(16).padStart(2, "0"),
          32,
        ),
        zeroPadValue("0x" + BigInt(height).toString(16).padStart(2, "0"), 32),
      ],
      coder.encode(["bytes32"], [blockHash]),
    ],
  ];
  const receipt = coder.encode(
    ["uint8", "uint64", "tuple(address,bytes32[],bytes)[]", "bytes"],
    [1, 21000, logs, BLOOM],
  );
  return coder.encode(["uint8", "bytes[]"], [2, ["0x", "0x", receipt]]);
}

/// Anchors a real source block header into RootInbox. Refuses to proceed if the
/// re-encoded header does not hash to the block hash the node reported.
async function anchorSourceBlock({
  inbox,
  anchorAddress,
  sourceChainId,
  block,
  overrides = {},
}) {
  const rlp = headerRlp(block);
  const hash = keccak256(rlp);
  if (hash !== block.hash)
    throw Error(
      `header RLP mismatch: computed ${hash}, node reported ${block.hash}`,
    );
  const height = Number(BigInt(block.number));
  const txBytes = anchorTxBytes({
    anchorAddress,
    sourceChainId,
    height,
    blockHash: hash,
  });
  await (
    await inbox.accept(
      height + 1,
      txBytes,
      [ZERO32, []],
      [ZERO32, []],
      rlp,
      overrides,
    )
  ).wait();
  return hash;
}

/// Advances a chain's clock and verifies it actually moved. Deadlines are judged
/// by chain-accepted time, so this must never silently no-op.
async function advanceTime(call, seconds) {
  const before = await blockTimestamp(call);
  await call("evm_increaseTime", [seconds]);
  await call("evm_mine", []);
  const after = await blockTimestamp(call);
  if (after < before + seconds)
    throw Error(`time travel failed: ${before} + ${seconds} -> ${after}`);
  return after;
}

module.exports = {
  ZERO32,
  BLOOM,
  HEADER_FIELDS,
  scalar,
  headerRlp,
  encodeReceipt,
  indexKey,
  hexQuantity,
  getBlock,
  latestBlock,
  blockTimestamp,
  stateProof,
  receiptProof,
  anchorTxBytes,
  anchorSourceBlock,
  advanceTime,
};
