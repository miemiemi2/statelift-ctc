import fs from 'node:fs';
import {Contract,parseEther} from 'ethers';
import {directory,read,save,wallet,assertChains,transaction,close} from './testnet-runtime.mjs';
const state=fs.existsSync(`${directory}/roles.json`)?read('roles'):{file:'roles',roles:{}};
try {
  await assertChains();
  const usdc=new Contract('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',['function transfer(address,uint256) returns(bool)'],wallet('deployer','sepolia'));
  for(const role of ['operator','guarantor','executor','executor2','recipient']) state.roles[role]=wallet(role,'sepolia').address;
  save('roles',state);
  for(const role of ['operator','guarantor'])await transaction(state,`${role}-ctc`,'creditcoin',()=>wallet('deployer','creditcoin').sendTransaction({to:state.roles[role],value:parseEther('5')}));
  for(const role of ['executor','executor2']) {
    await transaction(state,`${role}-eth`,'sepolia',()=>wallet('deployer','sepolia').sendTransaction({to:state.roles[role],value:parseEther('0.002')}));
    await transaction(state,`${role}-usdc`,'sepolia',()=>usdc.transfer(state.roles[role],1_000_000n));
  }
}catch(e){console.error(e.shortMessage??e.message);process.exitCode=1;}finally{close();}
