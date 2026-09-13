import {
  id,
  getAddress,
  getBytes,
  decodeRlp,
  encodeRlp,
  AbiCoder,
  zeroPadValue,
} from "ethers";
const USED = id("AuthorizationUsed(address,bytes32)"),
  CANCELED = id("AuthorizationCanceled(address,bytes32)"),
  TRANSFER = id("Transfer(address,address,uint256)");
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const addressTopic = (a) => zeroPadValue(getAddress(a), 32).toLowerCase();
export function decodeReceipt(raw) {
  let type = 0,
    body = raw;
  const b = getBytes(raw);
  if (!b.length) throw Error("empty receipt");
  if (b[0] < 0x80) {
    type = b[0];
    if (type < 1 || type > 4) throw Error("unsupported receipt type");
    body = "0x" + Buffer.from(b.slice(1)).toString("hex");
  }
  const f = decodeRlp(body);
  if (
    !Array.isArray(f) ||
    f.length !== 4 ||
    encodeRlp(f).toLowerCase() !== body.toLowerCase()
  )
    throw Error("invalid receipt");
  if (f[0] !== "0x" && f[0] !== "0x01")
    throw Error("pre-status or invalid receipt");
  if (getBytes(f[2]).length !== 256 || !Array.isArray(f[3]))
    throw Error("invalid receipt fields");
  const logs = f[3].map((l) => {
    if (
      !Array.isArray(l) ||
      l.length !== 3 ||
      getBytes(l[0]).length !== 20 ||
      !Array.isArray(l[1]) ||
      l[1].some((t) => getBytes(t).length !== 32)
    )
      throw Error("invalid log");
    return { address: getAddress(l[0]), topics: l[1], data: l[2] };
  });
  return { type, status: f[0] === "0x01" ? 1 : 0, logs };
}
// Only call after receipt authentication and execution-version policy validation.
// Circle EIP3009 emits AuthorizationUsed immediately before its paired Transfer.
export function classifyReceipt({
  receipt,
  logs = receipt?.logs,
  terms,
  sourceTimestamp,
}) {
  if (!receipt || receipt.status !== 1 || !Array.isArray(logs))
    return "unknown";
  const t = sourceTimestamp ?? receipt.timestamp;
  if (t === undefined) return "unknown";
  const token = getAddress(terms.token),
    authorizer = getAddress(terms.authorizer),
    recipient = getAddress(terms.recipient);
  if (
    same(recipient, authorizer) ||
    same(recipient, token) ||
    same(recipient, "0x0000000000000000000000000000000000000000")
  )
    return "unknown";
  if (!/^0x[0-9a-fA-F]{64}$/.test(terms.nonce)) return "unknown";
  const relevant = [];
  for (let i = 0; i < logs.length; i++) {
    const l = logs[i];
    if (
      same(l.address, token) &&
      l.topics?.length === 3 &&
      same(l.topics[1], addressTopic(authorizer)) &&
      same(l.topics[2], terms.nonce) &&
      (same(l.topics[0], USED) || same(l.topics[0], CANCELED))
    )
      relevant.push(i);
  }
  if (relevant.length !== 1) return "unknown";
  const at = relevant[0],
    used = logs[at];
  if (used.data !== "0x") return "unknown";
  if (same(used.topics[0], CANCELED)) return "cancelled";
  const transfer = logs[at + 1];
  if (
    !transfer ||
    !same(transfer.address, token) ||
    transfer.topics?.length !== 3 ||
    !same(transfer.topics[0], TRANSFER) ||
    !same(transfer.topics[1], addressTopic(authorizer)) ||
    getBytes(transfer.data).length !== 32
  )
    return "unknown";
  const amount = AbiCoder.defaultAbiCoder().decode(
    ["uint256"],
    transfer.data,
  )[0];
  const valid =
    BigInt(t) > BigInt(terms.validAfter) &&
    BigInt(t) < BigInt(terms.validBefore) &&
    same(transfer.topics[2], addressTopic(recipient)) &&
    amount === BigInt(terms.amount);
  return valid ? "paid" : "mismatch";
}
export { USED, CANCELED, TRANSFER };
