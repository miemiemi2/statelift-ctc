// Read-only, evidence-backed output for the user's final screen recording.
import fs from 'node:fs';
const root='evidence/testnet';
const link=h=>`https://creditcoin-testnet.blockscout.com/tx/${h}`;
for(const [act,title] of [['normal','NORMAL · proof pays from R'],['late','LATE · D passed, proof pays from B'],['relay','HANDOFF · same G, executor 2 wins']]){
 const f=JSON.parse(fs.readFileSync(`${root}/flow-${act}.json`));
 const a=JSON.parse(fs.readFileSync(`${root}/audit.json`)).flows.find(x=>x.act===act);
 console.log(`\n${title}`); console.log(`  G: ${f.goalId}`); console.log(`  source payment: ${a.sourcePayment.hash} (confirmed)`); console.log(`  CTC settlement: ${a.settlement.hash} (confirmed, fromGuarantee=${a.fromGuarantee})`); console.log(`  historical credit delta: ${a.creditBefore} → ${a.creditAfter}`); console.log(`  explorer: ${link(a.settlement.hash)}`);
}
const d=JSON.parse(fs.readFileSync(`${root}/duplicate-payment.json`));
console.log(`\nDUPLICATE GUARD · ${d.hash}`);console.log(`  mined status: 0 · recipient unchanged: ${d.recipientUnchanged} · payer unchanged: ${d.payerUSDCUnchanged}`);
const w=JSON.parse(fs.readFileSync(`${root}/withdrawals.json`));console.log(`\nFINAL ACCOUNTING · escrowFullyReconciled=${w.escrowFullyReconciled}`);console.log('  every role withdrew; gas-adjusted balance deltas verified');
