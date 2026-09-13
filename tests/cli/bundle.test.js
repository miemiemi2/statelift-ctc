import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { verifyBundle } from "../../lib/bundle.js";
const original = JSON.parse(
  fs.readFileSync(
    new URL("../../examples/recovery-bundle.json", import.meta.url),
  ),
);
test("public bundle preserves signed terms independently of key ordering", () => {
  assert.equal(verifyBundle(original).termsHash, original.termsHash);
  const shuffled = {
    ...original,
    quote: Object.fromEntries(Object.entries(original.quote).reverse()),
  };
  assert.equal(verifyBundle(shuffled).termsHash, original.termsHash);
});
test("missing original terms and edited recipient are rejected", () => {
  const a = structuredClone(original);
  delete a.order.goal;
  assert.throws(() => verifyBundle(a));
  const b = structuredClone(original);
  b.order.goal.recipient = "0x" + "55".repeat(20);
  assert.throws(() => verifyBundle(b));
});
