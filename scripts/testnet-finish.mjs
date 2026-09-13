// One writer at a time. Retries only explicit, retriable proof-service responses.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function run(act,step){return new Promise(resolve=>{
  const child=spawn(process.execPath,['scripts/testnet-flow.mjs',act,step],{stdio:['ignore','inherit','inherit']});
  child.on('exit',code=>resolve(code));
});}
for(const act of ['normal','late','relay']){
  for(;;){
    console.log(`${new Date().toISOString()} ${act}: requesting original anchor proof`);
    if(await run(act,'prove')===0)break;
    let response;try{response=JSON.parse(fs.readFileSync(`evidence/testnet/flow-${act}-prover-response.json`));}catch{}
    if(response?.retriable!==true)throw Error(`${act}: non-retriable failure; inspect original output before continuing`);
    console.log(`${act}: ${response.code}; wait 45 seconds, retain the same source transaction`);
    await delay(45000);
  }
  if(await run(act,'settle')!==0)throw Error(`${act}: settlement failed; inspect checkpoint`);
  console.log(`${act}: official proof and money settlement completed`);
}
