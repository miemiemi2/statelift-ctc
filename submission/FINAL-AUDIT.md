# StateLift final judge-facing audit

Checked 2026-09-14. Outcome: no remaining implementation or evidence blocker found for the agreed submission scope. This is a delivery review, not a professional security audit or a prediction of competition ranking.

| Judge's question | Reviewable evidence |
|---|---|
| What does the state proof add? | `flow-expiry.json`: post-T storage non-membership releases 0.1 tCTC of B while G remains Open; real `releaseGuaranteeByExpiry` transaction `0xc281cefe2f518f1bf2c64f594213f4502a698d260646629a8a9f54d881ed6ab6` |
| Can I verify it myself? | https://miemiemi2.github.io/statelift-ctc/web/verifier.html — four published flows, historical accounting, deployed-code hashes and fact-verifier calls; no wallet required |
| Can two retries spend the same guarantee or pay twice? | Updated negative-fact suite: two separate expiries followed by third-round settlement; 13/13 passed. Real duplicate source payment mined and reverted in `evidence/testnet/duplicate-payment.json` |
| Who pays a late obligation? | `flow-late.json`: operator retains refunded R; the winning round's dedicated B credits the winner |
| Does handoff preserve the goal? | `flow-relay.json`: executor 2 wins the same G; round 1 B releases independently |
| Is accounting reproducible? | `evidence/testnet/browser-verification.json` records all four RPC checks; `withdrawals.json` proves the earlier three-path zero-balance checkpoint. The later expiry run leaves B available and R credited, not withdrawn. |

Validation:

- Full-suite baseline: 107 passed, 0 failed (`evidence/full-recheck.log`). Not represented as a rerun of the expanded suite.
- Updated negative-fact suite: 13 passed, 0 failed, 101.1 seconds (`evidence/multi-round-validation.log`).
- Browser verification core: all four published flows pass; mismatched expiry goal proof rejected.
- Chromium: expiry verification, invalid input, desktop and 390px mobile checked; no page errors or horizontal overflow.
- Local showcase reads all four evidence bundles successfully. It displays saved evidence; the public verifier queries RPC live.
- Fresh release archive: `npm ci --ignore-scripts --no-audit --no-fund`, CLI help and four-flow showcase passed. Primary material relative links resolve; expiry Blockscout link returns HTTP 200.
- Whitepaper regenerated from the current Markdown; expiry and the separate test scopes are included.

The main claim is a concrete payment decision powered by state non-membership, not unrestricted historical querying. Generic proof components exist, but the submission has one business consumer. Public RPC availability and historical-state support remain runtime dependencies. Economics are subsidized demonstration parameters; customer demand, independent underwriting and profitable pricing are not established. These limitations remain explicit.
