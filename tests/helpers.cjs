const fs = require("node:fs"),
  path = require("node:path"),
  solc = require("solc"),
  ganache = require("ganache");
const { BrowserProvider, ContractFactory, Wallet } = require("ethers");
const root = path.resolve(__dirname, "..");
function compile(extra = {}) {
  const sources = { ...extra };
  function walk(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith(".sol"))
        sources[path.relative(root, p)] = {
          content: fs.readFileSync(p, "utf8"),
        };
    }
  }
  walk(path.join(root, "contracts"));
  const output = JSON.parse(
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
  const errors = output.errors?.filter((e) => e.severity === "error") ?? [];
  if (errors.length)
    throw Error(errors.map((e) => e.formattedMessage).join("\n"));
  return output.contracts;
}
async function environment() {
  const rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 1337, hardfork: "shanghai" },
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
  return { rpc, provider, signers, wallets, close: () => rpc.disconnect() };
}
async function deploy(artifact, signer, args = []) {
  const contract = await new ContractFactory(
    artifact.abi,
    "0x" + artifact.evm.bytecode.object,
    signer,
  ).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}
module.exports = { compile, environment, deploy };
