import {
  keccak256,
  getAddress,
  getBytes,
  hexlify,
  decodeRlp,
  encodeRlp,
  zeroPadValue,
  toBeHex,
} from "ethers";
import { Trie } from "@ethereumjs/trie";

function bytes(value, n) {
  if (
    typeof value !== "string" ||
    !/^0x([0-9a-fA-F]{2})*$/.test(value) ||
    (n !== undefined && getBytes(value).length !== n)
  )
    throw Error("invalid byte encoding");
  return value;
}
function scalar(value) {
  bytes(value);
  if (value !== "0x" && value.slice(2, 4) === "00")
    throw Error("noncanonical integer");
  if (getBytes(value).length > 32) throw Error("oversized integer");
  return value === "0x" ? 0n : BigInt(value);
}
function rlp(value) {
  const decoded = decodeRlp(value);
  if (encodeRlp(decoded).toLowerCase() !== value.toLowerCase())
    throw Error("noncanonical RLP");
  return decoded;
}
export function verifyHeaderRlp(input, expectedHash) {
  const raw = typeof input === "object" ? input.rlp : input;
  const expected =
    typeof input === "object" ? input.expectedHash : expectedHash;
  bytes(raw);
  if (!expected) throw Error("authenticated expected hash required");
  bytes(expected, 32);
  const hash = keccak256(raw);
  if (hash.toLowerCase() !== expected.toLowerCase())
    throw Error("header hash mismatch");
  const f = rlp(raw);
  if (
    !Array.isArray(f) ||
    ![15, 16, 17, 20, 21].includes(f.length) ||
    f.some(Array.isArray)
  )
    throw Error("unsupported Ethereum header schema");
  for (const i of [0, 1, 3, 4, 5, 13]) bytes(f[i], 32);
  bytes(f[2], 20);
  bytes(f[6], 256);
  bytes(f[14], 8);
  if (getBytes(f[12]).length > 32) throw Error("oversized extraData");
  for (const i of [7, 8, 9, 10, 11]) scalar(f[i]);
  if (f.length >= 16) scalar(f[15]);
  if (f.length >= 17) bytes(f[16], 32);
  if (f.length >= 20) {
    scalar(f[17]);
    scalar(f[18]);
    bytes(f[19], 32);
  }
  if (f.length === 21) bytes(f[20], 32);
  return {
    hash,
    fields: f,
    parentHash: f[0],
    stateRoot: f[3],
    transactionsRoot: f[4],
    receiptsRoot: f[5],
    height: scalar(f[8]),
    timestamp: scalar(f[11]),
  };
}
async function verifyTrie(root, key, nodes) {
  bytes(root, 32);
  if (!Array.isArray(nodes)) throw Error("proof array required");
  if (
    nodes.length > 128 ||
    nodes.some((n) => getBytes(bytes(n)).length > 65536)
  )
    throw Error("proof resource bound");
  const trie = new Trie({ useKeyHashing: false });
  return await trie.verifyProof(
    getBytes(root),
    getBytes(key),
    nodes.map((n) => getBytes(n)),
  );
}
export async function verifyAccountProof({ stateRoot, address, proof }) {
  const raw = await verifyTrie(
    stateRoot,
    keccak256(getBytes(getAddress(address))),
    proof,
  );
  if (raw === null) return { exists: false };
  const f = rlp(hexlify(raw));
  if (!Array.isArray(f) || f.length !== 4 || f.some(Array.isArray))
    throw Error("invalid account leaf");
  bytes(f[2], 32);
  bytes(f[3], 32);
  return {
    exists: true,
    nonce: scalar(f[0]),
    balance: scalar(f[1]),
    storageRoot: f[2],
    codeHash: f[3],
  };
}
export async function verifyStorageProof({ storageRoot, slot, proof }) {
  const key =
    typeof slot === "bigint" || typeof slot === "number"
      ? zeroPadValue(toBeHex(slot), 32)
      : zeroPadValue(bytes(slot), 32);
  const raw = await verifyTrie(storageRoot, keccak256(key), proof);
  if (raw === null) return { exists: false, value: 0n };
  const decoded = rlp(hexlify(raw));
  if (Array.isArray(decoded)) throw Error("invalid storage value");
  return { exists: true, value: scalar(decoded) };
}
export async function verifyReceiptProof({ receiptsRoot, index, proof }) {
  const n = BigInt(index);
  if (n < 0n) throw Error("negative receipt index");
  const key = encodeRlp(n === 0n ? "0x" : toBeHex(n));
  const raw = await verifyTrie(receiptsRoot, key, proof);
  if (raw === null) throw Error("receipt absent");
  return hexlify(raw);
}
// Bundle integrity only. On-chain Quote signatures use EIP-712, not this JSON digest.
function canonical(v) {
  if (v === null || typeof v === "string" || typeof v === "boolean")
    return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v))
      throw Error("JSON numbers must be safe integers");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
        .join(",") +
      "}"
    );
  throw Error("unsupported JSON value");
}
export function termsHash(terms) {
  return keccak256(new TextEncoder().encode(canonical(terms)));
}
export { encodeRlp, decodeRlp, keccak256, getAddress, scalar };
