import crypto from 'node:crypto';
import { canonical, Identity } from './identity.js';
import { isValidAddress, parseNRN, formatNRN } from './wallet.js';

export const MAX_SUPPLY_NRN=86_000_000_000;
export const MAX_SUPPLY_ATOMIC=86_000_000_000n*100_000_000n;
export const HALVING_YEARS=4;
export const GENESIS_TIME_MS=Date.parse('2026-09-13T00:00:00Z');
const YEAR_MS=365.25*24*60*60*1000;

export function currentEra(ts=Date.now()){return Math.max(0,Math.floor((ts-GENESIS_TIME_MS)/(HALVING_YEARS*YEAR_MS)));}
export function eraMultiplier(ts=Date.now()){return 2**(-currentEra(ts));}
export function deterministicWorkScore({outputChars=0,quality=1}){const useful=Math.min(8,Math.max(0.1,outputChars/800));const q=Math.max(.1,Math.min(1,Number(quality)||1));return Number((useful*q).toFixed(6));}
export function rewardForScore(score,rewardPerScore=0.01,ts=Date.now()){return Number((score*rewardPerScore*eraMultiplier(ts)).toFixed(8));}
function claimBody(x){return {version:x.version,networkType:x.networkType,taskId:x.taskId,workerId:x.workerId,workerRewardAddress:x.workerRewardAddress,originId:x.originId,originPublicKey:x.originPublicKey,originRewardAddress:x.originRewardAddress,workerProof:x.workerProof,consensusHeight:x.consensusHeight,consensusHash:x.consensusHash,score:x.score,grossNrn:x.grossNrn,grossAtomic:x.grossAtomic,era:x.era,createdAt:x.createdAt};}
export function makeClaim(identity,{taskId,workerProof,score,grossNrn,originRewardAddress,consensusHeight,consensusHash}){
  const workerRewardAddress=workerProof?.payload?.rewardAddress;if(!isValidAddress(workerRewardAddress)||!isValidAddress(originRewardAddress))throw new Error('claim has invalid reward address');
  const body={version:4,networkType:'neural-work',taskId,workerId:workerProof.nodeId,workerRewardAddress,originId:identity.nodeId,originPublicKey:identity.publicPem,originRewardAddress,workerProof,consensusHeight:Number(consensusHeight),consensusHash:String(consensusHash),score,grossNrn:Number(grossNrn),grossAtomic:parseNRN(Number(grossNrn).toFixed(8)).toString(),era:currentEra(),createdAt:Date.now()};
  const claimId=crypto.createHash('sha256').update(canonical(body)).digest('hex');return {...body,claimId,originSignature:identity.sign(body)};
}
export function verifyClaim(claim,networkId){
  try{
    if(claim?.version!==4||!claim?.workerProof||!Identity.verifyEnvelope(claim.workerProof,Infinity))return false;
    if(claim.workerProof.payload?.networkId!==networkId||claim.workerProof.payload?.type!=='work-result')return false;
    if(claim.workerProof.payload?.taskId!==claim.taskId||claim.workerProof.nodeId!==claim.workerId)return false;
    if(!Number.isInteger(Number(claim.consensusHeight))||!/^[0-9a-f]{64}$/i.test(claim.consensusHash||''))return false;
    if(claim.workerProof.payload?.rewardAddress!==claim.workerRewardAddress||!isValidAddress(claim.workerRewardAddress)||!isValidAddress(claim.originRewardAddress))return false;
    if(Math.abs(Number(claim.createdAt)-Number(claim.workerProof.ts))>10*60_000)return false;
    const body=claimBody(claim);if(!claim.claimId||!claim.originSignature||!body.originPublicKey)return false;
    const expected=crypto.createHash('sha256').update(canonical(body)).digest('hex');if(expected!==claim.claimId)return false;
    const key=crypto.createPublicKey(body.originPublicKey);const der=key.export({type:'spki',format:'der'});const originId=crypto.createHash('sha256').update(der).digest('hex');if(originId!==body.originId)return false;
    if(BigInt(claim.grossAtomic)!==parseNRN(Number(claim.grossNrn).toFixed(8)))return false;
    return crypto.verify(null,Buffer.from(canonical(body)),key,Buffer.from(claim.originSignature,'base64'));
  }catch{return false;}
}
function shareAtomic(total,share){const ppm=BigInt(Math.max(0,Math.min(1_000_000,Math.round(Number(share)*1_000_000))));return total*ppm/1_000_000n;}
function alloc(address,nodeId,role,atomic){return {address,nodeId,role,atomic:atomic.toString(),nrn:formatNRN(atomic)};}
export function finalizeClaim(claim,votes,shares){
  const approved=votes.filter(v=>v?.payload?.approved&&v.payload?.claimId===claim.claimId&&isValidAddress(v.payload?.rewardAddress)&&Identity.verifyEnvelope(v,Infinity));
  const validators=[...new Map(approved.map(v=>[v.nodeId,{nodeId:v.nodeId,address:v.payload.rewardAddress}])).values()].sort((a,b)=>a.nodeId.localeCompare(b.nodeId));
  const gross=BigInt(claim.grossAtomic);const worker=shareAtomic(gross,shares.worker);const router=shareAtomic(gross,shares.router);const validatorPool=gross-worker-router;const base=validators.length?validatorPool/BigInt(validators.length):0n;let remainder=validators.length?validatorPool%BigInt(validators.length):validatorPool;
  const allocations=[alloc(claim.workerRewardAddress,claim.workerId,'worker',worker),alloc(claim.originRewardAddress,claim.originId,'router',router),...validators.map((v,i)=>{const x=base+(BigInt(i)<remainder?1n:0n);return alloc(v.address,v.nodeId,'validator',x);})];
  return {...claim,votes:approved,allocations};
}
