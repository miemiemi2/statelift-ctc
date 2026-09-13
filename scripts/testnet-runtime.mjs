import fs from 'node:fs';
import {createHmac} from 'node:crypto';
import {Wallet,JsonRpcProvider,Contract} from 'ethers';
export const directory='evidence/testnet';
export const json=(v)=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2)+'\n';
export const save=(name,v)=>fs.writeFileSync(`${directory}/${name}.json`,json(v));
export const read=(name)=>JSON.parse(fs.readFileSync(`${directory}/${name}.json`));
export const deployment=read('deployment');
const artifacts=read('artifacts');
const file='/root/.config/statelift/testnet-deployer.json';
if((fs.statSync(file).mode&0o777)!==0o600)throw Error('Credential must be 0600');
const key=JSON.parse(fs.readFileSync(file)).privateKey;
export const providers={
  sepolia:new JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com',11155111,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1}),
  creditcoin:new JsonRpcProvider('https://rpc.cc3-testnet.creditcoin.network',102031,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1}),
};
for(const p of Object.values(providers))p.pollingInterval=3000;
// Role keys are derived in memory only and never saved or logged.
// The namespace deliberately confines these accounts to this testnet demo.
export function wallet(role,chain) {
  const roleKey=role==='deployer'?key:'0x'+createHmac('sha256',Buffer.from(key.slice(2),'hex')).update(`StateLift:TESTNET-ONLY:20260913:${role}`).digest('hex');
  return new Wallet(roleKey,providers[chain]);
}
export function contract(name,role='deployer') {
  const d=deployment.contracts[name];
  const artifact=Object.values(artifacts).find(x=>x[name])?.[name];
  return new Contract(d.address,artifact.abi,wallet(role,d.chain));
}
export async function assertChains() {
  for(const [chain,id]of [['sepolia',11155111],['creditcoin',102031]])
    if(Number(BigInt(await providers[chain].send('eth_chainId',[])))!==id)throw Error('Wrong chain');
  if(wallet('deployer','sepolia').address.toLowerCase()!=='0x5780b298dfadb0013d65056eb71a519f84a30f91')throw Error('Wrong account');
}
export function close(){for(const p of Object.values(providers))p.destroy();}
export async function transaction(state,label,chain,send) {
  state.transactions??={};
  const checkpoint=()=>save(state.file,state);
  let record=state.transactions[label];
  if(!record) {
    const tx=await send(); record={hash:tx.hash,chain}; state.transactions[label]=record; checkpoint();
    console.log(`${label}: broadcast ${tx.hash}`);
  }
  const r=await providers[chain].waitForTransaction(record.hash,1,180000);
  if(!r)throw Error(`Pending ${record.hash}; resume this exact checkpoint`);
  if(r.status!==1)throw Error(`Reverted ${label}: ${record.hash}`);
  Object.assign(record,{block:r.blockNumber,status:r.status,gasUsed:r.gasUsed.toString()});
  save(`${state.file}-${label}-receipt`,r.toJSON()); checkpoint();
  console.log(`${label}: confirmed block ${r.blockNumber}`);
  return r;
}
