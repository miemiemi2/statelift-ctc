// Mines a second, correctly signed payment attempt for an already paid G.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Contract} from 'ethers';
import {directory,read,save,wallet,providers,contract,assertChains,close} from './testnet-runtime.mjs';
const f=read('flow-normal'),file='duplicate-payment';
const s=fs.existsSync(`${directory}/${file}.json`)?read(file):{};
try{
  await assertChains();
  const payer=wallet('executor2','sepolia'),router=contract('GoalRouter','executor2');
  const token=new Contract(f.terms.token,['function balanceOf(address) view returns(uint256)'],providers.sepolia);
  if(!s.hash){
    const payBy=(await providers.sepolia.getBlock('latest')).timestamp+300;
    const nonce=await router.fillNonce(f.goalId,2,payer.address,payBy);
    const values={from:payer.address,to:await router.getAddress(),value:f.terms.amount,validAfter:0,validBefore:payBy+3600,nonce};
    const fields=[['from','address'],['to','address'],['value','uint256'],['validAfter','uint256'],['validBefore','uint256'],['nonce','bytes32']].map(([name,type])=>({name,type}));
    const signature=await payer.signTypedData(f.usdcDomain,{ReceiveWithAuthorization:fields},values);
    Object.assign(s,{goalId:f.goalId,recipientBefore:await token.balanceOf(f.terms.recipient),payerBefore:await token.balanceOf(payer.address)});save(file,s);
    const tx=await router.fill(f.ref,2,payBy,payer.address,{from:payer.address,validAfter:0,validBefore:payBy+3600,signature},{gasLimit:250000});
    s.hash=tx.hash;save(file,s);console.log(`duplicate broadcast ${s.hash}`);
  }
  const receipt=await providers.sepolia.waitForTransaction(s.hash,1,180000);
  if(!receipt)throw Error('Still pending; preserve this transaction');
  assert.equal(receipt.status,0,'duplicate must revert on chain');
  s.recipientAfter=await token.balanceOf(f.terms.recipient);s.payerAfter=await token.balanceOf(wallet('executor2','sepolia').address);
  assert.equal(BigInt(s.recipientBefore),s.recipientAfter);assert.equal(BigInt(s.payerBefore),s.payerAfter);
  const fill=await router.fillOf(f.goalId);assert.equal(fill.roundNumber,1n);
  Object.assign(s,{block:receipt.blockNumber,status:receipt.status,recipientUnchanged:true,payerUSDCUnchanged:true,winningRound:fill.roundNumber,gasUsed:receipt.gasUsed});
  save(file,s);save(`${file}-receipt`,receipt.toJSON());console.log('Confirmed revert; no second USDC debit or payment; winner remains round 1. Gas was spent.');
}catch(e){console.error(e.shortMessage??e.message);process.exitCode=1;}finally{close();}
