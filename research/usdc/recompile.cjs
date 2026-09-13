const fs=require('node:fs'),path=require('node:path'),solc=require('solc-0612'),{keccak256}=require('ethers');
const here=__dirname,source=JSON.parse(fs.readFileSync(path.join(here,'implementation-sourcify.json'))),input=structuredClone(source.stdJsonInput);
input.settings.outputSelection={'*':{'*':['storageLayout','evm.deployedBytecode.object']}};
const output=JSON.parse(solc.compile(JSON.stringify(input))),errors=output.errors?.filter(e=>e.severity==='error')??[];
if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
const [file,name]=source.compilation.fullyQualifiedName.split(':');const compiled=output.contracts[file][name];
const layout=compiled.storageLayout.storage.find(s=>s.label==='_authorizationStates');if(!layout)throw Error('missing authorization mapping');
const runtime='0x'+compiled.evm.deployedBytecode.object,onchain=source.runtimeBytecode.onchainBytecode;
function withoutMetadata(hex){const bytes=(hex.length-2)/2,n=parseInt(hex.slice(-4),16);if(n+2>bytes)throw Error('invalid Solidity metadata tail');return hex.slice(0,hex.length-(n+2)*2);}
const result={observedAt:new Date().toISOString(),compiler:solc.version(),implementation:source.address,authorizationMapping:layout,exactRuntimeMatch:runtime.toLowerCase()===onchain.toLowerCase(),executableMatchIgnoringMetadata:withoutMetadata(runtime).toLowerCase()===withoutMetadata(onchain).toLowerCase(),recompiledRuntimeHash:keccak256(runtime),observedRuntimeHash:keccak256(onchain),scope:'Independent source recompilation with published settings. Snapshot runtime was separately compared to Ethereum RPC. This does not prove no malicious interval upgrade.'};
fs.writeFileSync(path.join(here,'recompile-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
if(!result.executableMatchIgnoringMetadata||layout.slot!=='16')process.exitCode=1;
