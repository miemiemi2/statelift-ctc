import fs from 'node:fs';
import assert from 'node:assert/strict';
import {AbiCoder,Contract,Interface,id,keccak256,parseEther} from 'ethers';
import proofs from '../lib/local/proofs.cjs';
import {directory,read,save,wallet,providers,contract,assertChains,transaction,close} from './testnet-runtime.mjs';
const [act='normal',step='start']=process.argv.slice(2);
if(!['normal','late','relay'].includes(act))throw Error('act: normal | late | relay');
const file=`flow-${act}`;
const state=fs.existsSync(`${directory}/${file}.json`)?read(file):{file,act,createdAt:new Date().toISOString(),snapshots:[],rounds:{}};
const escrow=contract('StateLiftGoalEscrow','operator'),router=contract('GoalRouter','executor');
const inbox=contract('RootInbox'),verifier=contract('GoalFillFactVerifier');
const owner=wallet('operator','creditcoin').address, guarantor=wallet('guarantor','creditcoin').address;
const token='0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const usdc=new Contract(token,['function balanceOf(address) view returns(uint256)','function name() view returns(string)','function version() view returns(string)','function DOMAIN_SEPARATOR() view returns(bytes32)'],providers.sepolia);
const coder=AbiCoder.defaultAbiCoder();
const R=parseEther('0.1'),premium=parseEther('0.0006');
const tx=(label,chain,send)=>transaction(state,label,chain,send);
const snapshot=async(label)=>{
  const b=await escrow.invariant();
  assert.equal(b[0],b[1]+b[2]+b[3]+b[4]);
  const credits={};for(const role of ['operator','guarantor','executor','executor2'])credits[role]=await escrow.credits(wallet(role,'creditcoin').address);
  const rounds={};for(const n of Object.keys(state.rounds)){const r=await escrow.getRound(await escrow.roundIdOf(state.goalId,n));rounds[n]={state:r.state,principalReturned:r.principalReturned,principal:r.principal,guarantee:r.guarantee,premium:r.premium,payBy:r.payBy,clearBy:r.clearBy};}
  const entry={label,at:new Date().toISOString(),ctcBlock:await providers.creditcoin.getBlockNumber(),sourceBlock:await providers.sepolia.getBlockNumber(),invariant:{balance:b[0],heldR:b[1],availableB:b[2],lockedB:b[3],credits:b[4]},credits,rounds,recipientUSDC:await usdc.balanceOf(state.terms.recipient)};
  state.snapshots.push(entry);save(file,state);console.log(`snapshot: ${label}`);return entry;
};
async function open(n) {
  if(!state.rounds[n]) {
    const now=Number((await providers.creditcoin.getBlock('latest')).timestamp);
    const short=act!=='normal'&&n===1;
    state.rounds[n]={goalId:state.goalId,roundNumber:n,guarantor,payBy:now+(short?180:1800),clearBy:now+(short?240:7200),principal:R.toString(),guarantee:R.toString(),premium:premium.toString(),acceptBefore:now+600,guarantorNonce:Date.now()};save(file,state);
  }
  const quote=state.rounds[n];
  const types={RoundQuote:[['goalId','bytes32'],['roundNumber','uint32'],['guarantor','address'],['payBy','uint64'],['clearBy','uint64'],['principal','uint256'],['guarantee','uint256'],['premium','uint256'],['acceptBefore','uint64'],['guarantorNonce','uint256']].map(([name,type])=>({name,type}))};
  const signature=await wallet('guarantor','creditcoin').signTypedData({name:'StateLiftGoalEscrow',version:'1',chainId:102031,verifyingContract:await escrow.getAddress()},types,quote);
  await tx(`open-${n}`,'creditcoin',()=>escrow.openRound(quote,signature,{value:R+premium}));
}
async function pay(n,role) {
  const payer=wallet(role,'sepolia'),payBy=state.rounds[n].payBy;
  const nonce=await router.fillNonce(state.goalId,n,payer.address,payBy);
  const domain={name:await usdc.name(),version:await usdc.version(),chainId:11155111,verifyingContract:token};
  state.usdcDomain=domain;save(file,state);
  const signature=await payer.signTypedData(domain,{ReceiveWithAuthorization:[['from','address'],['to','address'],['value','uint256'],['validAfter','uint256'],['validBefore','uint256'],['nonce','bytes32']].map(([name,type])=>({name,type}))},{from:payer.address,to:await router.getAddress(),value:state.terms.amount,validAfter:0,validBefore:payBy+3600,nonce});
  const before=await usdc.balanceOf(state.terms.recipient);
  const already=!!state.transactions?.[`pay-${n}`];
  const receipt=await tx(`pay-${n}`,'sepolia',()=>contract('GoalRouter',role).fill(state.ref,n,payBy,payer.address,{from:payer.address,validAfter:0,validBefore:payBy+3600,signature}));
  if(!already)assert.equal(await usdc.balanceOf(state.terms.recipient),before+BigInt(state.terms.amount));
  state.paidRound=n;state.paymentBlock=receipt.blockNumber;state.paymentIndex=receipt.index;save(file,state);
  await snapshot(`paid-source-${n}-not-settled`);
  // Anchor payment block while BLOCKHASH is still available (256 block window).
  // Estimate against the latest block can see the payment block as current;
  // the anchor transaction executes in a later block. Fixed bounded gas avoids
  // that estimation race without changing the on-chain BLOCKHASH checks.
  await tx('anchor','sepolia',()=>contract('HeaderAnchor').anchor(receipt.blockNumber,{gasLimit:100000}));
}
async function prove() {
  if(!state.transactions?.anchor)throw Error('Need anchored payment first');
  const url=`https://prover.cc3-testnet.creditcoin.network/api/v1/proof-by-tx/1/${state.transactions.anchor.hash}`;
  const response=await fetch(url,{signal:AbortSignal.timeout(45000)});
  const raw=await response.text();
  fs.appendFileSync(`${directory}/${file}-prover-attempts.jsonl`,JSON.stringify({at:new Date().toISOString(),url,status:response.status,body:raw})+'\n');
  fs.writeFileSync(`${directory}/${file}-prover-response.json`,raw);
  if(!response.ok)throw Error(`Prover HTTP ${response.status}; keep anchor and retry proof later`);
  const proof=JSON.parse(raw);
  assert.equal(Number(proof.chainKey),1);assert.equal(proof.txHash.toLowerCase(),state.transactions.anchor.hash.toLowerCase());
  const abi=JSON.parse(fs.readFileSync('lib/proof/block_prover.json'));
  const native=new Contract('0x0000000000000000000000000000000000000FD2',abi,providers.creditcoin);
  const verify='verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))';
  assert.equal(await native[verify](1,proof.headerNumber,proof.txBytes,proof.merkleProof,proof.continuityProof),true);
  const mutated=proof.txBytes.slice(0,-2)+(proof.txBytes.endsWith('00')?'01':'00');
  let mutationRejected=false;
  try{mutationRejected=!(await native[verify](1,proof.headerNumber,mutated,proof.merkleProof,proof.continuityProof));}
  catch(e){if(e.code!=='CALL_EXCEPTION')throw e;mutationRejected=true;}
  assert.equal(mutationRejected,true,'native proof must bind the exact payload');
  save(`${file}-native-verification`,{verifiedAt:new Date().toISOString(),ctcBlock:await providers.creditcoin.getBlockNumber(),proofTransaction:proof.txHash,originalVerified:true,mutatedPayloadRejected:mutationRejected});
  const block=await providers.sepolia.send('eth_getBlockByNumber',['0x'+state.paymentBlock.toString(16),true]);
  const header=proofs.headerRlp(block);assert.equal(keccak256(header),block.hash);
  save(`${file}-source-block`,block);
  await tx('accept-root','creditcoin',()=>inbox.accept(proof.headerNumber,proof.txBytes,proof.merkleProof,proof.continuityProof,header));
  // Fetch all receipts once, preserving raw data and rebuilding the canonical MPT.
  const receipts=await providers.sepolia.send('eth_getBlockReceipts',['0x'+state.paymentBlock.toString(16)]);
  save(`${file}-source-receipts`,receipts);
  const lookup=new Map(receipts.map(r=>[r.transactionHash,r]));
  const call=(m,p)=>m==='eth_getTransactionReceipt'?Promise.resolve(lookup.get(p[0])):providers.sepolia.send(m,p);
  const rp=await proofs.receiptProof(call,state.paymentBlock,state.paymentIndex);
  state.evidence={blockHash:block.hash,transactionIndex:state.paymentIndex,receiptProof:rp.proof};
  const fact=await verifier.proveFill(state.evidence);
  assert.equal(fact.goalId,state.goalId);assert.equal(Number(fact.roundNumber),state.paidRound);
  state.fact={goalId:fact.goalId,roundNumber:fact.roundNumber,winner:fact.winner,amount:fact.amount,payBy:fact.payBy,sourceTimestamp:fact.sourceTimestamp};save(file,state);
  await snapshot('proof-valid-but-not-settled');
}
function encoded(){return coder.encode(['tuple(bytes32 blockHash,uint256 transactionIndex,bytes[] receiptProof)'],[state.evidence]);}
try {
  await assertChains();
  if(step==='start') {
    state.terms??={businessRef:id(`StateLift:testnet:${act}:${state.createdAt}`),token,recipient:wallet('recipient','sepolia').address,amount:'100000'};
    state.goalId=await escrow.goalIdOf(owner,state.terms);
    state.ref={ctcChainId:102031,escrow:await escrow.getAddress(),owner,...state.terms};
    assert.equal(await router.goalIdOf(state.ref),state.goalId);save(file,state);
    await tx('create','creditcoin',()=>escrow.createGoal(state.terms,3));
    await tx('capital','creditcoin',()=>contract('StateLiftGoalEscrow','guarantor').depositCapital({value:R*2n}));
    await open(1);await snapshot('round-1-open');
    if(act!=='relay')await pay(1,'executor');
  }else if(step==='refund') {
    const r=await escrow.getRound(await escrow.roundIdOf(state.goalId,1));
    const now=(await providers.creditcoin.getBlock('latest')).timestamp;
    if(BigInt(now)<r.clearBy)throw Error(`D has not arrived: ${r.clearBy}; current ${now}`);
    await tx('refund-1','creditcoin',()=>escrow.claimRefund(escrow.roundIdOf(state.goalId,1)));
    await snapshot('R1-returned-no-proof-B1-locked');
  }else if(step==='relay') {
    if(act!=='relay')throw Error('relay action is only for unpaid path');
    await open(2);await snapshot('round-2-open-same-G');await pay(2,'executor2');
  }else if(step==='prove')await prove();
  else if(step==='settle') {
    if(!state.evidence)throw Error('No authenticated evidence yet');
    if(!state.beforeSettlement){state.beforeSettlement=await snapshot('before-settlement');save(file,state);}
    const roundId=await escrow.roundIdOf(state.goalId,state.paidRound);
    await tx('settle','creditcoin',()=>contract('StateLiftGoalEscrow').settleRound(roundId,encoded()));
    const after=await snapshot('after-settlement');
    const winner=state.paidRound===2?'executor2':'executor';
    const before=state.beforeSettlement;
    assert.equal(BigInt(after.credits[winner])-BigInt(before.credits[winner]),R);
    if(act==='relay') {
      await tx('release-1','creditcoin',()=>contract('StateLiftGoalEscrow').releaseGuaranteeByWinner(escrow.roundIdOf(state.goalId,1),encoded()));
      await snapshot('old-B1-released-by-round-2-winner');
    }
  }else if(step==='status')await snapshot('status');
  else throw Error('step: start | refund | relay | prove | settle | status');
}catch(e){console.error(e.shortMessage??e.message);process.exitCode=1;}finally{close();}
