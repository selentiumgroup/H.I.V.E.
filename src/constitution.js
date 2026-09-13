import crypto from 'node:crypto';
import { Identity, canonical } from './identity.js';

const IMMUTABLE = Object.freeze({
  maxSupplyNRN:'86000000000.00000000',
  quorumRule:'floor(2n/3)+1',
  privateKeyRecovery:false,
  singleOperatorEmergencyControl:false,
});
const TYPES=new Set(['emergency-halt','emergency-resume','cancel-upgrade','validator-recovery']);
function sha(x){return crypto.createHash('sha256').update(canonical(x)).digest('hex');}

export class Constitution {
  constructor({config,identity,store,ledger,governance}){this.c=config;this.identity=identity;this.store=store;this.ledger=ledger;this.governance=governance;}
  immutable(){return IMMUTABLE;}
  committee(height=Number(this.ledger.head().index)+1){return this.ledger.validatorSetSnapshot(height).map(x=>x.nodeId).sort();}
  thresholdFor(committee){return Math.max(1,Math.floor((2*(committee||[]).length)/3)+1);}
  body({type,targetProposalId='',oldValidatorId='',newValidatorId='',newPublicKey='',newRewardAddress='',reason=''}){
    if(!TYPES.has(type))throw new Error('unsupported constitutional action');
    const createdHeight=Number(this.ledger.head().index),committee=this.committee(createdHeight+1),threshold=this.thresholdFor(committee);
    if(!committee.length)throw new Error('no constitutional validator committee');
    if(type==='cancel-upgrade'&&!targetProposalId)throw new Error('target proposal required');
    if(type==='validator-recovery'&&(!oldValidatorId||!newValidatorId||!newPublicKey))throw new Error('recovery identities required');
    return {version:1,type,networkId:this.c.networkId,createdHeight,committee,threshold,targetProposalId:String(targetProposalId||''),oldValidatorId:String(oldValidatorId||''),newValidatorId:String(newValidatorId||''),newPublicKey:String(newPublicKey||''),newRewardAddress:String(newRewardAddress||''),reason:String(reason||'').slice(0,1000),createdAt:Date.now()};
  }
  create(x){if(!this.c.constitutionEnabled)throw new Error('constitution disabled');const body=this.body(x);const actionId=sha(body);const proof=this.identity.envelope({...body,actionId});const a={...body,actionId,authorNodeId:this.identity.nodeId,proof,status:'open'};this.store.upsertConstitutionAction(a);return a;}
  verifyAction(a){if(!a||a.networkId!==this.c.networkId||!TYPES.has(a.type))return false;const body={version:Number(a.version),type:a.type,networkId:a.networkId,createdHeight:Number(a.createdHeight),committee:[...(a.committee||[])],threshold:Number(a.threshold),targetProposalId:a.targetProposalId||'',oldValidatorId:a.oldValidatorId||'',newValidatorId:a.newValidatorId||'',newPublicKey:a.newPublicKey||'',newRewardAddress:a.newRewardAddress||'',reason:a.reason||'',createdAt:Number(a.createdAt)};return a.actionId===sha(body)&&canonical(body.committee)===canonical([...body.committee].sort())&&body.threshold===this.thresholdFor(body.committee)&&Identity.verifyEnvelope(a.proof,Infinity)&&a.proof.nodeId===a.authorNodeId&&a.proof.payload?.actionId===a.actionId;}
  importAction(a){if(!this.verifyAction(a))throw new Error('invalid constitutional action');this.store.upsertConstitutionAction(a);return {ok:true,actionId:a.actionId};}
  vote(actionId,approve=true){const a=this.store.constitutionAction(actionId);if(!a||!this.verifyAction(a))throw new Error('unknown constitutional action');if(!a.committee.includes(this.identity.nodeId))throw new Error('not constitutional validator');const proof=this.identity.envelope({type:'constitution-vote',networkId:this.c.networkId,actionId,approve:!!approve,validatorId:this.identity.nodeId,createdHeight:a.createdHeight,createdAt:Date.now()});this.store.putConstitutionVote({actionId,nodeId:this.identity.nodeId,approve:!!approve,proof});return proof;}
  importVote(proof){if(!Identity.verifyEnvelope(proof,Infinity))throw new Error('invalid constitutional vote');const x=proof.payload||{},a=this.store.constitutionAction(x.actionId);if(!a||x.type!=='constitution-vote'||x.networkId!==this.c.networkId||proof.nodeId!==x.validatorId||!a.committee.includes(proof.nodeId))return {ok:false};this.store.putConstitutionVote({actionId:x.actionId,nodeId:proof.nodeId,approve:!!x.approve,proof});const finalized=this.maybeFinalize(x.actionId);return {ok:true,finalized};}
  maybeFinalize(actionId){const a=this.store.constitutionAction(actionId);if(!a||!this.verifyAction(a))return null;const valid=new Map();for(const v of this.store.constitutionVotes(actionId)){if(!Identity.verifyEnvelope(v,Infinity))continue;const x=v.payload||{};if(x.type==='constitution-vote'&&x.actionId===actionId&&x.networkId===this.c.networkId&&x.approve&&a.committee.includes(v.nodeId)&&v.nodeId===x.validatorId)valid.set(v.nodeId,v);}if(valid.size<a.threshold)return null;const cert={version:1,action:a,committee:a.committee,threshold:a.threshold,votes:[...valid.values()]};const done={...a,status:'finalized',certificate:cert,finalizedAt:Date.now()};this.store.upsertConstitutionAction(done);this.apply(done);return done;}
  verifyCertificate(cert){try{const a=cert?.action;if(!this.verifyAction(a)||canonical(cert.committee||[])!==canonical(a.committee)||Number(cert.threshold)!==Number(a.threshold))return {ok:false};const m=new Map();for(const v of cert.votes||[]){if(!Identity.verifyEnvelope(v,Infinity))continue;const x=v.payload||{};if(x.type==='constitution-vote'&&x.networkId===this.c.networkId&&x.actionId===a.actionId&&x.approve&&a.committee.includes(v.nodeId)&&v.nodeId===x.validatorId)m.set(v.nodeId,v);}return {ok:m.size>=a.threshold,action:a,votes:[...m.values()]};}catch{return {ok:false};}}
  importCertificate(cert){const v=this.verifyCertificate(cert);if(!v.ok)throw new Error('invalid constitution certificate');const done={...v.action,status:'finalized',certificate:cert,finalizedAt:Date.now()};this.store.upsertConstitutionAction(done);this.apply(done);return done;}
  apply(a){if(a.type==='emergency-halt')this.store.setConstitutionState({halted:true,lastActionId:a.actionId,lastCertificate:a.certificate});else if(a.type==='emergency-resume')this.store.setConstitutionState({halted:false,lastActionId:a.actionId,lastCertificate:a.certificate});else if(a.type==='cancel-upgrade')this.governance?.cancelActivation?.(a.targetProposalId,a.certificate);else if(a.type==='validator-recovery')this.store.putRecoveryAuthorization({actionId:a.actionId,oldValidatorId:a.oldValidatorId,newValidatorId:a.newValidatorId,newPublicKey:a.newPublicKey,newRewardAddress:a.newRewardAddress,eligibleHeight:Number(this.ledger.head().index)+this.c.constitutionRecoveryDelayBlocks,certificate:a.certificate});}
  halted(){return !!this.store.constitutionState().halted;}
  root(){const state=this.store.constitutionState();const actions=this.store.constitutionActions().filter(x=>x.status==='finalized').map(x=>({actionId:x.actionId,type:x.type,targetProposalId:x.targetProposalId||'',oldValidatorId:x.oldValidatorId||'',newValidatorId:x.newValidatorId||'',status:x.status})).sort((a,b)=>a.actionId.localeCompare(b.actionId));return sha({version:1,immutable:IMMUTABLE,state:{halted:!!state.halted,lastActionId:state.lastActionId||''},actions});}
  status(){return {enabled:this.c.constitutionEnabled,halted:this.halted(),root:this.root(),immutable:IMMUTABLE,state:this.store.constitutionState(),actions:this.store.constitutionActions(),recoveries:this.store.recoveryAuthorizations()};}
}
