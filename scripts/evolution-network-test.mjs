import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Identity } from '../src/identity.js';

const root=path.resolve(import.meta.dirname,'..');
const base=fs.mkdtempSync(path.join(os.tmpdir(),'neural-mesh-evo-net-'));
const pass='evo-net-password',token='evo-net-token';
const dirs={a:path.join(base,'a'),b:path.join(base,'b')};for(const d of Object.values(dirs))fs.mkdirSync(d,{recursive:true});
const ids={a:new Identity(dirs.a,{password:pass}),b:new Identity(dirs.b,{password:pass})};
const validators=`${ids.a.nodeId},${ids.b.nodeId}`;const procs=[];
function start(name,port,extra={}){const env={...process.env,PORT:String(port),HOST:'127.0.0.1',PUBLIC_URL:`http://127.0.0.1:${port}`,DATA_DIR:dirs[name],MOCK_LLM:'true',LLM_MODEL:'mock-neuron',DISCOVERY_ENABLED:'false',MAINLINE_DHT_ENABLED:'false',ZERO_TOUCH_ENABLED:'false',ADMISSION_POW_BITS:'4',WORK_POW_BITS:'4',WALLET_PASSWORD:pass,NODE_KEY_PASSWORD:pass,ALLOW_INSECURE_KEYSTORE:'false',BOOTSTRAP_VALIDATOR_IDS:validators,VALIDATOR_COUNT:'2',VALIDATOR_QUORUM:'2',API_TOKEN:token,ALLOW_UNAUTHENTICATED_LOCAL:'false',EVOLUTION_ENABLED:'true',EVOLUTION_AUTO:'false',EVOLUTION_LLM_PROPOSALS:'false',...extra};const p=spawn(process.execPath,['src/index.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});let logs='';p.stdout.on('data',d=>logs+=d);p.stderr.on('data',d=>logs+=d);p._logs=()=>logs;procs.push(p);return p;}
const A='http://127.0.0.1:49031',B='http://127.0.0.1:49032';
start('a',49031,{RELAY_ENABLED:'true'});start('b',49032,{PRIVATE_NODE:'true',PUBLIC_URL:'',BOOTSTRAP_PEERS:A,RELAY_PEERS:A});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(u){const r=await fetch(u);const x=await r.json();if(!r.ok)throw new Error(`${u} ${r.status}: ${JSON.stringify(x)}`);return x;}
async function post(u,obj){const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(obj)});const x=await r.json();if(!r.ok)throw new Error(`${u} ${r.status}: ${JSON.stringify(x)}`);return x;}
try{
  await sleep(3500);const sb=await get(B+'/api/status');if(sb.stats.peers<1)throw new Error('peer discovery failed');
  const p=await post(A+'/api/evolution/propose',{reason:'network-test',useLlm:false});const id=p.candidate.genomeId;if(!id)throw new Error('proposal did not produce genome');
  await sleep(800);const cb=await get(B+'/api/evolution/candidates');if(!cb.genomes.some(g=>g.genomeId===id))throw new Error('candidate did not propagate to peer');
  const canary=await post(B+'/api/evolution/canary',{genomeId:id});if(canary.canary.genomeId!==id)throw new Error('imported candidate cannot enter canary');
  const eb=await get(B+'/api/evolution');if(eb.canary?.genomeId!==id||!eb.constitution?.hash)throw new Error('evolution status missing canary/constitution');
  console.log('EVOLUTION NETWORK V0.7 OK',{peers:sb.stats.peers,candidate:id.slice(0,16),propagatedViaRelay:true,endToEndAuthorProof:true,remoteCanary:true,constitution:eb.constitution.hash.slice(0,16)});
}catch(e){console.error(e);for(const p of procs)console.error(p._logs());process.exitCode=1;}finally{for(const p of procs)p.kill('SIGTERM');await sleep(500);}
