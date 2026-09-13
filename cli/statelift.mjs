#!/usr/bin/env node
import fs from "node:fs";
import {
  verifyHeaderRlp,
  verifyAccountProof,
  verifyStorageProof,
  verifyReceiptProof,
} from "../lib/primitives.js";
import { readBundle, verifyBundle } from "../lib/bundle.js";
import { decodeReceipt, classifyReceipt } from "../lib/receipt.js";
const [command, file] = process.argv.slice(2);
if (!command || !file) {
  console.error(
    "Usage: node cli/statelift.mjs <header|account|storage|receipt-proof|classify-receipt|bundle> input.json\nRead-only local verifier. An expected root/hash must already be authenticated.",
  );
  process.exitCode = 2;
} else
  try {
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    let result;
    if (command === "header") result = verifyHeaderRlp(d);
    else if (command === "account") result = await verifyAccountProof(d);
    else if (command === "storage") result = await verifyStorageProof(d);
    else if (command === "receipt-proof")
      result = { receipt: await verifyReceiptProof(d) };
    else if (command === "classify-receipt") {
      const receipt = decodeReceipt(d.rawReceipt);
      result = {
        outcome: classifyReceipt({
          receipt,
          terms: d.terms,
          sourceTimestamp: d.sourceTimestamp,
        }),
        scope:
          "Requires independently authenticated receipt, timestamp and execution-version semantics.",
      };
    } else if (command === "bundle") result = verifyBundle(readBundle(file));
    else throw Error("unknown command");
    console.log(
      JSON.stringify(
        result,
        (_, v) => (typeof v === "bigint" ? v.toString() : v),
        2,
      ),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
