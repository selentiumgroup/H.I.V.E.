import { Identity } from './identity.js';
import { verifyClaim, deterministicWorkScore, rewardForScore, currentEra } from './rewards.js';
import { parseNRN } from './wallet.js';
import { verifyWorkPow } from './security.js';
import { BFT_PHASES, uniqueBftVotes } from './bft-state-machine.js';

function IdentityFresh(env,maxSkew){return Identity.verifyEnvelope(env,maxSkew);}

export class Validator {
  constructor({config,identity,wallet,store}){this.c=config;this.identity=identity;this.wallet=wallet;this.store=store;this.ledger=null;}
  setLedger(ledger){this.ledger=ledger;}
  validateClaim(claim){
    let approved=true,reason='ok';
    try{
      const committee=this.ledger?.claimCommittee(claim)||[];if(!committee.includes(this.identity.nodeId))throw new Error('validator not selected for claim committee');
      if(!IdentityFresh(claim.workerProof,this.c.envelopeMaxSkewMs))throw new Error('stale worker proof');
      if(!verifyClaim(claim,this.c.networkId))throw new Error('invalid claim signature/proof');
      const content=claim.workerProof.payload.result?.content||'';if(content.length<1)throw new Error('empty result');
      if(!verifyWorkPow(claim.workerProof.payload.workPow,{networkId:this.c.networkId,taskId:claim.taskId,challenge:claim.workerProof.payload.challenge,nodeId:claim.workerId,content,minBits:this.c.workPowBits}))throw new Error('invalid neural work challenge');
      const expected=deterministicWorkScore({outputChars:content.length});if(Math.abs(Number(claim.score)-expected)>1e-9)throw new Error('invalid deterministic score');
      const expectedGross=rewardForScore(Number(claim.score),this.c.rewardPerScore,Number(claim.createdAt));if(Math.abs(Number(claim.grossNrn)-expectedGross)>1e-8)throw new Error('invalid reward amount');
      if(BigInt(claim.grossAtomic)!==parseNRN(expectedGross.toFixed(8)))throw new Error('invalid reward atomic amount');if(Number(claim.era)!==currentEra(Number(claim.createdAt)))throw new Error('invalid reward era');
    }catch(e){approved=false;reason=e.message;}
    return this.identity.envelope({networkId:this.c.networkId,type:'validation-vote',claimId:claim.claimId,approved,reason,validatorId:this.identity.nodeId,rewardAddress:this.c.rewardAddress||this.wallet.address,consensusHeight:claim.consensusHeight,consensusHash:claim.consensusHash,createdAt:Date.now()});
  }
  validateBlock(block){
    let approved=true,reason='ok';
    try{const committee=this.ledger?.blockCommittee(block.index,block.prevHash,Number(block.round||0))||[];if(!committee.includes(this.identity.nodeId))throw new Error('validator not selected for block committee');const v=this.ledger?.verifyProposal(block);if(!v?.ok)throw new Error(v?.reason||'invalid block');}catch(e){approved=false;reason=e.message;}
    return this.identity.envelope({networkId:this.c.networkId,type:'block-vote',blockHash:block.hash,height:Number(block.index),round:Number(block.round||0),prevHash:block.prevHash,approved,reason,validatorId:this.identity.nodeId,rewardAddress:this.c.rewardAddress||this.wallet.address,createdAt:Date.now()});
  }
  voteBft(block,phase,phaseProof=[]){
    if(![BFT_PHASES.PREVOTE,BFT_PHASES.PRECOMMIT].includes(phase))throw new Error('bad BFT phase');
    const height=Number(block.index),round=Number(block.round||0),existing=this.store.bftVoteForSlot?.(this.identity.nodeId,height,round,phase);
    if(existing){if(existing.payload?.blockHash===block.hash)return existing;throw new Error(`BFT ${phase} lock: already voted different block at ${height}/${round}`);}
    let approved=true,reason='ok';try{
      const v=this.ledger?.verifyProposal(block);if(!v?.ok)throw new Error(v?.reason||'invalid block');const committee=block.committee||[];if(!committee.includes(this.identity.nodeId))throw new Error('validator not selected for block committee');if(block.proposer!==block.leader)throw new Error('non-leader proposal');
      if(phase===BFT_PHASES.PRECOMMIT){const prevotes=uniqueBftVotes(phaseProof||[],{networkId:this.c.networkId,phase:BFT_PHASES.PREVOTE,height,round,blockHash:block.hash,prevHash:block.prevHash,committee});if(prevotes.length<this.ledger.threshold(committee))throw new Error('precommit requires prevote quorum');}
    }catch(e){approved=false;reason=e.message;}
    const vote=this.identity.envelope({networkId:this.c.networkId,type:'bft-vote',phase,blockHash:block.hash,height,round,prevHash:block.prevHash,approved,reason,validatorId:this.identity.nodeId,rewardAddress:this.c.rewardAddress||this.wallet.address,createdAt:Date.now()});
    this.store.addBftVote?.(vote);return vote;
  }
}
