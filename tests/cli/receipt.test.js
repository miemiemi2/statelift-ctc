import test from "node:test";
import assert from "node:assert/strict";
import { AbiCoder, id, zeroPadValue, encodeRlp } from "ethers";
import {
  classifyReceipt,
  decodeReceipt,
  USED,
  CANCELED,
  TRANSFER,
} from "../../lib/receipt.js";
const token = "0x" + "11".repeat(20),
  authorizer = "0x" + "22".repeat(20),
  recipient = "0x" + "33".repeat(20),
  nonce = id("nonce");
const coder = AbiCoder.defaultAbiCoder();
const terms = {
  token,
  authorizer,
  recipient,
  nonce,
  amount: "100",
  validAfter: "10",
  validBefore: "20",
};
const use = {
  address: token,
  topics: [USED, zeroPadValue(authorizer, 32), nonce],
  data: "0x",
};
const transfer = {
  address: token,
  topics: [TRANSFER, zeroPadValue(authorizer, 32), zeroPadValue(recipient, 32)],
  data: coder.encode(["uint256"], [100]),
};
function classify(logs = [use, transfer], time = 15, status = 1) {
  return classifyReceipt({
    receipt: { status, logs },
    terms,
    sourceTimestamp: time,
  });
}
test("exact used+paired transfer pays only in strict open interval", () => {
  assert.equal(classify(), "paid");
  assert.equal(classify(undefined, 10), "mismatch");
  assert.equal(classify(undefined, 20), "mismatch");
});
test("plain transfer, wrong token and no matching nonce remain unknown", () => {
  assert.equal(classify([transfer]), "unknown");
  assert.equal(classify([{ ...use, address: recipient }, transfer]), "unknown");
  assert.equal(
    classify([
      { ...use, topics: [USED, zeroPadValue(authorizer, 32), id("other")] },
      transfer,
    ]),
    "unknown",
  );
});
test("cancel is a distinct terminal fact; failed receipt is unknown", () => {
  assert.equal(
    classify([
      { ...use, topics: [CANCELED, zeroPadValue(authorizer, 32), nonce] },
    ]),
    "cancelled",
  );
  assert.equal(classify(undefined, 15, 0), "unknown");
});
test("mismatched amounts and recipient are not paid; unpaired log is unknown", () => {
  assert.equal(
    classify([use, { ...transfer, data: coder.encode(["uint256"], [50]) }]),
    "mismatch",
  );
  assert.equal(
    classify([
      use,
      {
        ...transfer,
        topics: [
          TRANSFER,
          zeroPadValue(authorizer, 32),
          zeroPadValue(token, 32),
        ],
      },
    ]),
    "mismatch",
  );
  assert.equal(
    classify([use, { address: recipient, topics: [], data: "0x" }, transfer]),
    "unknown",
  );
});
test("typed receipt decoding preserves authenticated raw logs", () => {
  const body = encodeRlp([
    "0x01",
    "0x5208",
    "0x" + "00".repeat(256),
    [use, transfer].map((l) => [l.address, l.topics, l.data]),
  ]);
  const rx = decodeReceipt("0x02" + body.slice(2));
  assert.equal(rx.status, 1);
  assert.equal(
    classifyReceipt({ receipt: rx, terms, sourceTimestamp: 15 }),
    "paid",
  );
  assert.throws(() => decodeReceipt("0x7f" + body.slice(2)));
});
