import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonical, Identity } from './identity.js';

export function leadingZeroBits(hex){
  const b=Buffer.from(hex,'hex');let n=0;for(const x of b){if(x===0){n+=8;continue;}for(let bit=7;bit>=0;bit--){if((x&(1<<bit))===0)n++;else return n;}}return n;
}
function admissionHash(networkId,nodeId,nonce){return crypto.createHash('sha256').update(`${networkId}:${nodeId}:${nonce}`).digest('hex');}
export function verifyAdmission(proof,networkId,nodeId,minBits){
  if(!proof||proof.networkId!==networkId||proof.nodeId!==nodeId||!Number.isSafeInteger(Number(proof.nonce)))return false;
  const h=admissionHash(networkId,nodeId,proof.nonce);return h===proof.hash&&leadingZeroBits(h)>=minBits;
}
export function ensureAdmission(dataDir,networkId,nodeId,bits){
  const f=path.join(dataDir,'admission.json');
  try{const x=JSON.parse(fs.readFileSync(f,'utf8'));if(verifyAdmission(x,networkId,nodeId,bits))return x;}catch{}
  let nonce=0,hash='';while(true){hash=admissionHash(networkId,nodeId,nonce);if(leadingZeroBits(hash)>=bits)break;nonce++;}
  const p={version:1,networkId,nodeId,nonce,hash,bits,createdAt:Date.now()};fs.writeFileSync(f,JSON.stringify(p,null,2),{mode:0o600});return p;
}

export function computeWorkPow({networkId,taskId,challenge,nodeId,content,bits}){
  const contentHash=crypto.createHash('sha256').update(String(content)).digest('hex');let nonce=0,hash='';
  while(true){hash=crypto.createHash('sha256').update(`${networkId}:${taskId}:${challenge}:${nodeId}:${contentHash}:${nonce}`).digest('hex');if(leadingZeroBits(hash)>=bits)break;nonce++;}
  return {version:1,networkId,taskId,challenge,nodeId,contentHash,nonce,hash,bits};
}
export function verifyWorkPow(pow,{networkId,taskId,challenge,nodeId,content,minBits}){
  if(!pow||pow.networkId!==networkId||pow.taskId!==taskId||pow.challenge!==challenge||pow.nodeId!==nodeId||Number(pow.bits)<minBits)return false;
  const contentHash=crypto.createHash('sha256').update(String(content)).digest('hex');if(pow.contentHash!==contentHash)return false;
  const hash=crypto.createHash('sha256').update(`${networkId}:${taskId}:${challenge}:${nodeId}:${contentHash}:${pow.nonce}`).digest('hex');return hash===pow.hash&&leadingZeroBits(hash)>=minBits;
}

export class ReplayGuard{
  constructor(windowMs=600000){this.windowMs=windowMs;this.seen=new Map();}
  inspect(env,maxSkewMs=300000){
    if(!Identity.verifyEnvelope(env,maxSkewMs))return {ok:false,status:'invalid'};
    const key=`${env.nodeId}:${env.nonce}`,now=Date.now();
    for(const [k,t] of this.seen)if(now-t>this.windowMs)this.seen.delete(k);
    if(this.seen.has(key))return {ok:false,status:'duplicate',firstSeenAt:this.seen.get(key)};
    this.seen.set(key,now);return {ok:true,status:'valid'};
  }
  verify(env,maxSkewMs=300000){return this.inspect(env,maxSkewMs).ok;}
}

export class RateLimiter{
  constructor(windowMs=60000){this.windowMs=windowMs;this.buckets=new Map();}
  allow(key,limit){const now=Date.now();let b=this.buckets.get(key);if(!b||now-b.start>=this.windowMs)b={start:now,count:0};b.count++;this.buckets.set(key,b);return b.count<=limit;}
}

export function deterministicCommittee(seed,candidates,size){
  const unique=[...new Map((candidates||[]).filter(Boolean).map(x=>[typeof x==='string'?x:x.nodeId,x])).entries()].map(([nodeId,x])=>typeof x==='string'?{nodeId}:x);
  return unique.map(v=>({v,h:crypto.createHash('sha256').update(`${seed}:${v.nodeId}`).digest('hex')})).sort((a,b)=>a.h.localeCompare(b.h)).slice(0,Math.max(1,Math.min(size,unique.length))).map(x=>x.v);
}
export function quorumFor(n){return n<=1?1:Math.floor((2*n)/3)+1;}
export function hashObject(x){return crypto.createHash('sha256').update(canonical(x)).digest('hex');}

export function descriptorBody(d){
  return {
    descriptorVersion:Number(d?.descriptorVersion||1),networkId:d?.networkId||'',nodeId:d?.nodeId||'',url:d?.url||'',relayUrl:d?.relayUrl||'',publicKey:d?.publicKey||'',rewardAddress:d?.rewardAddress||'',capabilities:Array.isArray(d?.capabilities)?d.capabilities:[],hardware:d?.hardware||{},model:d?.model||'',provider:d?.provider||'',protocolVersion:d?.protocolVersion||'',listenPort:Number(d?.listenPort)||0,relayCapable:!!d?.relayCapable,admission:d?.admission||{},issuedAt:Number(d?.issuedAt)||0
  };
}

export function verifyDescriptor(d,networkId,minBits){
  try{
    if(!d||d.networkId!==networkId||!d.nodeId||!d.publicKey||!d.descriptorSignature)return false;
    const key=crypto.createPublicKey(d.publicKey);const der=key.export({type:'spki',format:'der'});const nodeId=crypto.createHash('sha256').update(der).digest('hex');if(nodeId!==d.nodeId)return false;
    if(!verifyAdmission(d.admission,networkId,d.nodeId,minBits))return false;
    return crypto.verify(null,Buffer.from(canonical(descriptorBody(d))),key,Buffer.from(d.descriptorSignature,'base64'));
  }catch{return false;}
}
