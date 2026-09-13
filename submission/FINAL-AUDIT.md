# StateLift final delivery audit

Checked 2026-09-13 against the current `main` commit.

| Requirement | Evidence |
|---|---|
| One compliant source payment per goal `G` | `tests/source/goal-router.test.cjs`; duplicate Sepolia payment mined with status 0 in `evidence/testnet/duplicate-payment.json` |
| Recover `R` after uncertain payment | Normal and late-path settlement records in `evidence/testnet/audit.json` |
| Safe same-`G` handoff after an unavailable payer | Handoff settlement `0xa532ba0a5db0d375178a71286715e332787fb2935591a07d69705a38149a35af` |
| Late payment charged to dedicated full `B` | Late settlement `0x742f0927d6e602582725cc4d4218a80cb87a8f9f3aeee710548d6a2760d1ba20` (`fromGuarantee=true`) |
| Proof changes Creditcoin ownership | Normal settlement `0xeffe0ce362de7e976221343f31d217ac5dcd22fcc7227f18c470e694108977b9` and before/after credit deltas in `evidence/testnet/audit.json` |
| R/B/π/reward/withdrawal accounting | `evidence/testnet/withdrawals.json`; escrow buckets reconcile to zero |

Validation:

- Full serial suite: 107 passed, 0 failed (`evidence/full-recheck.log`).
- Three-act local demo: 49 commands, 13 accounting snapshots (`evidence/three-acts.md`).
- Public clone install and smoke checks: `evidence/public-clone-validation.md`.
- Whitepaper: six pages, bookmarks and links checked (`evidence/pdf-inspection.json`).

Known limits are stated in `docs/WHITEPAPER.md`: demonstration parameters, testnet-only deployment, subsidized gas, no customer or independent underwriting evidence, no professional security audit, and possible long-lived `B` lockup when facts never arrive.
