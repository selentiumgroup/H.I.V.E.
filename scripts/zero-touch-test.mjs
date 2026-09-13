import {spawn} from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {bencode,bdecode,text} from '../src/discovery/bencode.js';
import {Identity} from '../src/identity.js';

const root=path.resolve(import.meta.dirname,'..');const base=fs.mkdtempSync(path.join(os.tmpdir(),'neural-mesh-zerotouch-'));const procs=[];const pass='zero-touch-password';
function compact(ip,port){const b=Buffer.alloc(6);ip.split('.').map(Number).forEach((x,i)=>b[i]=x);b.writeUInt16BE(port,4);return b;}
const router=dgram.createSocket('udp4');const peers=new Map();const token=Buffer.from('nm-token');const routerId=crypto.randomBytes(20);
router.on('message',(msg,rinfo)=>{try{const q=bdecode(msg);if(text(q.y)!=='q')return;const name=text(q.q),a=q.a||{};let r={id:routerId};if(name==='get_peers'){r={...r,token,values:[...peers.values()].map(x=>compact(x.host,x.port))};}else if(name==='announce_peer'){if(Buffer.compare(a.token,token)!==0)return;peers.set(`${rinfo.address}:${a.port}`,{host:rinfo.address,port:Number(a.port)});}router.send(bencode({t:q.t,y:'r',r}),rinfo.port,rinfo.address);}catch{}});
await new Promise(r=>router.bind(0,'127.0.0.1',r));const dhtPort=router.address().port;
const dirs={a:path.join(base,'a'),b:path.join(base,'b')};for(const d of Object.values(dirs))fs.mkdirSync(d,{recursive:true});const ids={a:new Identity(dirs.a,{password:pass}),b:new Identity(dirs.b,{password:pass})};const validators=`${ids.a.nodeId},${ids.b.nodeId}`;
function start(name,port){const env={...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:dirs[name],MOCK_LLM:'true',LLM_MODEL:'mock-neuron',DISCOVERY_ENABLED:'false',ZERO_TOUCH_ENABLED:'true',MAINLINE_DHT_ENABLED:'true',MAINLINE_DHT_BOOTSTRAP:`127.0.0.1:${dhtPort}`,MAINLINE_ROUNDS:'0',MAINLINE_LOOKUP_MS:'800',MAINLINE_QUERY_TIMEOUT_MS:'500',MAINLINE_ALLOW_PRIVATE_CANDIDATES:'true',ADMISSION_POW_BITS:'4',WORK_POW_BITS:'4',WALLET_PASSWORD:pass,NODE_KEY_PASSWORD:pass,ALLOW_INSECURE_KEYSTORE:'false',BOOTSTRAP_VALIDATOR_IDS:validators,VALIDATOR_COUNT:'2',VALIDATOR_QUORUM:'2',MAX_REMOTE_WORKERS:'1',API_TOKEN:'zt',ALLOW_UNAUTHENTICATED_LOCAL:'true'};delete env.PUBLIC_URL;delete env.BOOTSTRAP_PEERS;delete env.RELAY_PEERS;const p=spawn(process.execPath,['src/index.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});let logs='';p.stdout.on('data',d=>logs+=d);p.stderr.on('data',d=>logs+=d);p._logs=()=>logs;procs.push(p);return p;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function get(u){const r=await fetch(u);if(!r.ok)throw new Error(`${u}: ${r.status}`);return r.json();}
try{
  start('a',48931);await sleep(1200);start('b',48932);await sleep(4500);
  const sb=await get('http://127.0.0.1:48932/api/status');if(sb.stats.peers<1)throw new Error(`zero-touch discovery failed: ${sb.stats.peers} peers`);if(!sb.discovery?.mainline?.enabled)throw new Error('mainline rendezvous not enabled');
  const r=await fetch('http://127.0.0.1:48932/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:'zero touch mesh test'})});const chat=await r.json();if(!r.ok||chat.route?.length<2)throw new Error(`distributed inference did not use discovered peer: ${JSON.stringify(chat)}`);
  console.log('ZERO-TOUCH V0.7 OK',{peers:sb.stats.peers,neurons:chat.route.length,manualBootstrapPeers:0,manualPublicUrl:false,rendezvous:'BEP-5/Mainline-compatible'});
}catch(e){console.error(e);for(const p of procs)console.error(p._logs());process.exitCode=1;}finally{for(const p of procs)p.kill('SIGTERM');router.close();await sleep(500);}
