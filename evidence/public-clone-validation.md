# Public clone validation — 2026-09-13

A fresh clone of `https://github.com/miemiemi2/statelift-ctc` at commit `9aef44a` was created in a temporary directory. `npm ci --ignore-scripts` completed. These commands then exited successfully:

- `node scripts/showcase.mjs`
- `node scripts/testnet-audit.mjs` (public RPC only; no credential file)
- `node --check cli/operator.mjs`
- `node --check scripts/testnet-flow.mjs`

The clone contained 221 tracked files. The temporary directory and dependencies were not added to the project or delivery package.
