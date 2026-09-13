// Read-only preflight for the optional expiry flow. Never loads credentials.
import {Contract,formatEther} from 'ethers';
import {providers,addressOf,close,contract} from './testnet-public.mjs';

const roles=['operator','guarantor','executor','executor2','recipient'];
const ctc={};
for(const role of roles) ctc[role]={address:addressOf(role),native:formatEther(await providers.creditcoin.getBalance(addressOf(role)))};
const escrow=contract('StateLiftGoalEscrow');
ctc.escrow={address:await escrow.getAddress(),invariant:(await escrow.invariant()).map(String),guarantorAvailable:(await escrow.capitalAvailable(addressOf('guarantor'))).toString(),guarantorLocked:(await escrow.capitalLocked(addressOf('guarantor'))).toString()};
const token=new Contract('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',['function balanceOf(address) view returns(uint256)'],providers.sepolia);
const usdc={}; for(const role of ['executor','executor2','recipient']) usdc[role]=(await token.balanceOf(addressOf(role))).toString();
console.log(JSON.stringify({checkedAt:new Date().toISOString(),ctc,usdc},null,2));
close();
