// Public verification only: no credential path, private key, signer or broadcast.
import fs from 'node:fs';
import {Contract,JsonRpcProvider} from 'ethers';
export const read=name=>JSON.parse(fs.readFileSync(`evidence/testnet/${name}.json`));
export const save=(name,v)=>fs.writeFileSync(`evidence/testnet/${name}.json`,JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2)+'\n');
export const deployment=read('deployment');
const artifacts=read('artifacts'),roles=read('roles').roles;
export const addressOf=role=>roles[role];
export const providers={
  sepolia:new JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com',11155111,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1}),
  creditcoin:new JsonRpcProvider('https://rpc.cc3-testnet.creditcoin.network',102031,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1}),
};
export function contract(name){const d=deployment.contracts[name];return new Contract(d.address,Object.values(artifacts).find(x=>x[name])[name].abi,providers[d.chain]);}
export async function assertChains(){for(const[chain,id]of [['sepolia',11155111],['creditcoin',102031]])if(Number(BigInt(await providers[chain].send('eth_chainId',[])))!==id)throw Error('Wrong chain');}
export function close(){for(const p of Object.values(providers))p.destroy();}
