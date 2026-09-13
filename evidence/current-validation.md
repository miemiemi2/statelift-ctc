# Current validation checkpoint — 2026-09-13

- `node --test --test-concurrency=1 tests/cli/*.test.js tests/cli/*.test.cjs tests/proof/*.test.cjs tests/payment/*.test.cjs tests/fixtures/*.test.cjs tests/source/*.test.cjs tests/goal/*.test.cjs`: exit 0; 107 passed, 0 failed; 1093.051 seconds. Raw: full-recheck.log.
- `node scripts/demo-three-acts.mjs`: exit 0; 49 CLI commands, 13 invariant snapshots. Includes no old payment, deadline R recovery, replacement success on the same G and old B release. Raw: demo-recheck.log, three-acts.md, three-acts-transitions.json.
- `node scripts/testnet-finish.mjs`: exit 0. All three real paths proved through official Attestcoin and settled; source payment and CTC allocation receipts saved in testnet/.
- `node scripts/testnet-negative.mjs`: exit 0. A correctly signed duplicate attempt was mined with status 0; payer and recipient USDC unchanged.
- `node scripts/testnet-audit.mjs`: exit 0 using public RPCs only, no credential imports. Re-queries historical allocation deltas around actual settlement blocks and contract runtime code hashes. Raw: testnet-audit.log; structured: testnet/audit.json.
- `node scripts/testnet-withdraw.mjs`: exit 0. Every role withdrew its credited amount, gas-adjusted native balance increases match; escrow's entire decomposition is zero. Raw: testnet-withdraw.log; structured: testnet/withdrawals.json.
- `python3 scripts/render-whitepaper.py`: PDF rendered locally; six pages, inspected representative pages and all text boundaries. Metadata: pdf-inspection.json.
- Dedicated deployer and five derived role secrets were compared in memory against 420 project text files; no matching secrets found. Only public reports saved, credential-scan.json. This is not a general third-party security audit.

All listed execution sessions are terminal. Do not restart testnet deployments/payments or recreate goals to resume packaging. The real escrow has been cashed out intentionally; use historical snapshots and receipts for the demonstration.

Remaining goal work: public submission repository/PDF URL, concise recordable demo and submission text, current form/team requirements, verified delivery to the user's Mac desktop, final full-scope completion audit. These are not blocked by the completed blockchain runs.
