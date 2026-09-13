// Local two-chain deployment used by the operator CLI.
//
// Boots a source chain and a Creditcoin-side chain as real JSON-RPC servers, then
// deploys the product contracts on each side. Everything here is local and
// throwaway: the accounts come from ganache's well-known deterministic mnemonic
// and hold no real value.
//
// TEST DOUBLES in this deployment, both deliberate and both labelled wherever they
// surface in CLI output:
//   * MockUSDC3009        — stands in for native USDC on the source chain.
//   * MockAttestcoinProver — stands in for the Attestcoin native block prover.
// Everything else (GoalRouter, HeaderAnchor, RootInbox, StateProofVerifier,
// MerklePatricia, GoalFillFactVerifier, StateLiftGoalEscrow) is product code.

const fs = require("node:fs");
const path = require("node:path");
const solc = require("solc");
const ganache = require("ganache");
const {
  Contract,
  ContractFactory,
  HDNodeWallet,
  JsonRpcProvider,
} = require("ethers");

const ROOT = path.resolve(__dirname, "..", "..");

/// Ganache's published deterministic mnemonic. PUBLIC, THROWAWAY, LOCAL ONLY.
/// Never fund these accounts on any real network.
const LOCAL_MNEMONIC =
  "myth like bonus scare over problem client lizard pioneer submit female collect";

const SOURCE_CHAIN_ID = 31337;
const CTC_CHAIN_ID = 1337;
/// Attestcoin chain key for the source domain. Demo parameter.
const CHAIN_KEY = 3;
/// Minimum D - T the escrow will accept, in seconds. Demo parameter.
const MIN_CLEARING_WINDOW = 60;

/// Named roles, mapped to deterministic account indexes so CLI flags read as
/// people rather than numbers.
const ROLES = {
  prover: 0, // anyone; submits anchors and proofs
  operator: 1, // the payment operator who owns goals and budgets
  executor: 2, // the first executor
  recipient: 3, // the fixed payee on the source chain
  guarantor: 4, // underwrites rounds with dedicated capital
  executor2: 5, // the replacement executor
};

function compileAll() {
  const sources = {};
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p, prefix);
      else if (entry.name.endsWith(".sol"))
        sources[path.relative(ROOT, p)] = {
          content: fs.readFileSync(p, "utf8"),
        };
    }
  };
  walk(path.join(ROOT, "contracts"));
  // Test doubles live outside contracts/ so they cannot be mistaken for product
  // code, but the local demo needs them compiled.
  for (const name of ["MockUSDC3009.sol", "MockAttestcoinProver.sol"]) {
    const p = path.join(ROOT, "tests", "fixtures", name);
    if (fs.existsSync(p))
      sources[`tests/fixtures/${name}`] = {
        content: fs.readFileSync(p, "utf8"),
      };
  }
  if (!sources["tests/fixtures/MockAttestcoinProver.sol"])
    sources["tests/fixtures/MockAttestcoinProver.sol"] = {
      content: MOCK_PROVER_SOL,
    };

  const out = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources,
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
          evmVersion: "shanghai",
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      }),
    ),
  );
  const errors = (out.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length)
    throw Error(errors.map((e) => e.formattedMessage).join("\n"));
  return out.contracts;
}

const MOCK_PROVER_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {IAttestcoinBlockProver} from 'contracts/proof/RootInbox.sol';
/// @notice TEST DOUBLE for the Attestcoin native block prover. Not a real prover.
contract MockAttestcoinProver {
    uint64 public immutable expectedChainKey;
    constructor(uint64 chainKey) { expectedChainKey = chainKey; }
    function verify(
        uint64 k, uint64, bytes calldata,
        IAttestcoinBlockProver.MerkleProof calldata,
        IAttestcoinBlockProver.ContinuityProof calldata
    ) external view returns (bool) { return k == expectedChainKey; }
}`;

/// Derives one of the deterministic local accounts. Local throwaway keys only.
function hdWallet(index, provider) {
  const hd = HDNodeWallet.fromPhrase(
    LOCAL_MNEMONIC,
    undefined,
    `m/44'/60'/0'/0/${index}`,
  );
  return provider ? hd.connect(provider) : hd;
}

function walletFor(role, provider) {
  const index = ROLES[role];
  if (index === undefined)
    throw Error(
      `unknown role "${role}". known roles: ${Object.keys(ROLES).join(", ")}`,
    );
  return hdWallet(index, provider);
}

async function startChains({ sourcePort, ctcPort }) {
  const source = ganache.server({
    logging: { quiet: true },
    chain: { chainId: SOURCE_CHAIN_ID, hardfork: "shanghai" },
    wallet: { mnemonic: LOCAL_MNEMONIC, totalAccounts: 10 },
    miner: { blockGasLimit: 30000000 },
  });
  const ctc = ganache.server({
    logging: { quiet: true },
    chain: { chainId: CTC_CHAIN_ID, hardfork: "shanghai" },
    wallet: { mnemonic: LOCAL_MNEMONIC, totalAccounts: 10 },
    miner: { blockGasLimit: 30000000 },
  });
  await source.listen(sourcePort);
  await ctc.listen(ctcPort);
  return { source, ctc };
}

async function deployOne(artifact, signer, args = [], label = "") {
  const c = await new ContractFactory(
    artifact.abi,
    "0x" + artifact.evm.bytecode.object,
    signer,
  ).deploy(...args);
  await c.waitForDeployment();
  const address = await c.getAddress();
  if (process.env.STATELIFT_VERBOSE) console.log(`  deployed ${label}: ${address}`);
  return address;
}

