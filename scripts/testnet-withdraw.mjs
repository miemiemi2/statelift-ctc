// Materialize all confirmed credit ownership in role wallets after all acts end.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {parseEther} from 'ethers';
import {directory,read,save,wallet,providers,contract,assertChains,transaction,close} from './testnet-runtime.mjs';
const s=fs.existsSync(`${directory}/withdrawals.json`)?read('withdrawals'):{file:'withdrawals',roles:{}};
try{
  await assertChains();
  const escrow=contract('StateLiftGoalEscrow');
  for(const act of ['normal','late','relay']) {
    const goal=await escrow.getGoal(read(`flow-${act}`).goalId);
    assert.equal(goal.state,2n,`${act} must be settled before cash out`);
  }
  const inv=await escrow.invariant();assert.equal(inv[1],0n);assert.equal(inv[3],0n,'all dedicated B must be resolved');
  for(const role of ['executor','executor2'])await transaction(s,`gas-${role}`,'creditcoin',()=>wallet('deployer','creditcoin').sendTransaction({to:wallet(role,'creditcoin').address,value:parseEther('0.05')}));
  if(!s.capital)s.capital=(await escrow.capitalAvailable(wallet('guarantor','creditcoin').address)).toString();save(s.file,s);
  await transaction(s,'capital','creditcoin',()=>contract('StateLiftGoalEscrow','guarantor').withdrawCapital(s.capital));
  for(const role of ['operator','guarantor','executor','executor2']) {
    const address=wallet(role,'creditcoin').address;
    if(!s.roles[role]) {s.roles[role]={address,creditBefore:await escrow.credits(address),nativeBefore:await providers.creditcoin.getBalance(address)};save(s.file,s);}
    const receipt=await transaction(s,`withdraw-${role}`,'creditcoin',()=>contract('StateLiftGoalEscrow',role).withdraw(address));
    const r=s.roles[role];r.nativeAfter=await providers.creditcoin.getBalance(address,receipt.blockNumber);r.creditAfter=await escrow.credits(address);r.gasCost=receipt.gasUsed*receipt.gasPrice;
    assert.equal(r.nativeAfter+BigInt(r.gasCost),BigInt(r.nativeBefore)+BigInt(r.creditBefore));assert.equal(r.creditAfter,0n);save(s.file,s);
  }
  const end=await escrow.invariant();for(const value of end)assert.equal(value,0n);
  s.escrowFullyReconciled=true;s.finalInvariant=[...end];save(s.file,s);console.log('All credits paid to role wallets; gas-adjusted balance deltas verified; escrow reconciles to zero.');
}catch(e){console.error(e.shortMessage??e.message);process.exitCode=1;}finally{close();}
