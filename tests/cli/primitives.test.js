import test from "node:test";
import assert from "node:assert/strict";
import { verifyHeaderRlp } from "../../lib/primitives.js";
test("reject header tamper", () =>
  assert.throws(() => verifyHeaderRlp("0xc0", "0x" + "11".repeat(32))));