/// Deploys both sides and returns a plain deployment record.
async function deployAll({ sourceUrl, ctcUrl, compiled }) {
  // batchMaxCount: 1 — ganache does not handle ethers' JSON-RPC batching, which
  // surfaces as an opaque "could not coalesce error".
  const src = new JsonRpcProvider(sourceUrl, undefined, {
    staticNetwork: true,
    pollingInterval: 20,
    // batchMaxCount: 1 — ganache does not handle ethers' JSON-RPC batching.
    batchMaxCount: 1,
    // cacheTimeout: -1 — ethers caches eth_getTransactionCount for 250ms by
    // default, which hands out a stale nonce to back-to-back transactions and
    // silently lands them all at the same address.
    cacheTimeout: -1,
  });
  const ctc = new JsonRpcProvider(ctcUrl, undefined, {
    staticNetwork: true,
    pollingInterval: 20,
    // batchMaxCount: 1 — ganache does not handle ethers' JSON-RPC batching.
    batchMaxCount: 1,
    // cacheTimeout: -1 — ethers caches eth_getTransactionCount for 250ms by
    // default, which hands out a stale nonce to back-to-back transactions and
    // silently lands them all at the same address.
    cacheTimeout: -1,
  });
  const srcDeployer = hdWallet(ROLES.prover, src);
  const ctcDeployer = hdWallet(ROLES.prover, ctc);

  const token = await deployOne(
    compiled["tests/fixtures/MockUSDC3009.sol"].MockUSDC3009,
    srcDeployer,
    [],
    "token(src)",
  );
  const router = await deployOne(
    compiled["contracts/source/GoalRouter.sol"].GoalRouter,
    srcDeployer,
    [],
    "router(src)",
  );

  const prover = await deployOne(
    compiled["tests/fixtures/MockAttestcoinProver.sol"].MockAttestcoinProver,
    ctcDeployer,
    [CHAIN_KEY],
    "prover(ctc)",
  );
  const headerAnchor = await deployOne(
    compiled["contracts/proof/HeaderAnchor.sol"].HeaderAnchor,
    ctcDeployer,
    [],
    "headerAnchor(ctc)",
  );
  const inbox = await deployOne(
    compiled["contracts/proof/RootInbox.sol"].RootInbox,
    ctcDeployer,
    [prover, CHAIN_KEY, SOURCE_CHAIN_ID, headerAnchor],
    "inbox(ctc)",
  );
  const stateVerifier = await deployOne(
    compiled["contracts/proof/StateProofVerifier.sol"].StateProofVerifier,
    ctcDeployer,
    [inbox],
    "stateVerifier(ctc)",
  );
  const routerCodeHash = (
    await src.send("eth_getProof", [router, [], "latest"])
  ).codeHash;
  const fillVerifier = await deployOne(
    compiled["contracts/payment/GoalFillFactVerifier.sol"].GoalFillFactVerifier,
    ctcDeployer,
    [inbox, stateVerifier, router, routerCodeHash],
    "fillVerifier(ctc)",
  );
  const escrow = await deployOne(
    compiled["contracts/payment/StateLiftGoalEscrow.sol"].StateLiftGoalEscrow,
    ctcDeployer,
    [fillVerifier, MIN_CLEARING_WINDOW],
    "escrow(ctc)",
  );

  // Give the executors test-double tokens so they can actually pay.
  const tokenAbi = compiled["tests/fixtures/MockUSDC3009.sol"].MockUSDC3009.abi;
  const t = new Contract(token, tokenAbi, srcDeployer);
  for (const role of ["executor", "executor2"]) {
    const to = hdWallet(ROLES[role], src).address;
    await (await t.mintForTest(to, 500_000_000_000n)).wait();
  }

  const addresses = {};
  for (const [role, index] of Object.entries(ROLES))
    addresses[role] = hdWallet(index, src).address;

  src.destroy();
  ctc.destroy();

  // Cache the ABIs the CLI needs. Without this every single CLI invocation would
  // re-run solc, which takes tens of seconds and makes the tool unusable.
  const abis = {};
  for (const [file, name] of ABI_EXPORTS)
    abis[`${file}#${name}`] = compiled[file][name].abi;

  return {
    abis,
    createdAt: new Date().toISOString(),
    sourceUrl,
    ctcUrl,
    sourceChainId: SOURCE_CHAIN_ID,
    ctcChainId: CTC_CHAIN_ID,
    chainKey: CHAIN_KEY,
    minClearingWindow: MIN_CLEARING_WINDOW,
    testDoubles: {
      token: "MockUSDC3009 — TEST DOUBLE, not real USDC",
      prover: "MockAttestcoinProver — TEST DOUBLE, not a real Attestcoin prover",
    },
    contracts: {
      token,
      router,
      prover,
      headerAnchor,
      inbox,
      stateVerifier,
      fillVerifier,
      escrow,
    },
    routerCodeHash,
    roles: ROLES,
    addresses,
  };
}

/// Contracts whose ABIs the CLI needs at runtime.
const ABI_EXPORTS = [
  ["contracts/payment/StateLiftGoalEscrow.sol", "StateLiftGoalEscrow"],
  ["contracts/payment/GoalFillFactVerifier.sol", "GoalFillFactVerifier"],
  ["contracts/proof/RootInbox.sol", "RootInbox"],
  ["contracts/proof/StateProofVerifier.sol", "StateProofVerifier"],
  ["contracts/source/GoalRouter.sol", "GoalRouter"],
  ["tests/fixtures/MockUSDC3009.sol", "MockUSDC3009"],
];

module.exports = {
  ABI_EXPORTS,
  ROOT,
  LOCAL_MNEMONIC,
  SOURCE_CHAIN_ID,
  CTC_CHAIN_ID,
  CHAIN_KEY,
  MIN_CLEARING_WINDOW,
  ROLES,
  compileAll,
  startChains,
  deployAll,
  hdWallet,
  walletFor,
};
