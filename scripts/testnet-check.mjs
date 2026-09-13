// Read-only prerequisites. Never opens any credential file.
import fs from 'node:fs';
import { Interface, formatEther, formatUnits } from 'ethers';
const address = '0x5780B298dFAdB0013d65056eb71a519f84A30f91';
export const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const abi = new Interface(['function balanceOf(address) view returns(uint256)', 'function decimals() view returns(uint8)', 'function name() view returns(string)']);
const results = { observedAt: new Date().toISOString(), address, chains: {} };
for (const [name, url, expected] of [
  ['creditcoin', 'https://rpc.cc3-testnet.creditcoin.network', 102031],
  ['sepolia', 'https://ethereum-sepolia-rpc.publicnode.com', 11155111],
]) {
  const raw = [];
  async function rpc(method, params = []) {
    const res = await fetch(url, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0', id:raw.length+1, method, params}), signal:AbortSignal.timeout(20000)});
    const data = await res.json(); raw.push({method, params, response:data});
    if (data.error) throw Error(JSON.stringify(data.error));
    return data.result;
  }
  const chainId = Number(BigInt(await rpc('eth_chainId')));
  if (chainId !== expected) throw Error('Wrong chain');
  const block = await rpc('eth_blockNumber');
  const balance = await rpc('eth_getBalance', [address, block]);
  const entry = {url, chainId, block:Number(BigInt(block)), nativeBalance:formatEther(balance), raw};
  if (name === 'sepolia') {
    const code = await rpc('eth_getCode', [USDC, block]);
    if (code === '0x') throw Error('USDC has no code');
    const tokenBalance = await rpc('eth_call', [{to:USDC, data:abi.encodeFunctionData('balanceOf',[address])},block]);
    entry.usdc = {address:USDC, balance:formatUnits(abi.decodeFunctionResult('balanceOf',tokenBalance)[0],6)};
  }
  results.chains[name] = entry;
}
const proverUrl = 'https://prover.cc3-testnet.creditcoin.network/api/v1/attested-height/1';
const res = await fetch(proverUrl, {signal:AbortSignal.timeout(20000)});
results.prover = {url:proverUrl, httpStatus:res.status, body:await res.json()};
fs.mkdirSync('evidence/testnet', {recursive:true});
fs.writeFileSync('evidence/testnet/prerequisites.json', JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
