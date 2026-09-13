import crypto from 'node:crypto';
import { canonical, Identity } from './identity.js';
import { quorumFor } from './security.js';

export const BFT_PHASES=Object.freeze({PREVOTE:'prevote',PRECOMMIT:'precommit'});

export function validatorSetRoot(validators=[]){
  const xs=(validators||[]).map(v=>typeof v==='string'?{nodeId:v,atomic:'0'}:{nodeId:v.nodeId,atomic:String(v.atomic??'0'),publicKey:v.publicKey||'',rewardAddress:v.rewardAddress||'',jailUntilHeight:Number(v.jailUntilHeight)||0}).sort((a,b)=>a.nodeId.localeCompare(b.nodeId));
  return crypto.createHash('sha256').update(canonical(xs)).digest('hex');
}

export function bftVoteId(vote){return crypto.createHash('sha256').update(canonical(vote)).digest('hex');}

export function verifyBftVote(vote,{networkId,phase,height,round,blockHash,prevHash,committee=[]}={}){
  if(!Identity.verifyEnvelope(vote,Infinity))return false;
  const p=vote.payload||{};
  if(p.type!=='bft-vote'||p.networkId!==networkId||p.phase!==phase||vote.nodeId!==p.validatorId)return false;
  if(Number(p.height)!==Number(height)||Number(p.round)!==Number(round)||p.blockHash!==blockHash||p.prevHash!==prevHash||!p.approved)return false;
  return committee.includes(vote.nodeId);
}

export function uniqueBftVotes(votes,opts){const m=new Map();for(const v of votes||[])if(verifyBftVote(v,opts))m.set(v.nodeId,v);return [...m.values()];}

export function verifyBftCertificate(block){
  const committee=block.committee||[],threshold=Number(block.threshold)||quorumFor(committee.length),cert=block.consensusCertificate||{};
  const common={networkId:block.networkId,height:block.index,round:block.round,blockHash:block.hash,prevHash:block.prevHash,committee};
  const prevotes=uniqueBftVotes(cert.prevotes||[],{...common,phase:BFT_PHASES.PREVOTE});
  const precommits=uniqueBftVotes(cert.precommits||[],{...common,phase:BFT_PHASES.PRECOMMIT});
  return {ok:prevotes.length>=threshold&&precommits.length>=threshold,prevotes,precommits,threshold,reason:prevotes.length<threshold?'prevote quorum':precommits.length<threshold?'precommit quorum':'ok'};
}

export function checkpointBody({networkId,height,blockHash,stateRoot,validatorSetRoot,totalSupplyAtomic,state}){
  return {version:2,networkId,height:Number(height),blockHash,stateRoot,validatorSetRoot,totalSupplyAtomic:String(totalSupplyAtomic),state};
}

export function checkpointHash(body){return crypto.createHash('sha256').update(canonical(body)).digest('hex');}
