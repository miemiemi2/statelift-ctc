// Independent read-only replay of chain state at the actual settlement blocks.
import assert from 'node:assert/strict';
import {keccak256,parseEther,Contract} from 'ethers';
import {read,save,providers,contract,deployment,addressOf,assertChains,close} from './testnet-public.mjs';
const result={observedAt:new Date().toISOString(),deployments:[],flows:[]};
try{
  await assertChains();
  for(const[name,d]of Object.entries(deployment.contracts)){
    const code=await providers[d.chain].getCode(d.address);assert.equal(keccak256(code),d.runtimeCodeHash);
    result.deployments.push({name,chain:d.chain,address:d.address,codeHashMatches:true});
  }
  const escrow=contract('StateLiftGoalEscrow'),router=contract('GoalRouter');
  const R=parseEther('0.1');
  for(const act of ['normal','late','relay']){
    const f=read(`flow-${act}`),n=act==='relay'?2:1;
    const winner=addressOf(n===2?'executor2':'executor');
    const goal=await escrow.getGoal(f.goalId),fill=await router.fillOf(f.goalId);
    assert.equal(goal.state,2n);assert.equal(goal.filledRound,BigInt(n));assert.equal(goal.winnerPaid,winner);
    assert.equal(fill.roundNumber,BigInt(n));assert.equal(fill.winner,winner);
    const receipt=await providers.creditcoin.getTransactionReceipt(f.transactions.settle.hash);assert.equal(receipt.status,1);
    const event=receipt.logs.filter(l=>l.address.toLowerCase()===deployment.contracts.StateLiftGoalEscrow.address.toLowerCase()).map(l=>escrow.interface.parseLog(l)).find(l=>l?.name==='RoundSettled');
    assert.equal(event.args.fromGuarantee,act==='late');assert.equal(event.args.amount,R);assert.equal(event.args.winner,winner);
    const b=receipt.blockNumber;
    const creditsBefore=await escrow.credits(winner,{blockTag:b-1}),creditsAfter=await escrow.credits(winner,{blockTag:b});
    assert.equal(creditsAfter-creditsBefore,R);
    const invBefore=await escrow.invariant({blockTag:b-1}),invAfter=await escrow.invariant({blockTag:b});
    for(const inv of [invBefore,invAfter])assert.equal(inv[0],inv[1]+inv[2]+inv[3]+inv[4]);
    assert.equal(invBefore[3]-invAfter[3],R);
    assert.equal(invBefore[1]-invAfter[1],act==='late'?0n:R);
    assert.equal(invAfter[2]-invBefore[2],act==='late'?0n:R);
    if(act!=='normal'){
      const refund=await providers.creditcoin.getTransactionReceipt(f.transactions['refund-1'].hash);assert.equal(refund.status,1);
      const owner=addressOf('operator');
      assert.equal((await escrow.credits(owner,{blockTag:refund.blockNumber}))-(await escrow.credits(owner,{blockTag:refund.blockNumber-1})),R);
    }
    if(act==='relay')assert.equal((await escrow.getRound(await escrow.roundIdOf(f.goalId,1))).state,5n);
    result.flows.push({act,goalId:f.goalId,sourcePayment:f.transactions[`pay-${n}`],settlement:f.transactions.settle,winningRound:n,winner,fromGuarantee:event.args.fromGuarantee,creditBefore:creditsBefore,creditAfter:creditsAfter,invariantBefore:[...invBefore],invariantAfter:[...invAfter],historicalRpcDeltaVerified:true});
  }
  const duplicate=read('duplicate-payment');const rejected=await providers.sepolia.getTransactionReceipt(duplicate.hash);assert.equal(rejected.status,0);
  result.duplicate={hash:duplicate.hash,onChainStatus:rejected.status,recordedRecipientUnchanged:duplicate.recipientUnchanged,recordedPayerUnchanged:duplicate.payerUSDCUnchanged};
  const token=new Contract(deployment.configuration.usdc,['function balanceOf(address) view returns(uint256)'],providers.sepolia);
  result.recipientUSDC=await token.balanceOf(addressOf('recipient'));assert.equal(result.recipientUSDC,300000n);
  result.allChecksPassed=true;save('audit',result);console.log('All three source winners, historical CTC allocation deltas, refund deltas, B/R invariants and duplicate revert verified directly against RPC.');
}catch(e){console.error(e.shortMessage??e.message);process.exitCode=1;}finally{close();}
