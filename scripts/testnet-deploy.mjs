// Dedicated testnet account only. Checkpoints every broadcast before waiting.
import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import {Wallet, JsonRpcProvider, ContractFactory, Contract, keccak256} from 'ethers';
const directory = 'evidence/testnet';
fs.mkdirSync(directory,{recursive:true});
const filename = `${directory}/deployment.json`;
const state = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename)) : {contracts:{}, createdAt:new Date().toISOString()};
function save() { fs.writeFileSync(filename,JSON.stringify(state,null,2)+'\n'); }
const credentialPath = '/root/.config/statelift/testnet-deployer.json';
if ((fs.statSync(credentialPath).mode & 0o777) !== 0o600) throw Error('Credential permissions must be 0600');
const credential = JSON.parse(fs.readFileSync(credentialPath));
const address = '0x5780B298dFAdB0013d65056eb71a519f84A30f91';
const providers = {
  sepolia:new JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com',11155111,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1}),
  creditcoin:new JsonRpcProvider('https://rpc.cc3-testnet.creditcoin.network',102031,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1}),
};
for (const [name, p] of Object.entries(providers)) {
  const actual = Number(BigInt(await p.send('eth_chainId',[])));
  if(actual !== (name==='sepolia'?11155111:102031)) throw Error('Wrong chain');
  p.pollingInterval=3000;
}
const wallets = Object.fromEntries(Object.entries(providers).map(([name,p])=>[name,new Wallet(credential.privateKey,p)]));
if(wallets.sepolia.address.toLowerCase()!==address.toLowerCase()) throw Error('Wrong dedicated account');
const sources={};
function walk(dir) { for (const entry of fs.readdirSync(dir,{withFileTypes:true})) { const p=path.join(dir,entry.name); if(entry.isDirectory()) walk(p); else if(p.endsWith('.sol')) sources[p]={content:fs.readFileSync(p,'utf8')}; } }
walk('contracts');
const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
console.log('Compiling production contracts');
const output=JSON.parse(solc.compile(JSON.stringify(input)));
const errors=(output.errors??[]).filter(x=>x.severity==='error');
if(errors.length) throw Error(errors.map(x=>x.formattedMessage).join('\n'));
fs.writeFileSync(`${directory}/compiler-input.json`,JSON.stringify(input));
fs.writeFileSync(`${directory}/artifacts.json`,JSON.stringify(output.contracts));
async function deploy(name,file,chain,args=[]) {
  const artifact=output.contracts[file][name], provider=providers[chain];
  let entry=state.contracts[name];
  if(!entry) {
    const factory=new ContractFactory(artifact.abi,artifact.evm.bytecode.object,wallets[chain]);
    const request=await factory.getDeployTransaction(...args);
    const estimate=await provider.estimateGas({...request,from:address});
    const fees=await provider.getFeeData();
    const price=fees.maxFeePerGas??fees.gasPrice;
    const ceiling=chain==='sepolia'?5_000_000_000_000_000n:100_000_000_000_000_000_000n;
    if(estimate*price>ceiling) throw Error('Deployment fee exceeds testnet budget ceiling');
    const deployed=await factory.deploy(...args,{gasLimit:estimate*12n/10n});
    entry={chain,address:await deployed.getAddress(),hash:deployed.deploymentTransaction().hash,args};
    state.contracts[name]=entry; save();
    console.log(`${name} broadcast ${entry.hash}`);
  }
  const receipt=await provider.waitForTransaction(entry.hash,1,180000);
  if(!receipt) throw Error(`Still pending: ${entry.hash}; rerun to resume, never redeploy blindly`);
  if(receipt.status!==1) throw Error(`Deployment reverted: ${entry.hash}`);
  const code=await provider.getCode(entry.address);
  if(code==='0x') throw Error('Deployment code missing');
  Object.assign(entry,{block:receipt.blockNumber,gasUsed:receipt.gasUsed.toString(),runtimeCodeHash:keccak256(code),status:receipt.status});
  fs.writeFileSync(`${directory}/${name}-receipt.json`,JSON.stringify(receipt.toJSON(),null,2)); save();
  console.log(`${name} verified at ${entry.address}, block ${entry.block}`);
  return new Contract(entry.address,artifact.abi,wallets[chain]);
}
try {
  const router=await deploy('GoalRouter','contracts/source/GoalRouter.sol','sepolia');
  const anchor=await deploy('HeaderAnchor','contracts/proof/HeaderAnchor.sol','sepolia');
  const inbox=await deploy('RootInbox','contracts/proof/RootInbox.sol','creditcoin',['0x0000000000000000000000000000000000000FD2',1,11155111,await anchor.getAddress()]);
  const spv=await deploy('StateProofVerifier','contracts/proof/StateProofVerifier.sol','creditcoin',[await inbox.getAddress()]);
  const verifier=await deploy('GoalFillFactVerifier','contracts/payment/GoalFillFactVerifier.sol','creditcoin',[await inbox.getAddress(),await spv.getAddress(),await router.getAddress(),state.contracts.GoalRouter.runtimeCodeHash]);
  const escrow=await deploy('StateLiftGoalEscrow','contracts/payment/StateLiftGoalEscrow.sol','creditcoin',[await verifier.getAddress(),60]);
  state.configuration={sourceChainKey:1,sepoliaChainId:11155111,creditcoinChainId:102031,usdc:'0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',minimumClearingWindow:60,parameters:'DEMO ONLY'};
  state.verifiedConfiguration={prover:await inbox.prover(),chainKey:(await inbox.chainKey()).toString(),escrowVerifier:await escrow.verifier()};
  save();
} catch(error) {
  // Do not serialize signer/request objects or errors that could carry credentials.
  console.error(error.shortMessage??error.message); process.exitCode=1;
} finally { for(const p of Object.values(providers)) p.destroy(); }
