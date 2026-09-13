// Real testnet expiry-path harness. Run one step at a time; never re-broadcasts a checkpointed tx.
import fs from 'node:fs';
import {id,parseEther,AbiCoder,Contract,keccak256} from 'ethers';
import assert from 'node:assert/strict';
import proofs from '../lib/local/proofs.cjs';
import {directory,read,save,wallet,providers,contract,assertChains,transaction,close} from './testnet-runtime.mjs';
const step=process.argv[2]||'start'; const file='flow-expiry';
const s=fs.existsSync(`${directory}/${file}.json`)?read(file):{file,createdAt:new Date().toISOString(),transactions:{},snapshots:[]};
const escrow=contract('StateLiftGoalEscrow','operator'),router=contract('GoalRouter','executor'),verifier=contract('GoalFillFactVerifier'),inbox=contract('RootInbox');
const R=parseEther('0.1'), premium=parseEther('0.0006'), owner=wallet('operator','creditcoin').address;
const tx=(l,c,f)=>transaction(s,l,c,f); const snap=async l=>{const b=await escrow.invariant();const r=await escrow.getRound(await escrow.roundIdOf(s.goalId,1));s.snapshots.push({label:l,at:new Date().toISOString(),invariant:b.map(String),round:{state:String(r.state),principalReturned:String(r.principalReturned),guarantee:String(r.guarantee),payBy:String(r.payBy),clearBy:String(r.clearBy)}});save(file,s);};
async function open(){const now=Number((await providers.creditcoin.getBlock('latest')).timestamp);const q={goalId:s.goalId,roundNumber:1,guarantor:wallet('guarantor','creditcoin').address,payBy:now+180,clearBy:now+240,principal:R.toString(),guarantee:R.toString(),premium:premium.toString(),acceptBefore:now+120,guarantorNonce:Date.now()};const types={RoundQuote:[['goalId','bytes32'],['roundNumber','uint32'],['guarantor','address'],['payBy','uint64'],['clearBy','uint64'],['principal','uint256'],['guarantee','uint256'],['premium','uint256'],['acceptBefore','uint64'],['guarantorNonce','uint256']].map(([name,type])=>({name,type}))};const sig=await wallet('guarantor','creditcoin').signTypedData({name:'StateLiftGoalEscrow',version:'1',chainId:102031,verifyingContract:await escrow.getAddress()},types,q);s.quote=q;save(file,s);await tx('open-1','creditcoin',()=>escrow.openRound(q,sig,{value:R+premium}));}
try{await assertChains();if(step==='start'){s.terms={businessRef:id(`StateLift:expiry:${s.createdAt}`),token:'0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',recipient:wallet('recipient','sepolia').address,amount:'100000'};s.goalId=await escrow.goalIdOf(owner,s.terms);s.ref={ctcChainId:102031,escrow:await escrow.getAddress(),owner,...s.terms};await tx('create','creditcoin',()=>escrow.createGoal(s.terms,3));await tx('capital','creditcoin',()=>contract('StateLiftGoalEscrow','guarantor').depositCapital({value:R}));await open();await snap('round-open-unpaid');}else if(step==='refund'){const r=await escrow.getRound(await escrow.roundIdOf(s.goalId,1));if(BigInt((await providers.creditcoin.getBlock('latest')).timestamp)<r.clearBy)throw Error('D not reached; rerun later');await tx('refund-1','creditcoin',()=>escrow.claimRefund(escrow.roundIdOf(s.goalId,1)));await snap('R-returned-B-locked');}else if(step==='prove'){let sourceBlock=s.anchorSourceBlock;
 if(!sourceBlock){
  const latest=await providers.sepolia.getBlock('latest'); sourceBlock=latest.number-1; // Leave room for the anchor tx to land in a later source block.
  if(sourceBlock < 1) throw Error('source chain too short'); s.anchorSourceBlock=sourceBlock; save(file,s);
 }
 // A same-block anchor cannot be accepted: RootInbox requires header.height < anchorHeight.
 // If an earlier checkpoint landed in the chosen source block, discard only that
 // checkpoint and anchor a fresh source height one block behind the tip.
 if (s.transactions?.['anchor-expiry']) {
  const prior = await providers.sepolia.getTransactionReceipt(s.transactions['anchor-expiry'].hash);
  if (prior && Number(prior.blockNumber) <= Number(sourceBlock)) {
   delete s.transactions['anchor-expiry']; delete s.anchorSourceBlock;
   sourceBlock = (await providers.sepolia.getBlockNumber()) - 1;
   s.anchorSourceBlock = sourceBlock; save(file,s);
  }
 }
 await tx('anchor-expiry','sepolia',()=>contract('HeaderAnchor').anchor(sourceBlock,{gasLimit:100000}));
 // The anchor transaction is checkpointed; always derive the exact source height from its calldata if needed.
 if(!s.anchorSourceBlock){ const atx=await providers.sepolia.getTransaction(s.transactions['anchor-expiry'].hash); sourceBlock=Number(new AbiCoder().decode(['uint64'],`0x${atx.data.slice(10)}`)[0]); s.anchorSourceBlock=sourceBlock; save(file,s); }
 const block=await providers.sepolia.send('eth_getBlockByNumber',['0x'+Number(sourceBlock).toString(16),true]);
 const url=`https://prover.cc3-testnet.creditcoin.network/api/v1/proof-by-tx/1/${s.transactions['anchor-expiry'].hash}`; const response=await fetch(url,{signal:AbortSignal.timeout(45000)}); const raw=await response.text(); fs.writeFileSync(`${directory}/${file}-prover-response.json`,raw); if(!response.ok) throw Error(`Prover HTTP ${response.status}`); const proof=JSON.parse(raw);
 const abi=JSON.parse(fs.readFileSync('research/sdk/package/dist/block-prover/block_prover.json')); const native=new Contract('0x0000000000000000000000000000000000000FD2',abi,providers.creditcoin); const verify='verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))'; assert.equal(await native[verify](1,proof.headerNumber,proof.txBytes,proof.merkleProof,proof.continuityProof),true); const header=proofs.headerRlp(block); assert.equal(keccak256(header),block.hash); await tx('accept-root','creditcoin',()=>inbox.accept(proof.headerNumber,proof.txBytes,proof.merkleProof,proof.continuityProof,header));
 const slot=await verifier.fillSlot(s.goalId);const sp=await proofs.stateProof((m,p)=>providers.sepolia.send(m,p),await router.getAddress(),[slot],sourceBlock);const ev={goalId:s.goalId,blockHash:block.hash,accountProof:sp.accountProof,slotProof:sp.storageProof[0].proof};const fact=await verifier.proveUnfilled(ev);s.unfilled={evidence:ev,fact:{goalId:fact.goalId,sourceTimestamp:fact.sourceTimestamp,sourceHeight:fact.sourceHeight}};save(file,s);await snap('unfilled-fact-proven');}else if(step==='release'){if(!s.unfilled)throw Error('run prove first');const enc=new AbiCoder().encode(['tuple(bytes32 goalId,bytes32 blockHash,bytes[] accountProof,bytes32[] slotProof)'],[[s.unfilled.evidence.goalId,s.unfilled.evidence.blockHash,s.unfilled.evidence.accountProof,s.unfilled.evidence.slotProof]]);await tx('release-expiry','creditcoin',()=>escrow.releaseGuaranteeByExpiry(escrow.roundIdOf(s.goalId,1),enc));await snap('B-released-by-expiry');}else throw Error('step start|refund|prove|release');}catch(e){console.error(e.shortMessage??e.message);process.exitCode=1}finally{close()}
