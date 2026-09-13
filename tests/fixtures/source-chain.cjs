// Real source-chain fixture.
//
// Runs a SECOND ganache instance as the "Ethereum" source chain. Transactions are
// really executed there; this module then exports REAL Merkle-Patricia proofs
// (via eth_getProof) and the REAL block header RLP, so the CTC-side RootInbox /
// StateProofVerifier / MerklePatricia contracts verify facts that were actually
// produced by contract execution rather than hand-authored trie fixtures.
//
// TEST DOUBLE, clearly scoped: the Attestcoin native block prover is replaced by
// MockAttestcoinProver (below). Everything downstream of the anchored header
// (header RLP parsing, state/storage/receipt MPT verification) is the real code
// path. This is NOT a real Attestcoin testnet integration.

const fs = require("node:fs");
const path = require("node:path");
const ganache = require("ganache");
const { BrowserProvider, ContractFactory, Wallet } = require("ethers");
const proofs = require("../../lib/local/proofs.cjs");
const {
  ZERO32,
  BLOOM,
  scalar,
  headerRlp,
  encodeReceipt,
  indexKey,
  anchorTxBytes,
  anchorSourceBlock,
} = proofs;

/// Stand-in for the Attestcoin native block prover precompile/contract.
/// Accepts any height for the configured chain key so fixtures can anchor many
/// real source blocks. Marked TEST-DOUBLE everywhere it surfaces.
const MOCK_PROVER_SOURCE = {
  "tests/fixtures/MockAttestcoinProver.sol": {
    content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {IAttestcoinBlockProver} from 'contracts/proof/RootInbox.sol';
/// @notice TEST DOUBLE for the Attestcoin native block prover. Not a real prover.
contract MockAttestcoinProver {
    uint64 public immutable expectedChainKey;
    constructor(uint64 chainKey) { expectedChainKey = chainKey; }
    function verify(
        uint64 k,
        uint64,
        bytes calldata,
        IAttestcoinBlockProver.MerkleProof calldata,
        IAttestcoinBlockProver.ContinuityProof calldata
    ) external view returns (bool) { return k == expectedChainKey; }
}`,
  },
};

// RLP / trie / anchoring helpers live in lib/local/proofs.cjs so the CLI and the
// tests provably share one implementation.

// ---------- source chain ----------

async function sourceEnvironment({ chainId = 31337 } = {}) {
  const rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId, hardfork: "shanghai" },
    wallet: { deterministic: true },
    miner: { blockGasLimit: 30000000 },
  });
  const provider = new BrowserProvider(rpc);
  provider.pollingInterval = 10;
  const signers = await Promise.all(
    [0, 1, 2, 3, 4, 5].map((i) => provider.getSigner(i)),
  );
  const wallets = Object.values(rpc.getInitialAccounts()).map(
    (a) => new Wallet(a.secretKey),
  );

  const call = (method, params) => rpc.request({ method, params });
  const block = (number) => proofs.getBlock(call, number);
  const stateProof = (address, slots, number) =>
    proofs.stateProof(call, address, slots, number);
  const receiptProof = (number, transactionIndex) =>
    proofs.receiptProof(call, number, transactionIndex);

  return {
    rpc,
    provider,
    signers,
    wallets,
    chainId,
    call,
    block,
    stateProof,
    receiptProof,
    close: () => rpc.disconnect(),
  };
}

async function deployTo(artifact, signer, args = []) {
  const c = await new ContractFactory(
    artifact.abi,
    "0x" + artifact.evm.bytecode.object,
    signer,
  ).deploy(...args);
  await c.waitForDeployment();
  return c;
}

// ---------- test-double sources kept out of contracts/ ----------

/// Loads a `.sol` test double from tests/fixtures as a solc input entry.
/// Keeping these out of contracts/ makes it impossible to mistake a test double
/// for a product contract.
function fixtureSources(...names) {
  const out = {};
  for (const n of names)
    out[`tests/fixtures/${n}`] = {
      content: fs.readFileSync(path.join(__dirname, n), "utf8"),
    };
  return out;
}

/// EIP-3009 ReceiveWithAuthorization signature against the fixture token.
async function signReceiveWithAuthorization({
  wallet,
  token,
  chainId,
  from,
  to,
  value,
  validAfter,
  validBefore,
  nonce,
}) {
  return wallet.signTypedData(
    {
      name: "TEST-DOUBLE USD Coin",
      version: "1",
      chainId,
      verifyingContract: token,
    },
    {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    { from, to, value, validAfter, validBefore, nonce },
  );
}

module.exports = {
  MOCK_PROVER_SOURCE,
  ZERO32,
  BLOOM,
  scalar,
  headerRlp,
  encodeReceipt,
  indexKey,
  sourceEnvironment,
  anchorTxBytes,
  anchorSourceBlock,
  deployTo,
  fixtureSources,
  signReceiveWithAuthorization,
};
