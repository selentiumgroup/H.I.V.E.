import crypto from 'node:crypto';
import { canonical, Identity } from './identity.js';
import { MAX_SUPPLY_NRN, MAX_SUPPLY_ATOMIC, verifyClaim, finalizeClaim, rewardForScore, currentEra, deterministicWorkScore } from './rewards.js';
import { Wallet, isValidAddress, parseNRN, formatNRN } from './wallet.js';
import { deterministicCommittee, quorumFor, verifyWorkPow } from './security.js';
import { epochForHeight, epochStartHeight, deterministicLeader, stateRoot } from './consensus-core.js';

export function genesisBlock(config){
  const body={version:4,index:0,round:0,networkId:config.networkId,prevHash:'0'.repeat(64),createdAt:0,proposer:'GENESIS',proposerPublicKey:'',proposerRewardAddress:'',maxSupplyNRN:MAX_SUPPLY_NRN,receipts:[],transactions:[],slashings:[],mintedNRN:'0',mintedAtomic:'0',security:{mode:config.securityMode,bootstrapValidatorIds:[...config.bootstrapValidatorIds].sort(),autoBootstrapValidators:config.autoBootstrapValidators,bootstrapUntilHeight:config.bootstrapValidatorUntilHeight,minValidatorStakeNRN:config.minValidatorStakeNRN,committeeSize:config.validatorCount,slashFraction:config.slashFraction,slashJailBlocks:config.slashJailBlocks,workPowBits:config.workPowBits}};
  const hash=crypto.createHash('sha256').update(canonical(body)).digest('hex');return {...body,hash,proposerSignature:'GENESIS',validatorVotes:[],finalized:true};
}
function bodyOf(block){const {hash,proposerSignature,validatorVotes,finalized,...body}=block;return body;}
function calcHash(block){return crypto.createHash('sha256').update(canonical(bodyOf(block))).digest('hex');}
function verifySig(publicKey,payload,signature){try{return crypto.verify(null,Buffer.from(canonical(payload)),crypto.createPublicKey(publicKey),Buffer.from(signature,'base64'));}catch{return false;}}
function nodeIdOfKey(publicKey){try{const k=crypto.createPublicKey(publicKey);return crypto.createHash('sha256').update(k.export({type:'spki',format:'der'})).digest('hex');}catch{return '';}}
function cloneMap(m){return new Map([...m.entries()].map(([k,v])=>[k,typeof v==='object'&&v!==null?{...v}:v]));}
function uniqueVotes(votes,type,idField,id,committee){const allowed=new Set(committee);const out=new Map();for(const v of votes||[]){if(!Identity.verifyEnvelope(v,Infinity)||v.payload?.type!==type||!v.payload?.approved||v.payload?.[idField]!==id||!allowed.has(v.nodeId)||!isValidAddress(v.payload?.rewardAddress))continue;out.set(v.nodeId,v);}return [...out.values()];}

export class Ledger {
  constructor({config,identity,wallet,store}){this.c=config;this.identity=identity;this.wallet=wallet;this.store=store;this.evolutionAnchorVerifier=null;this.genesis=genesisBlock(config);this.store.ensureGenesis(this.genesis);this.minFeeAtomic=parseNRN(this.c.txFeeNRN);this.minValidatorStakeAtomic=parseNRN(this.c.minValidatorStakeNRN);}
  setEvolutionAnchorVerifier(fn){this.evolutionAnchorVerifier=fn;}
  head(){return this.store.ledgerHead();}
  supplyAtomic(){return this.store.totalSupplyAtomic();}
  supply(){return formatNRN(this.supplyAtomic());}
  balances(limit=100){return this.store.balances(limit);}
  rewardAddress(){return this.c.rewardAddress||this.wallet.address;}
  eligibleValidatorIds(height=Number(this.head().index)){
    const epochStart=Math.max(0,epochStartHeight(Math.max(1,Number(height)),this.c.validatorEpochBlocks)-1);
    const bonded=this.store.validatorSet(this.minValidatorStakeAtomic,epochStart).map(v=>v.nodeId);const ids=new Set(bonded);
    if(height<=this.c.bootstrapValidatorUntilHeight)for(const id of this.c.bootstrapValidatorIds)if(/^[0-9a-f]{64}$/i.test(id))ids.add(id);
    if(this.c.autoBootstrapValidators&&this.c.securityMode!=='mainnet'&&height<=this.c.bootstrapValidatorUntilHeight&&ids.size<this.c.validatorQuorum){if(this.c.capabilities.includes('validator'))ids.add(this.identity.nodeId);for(const p of this.store.peers())if(p.capabilities?.includes('validator')&&p.failures<5)ids.add(p.nodeId);}
    if(!ids.size&&this.c.allowSingleValidator)ids.add(this.identity.nodeId);return [...ids].sort();
  }
  committee(seed,height=Number(this.head().index)){return deterministicCommittee(seed,this.eligibleValidatorIds(height),this.c.validatorCount).map(x=>x.nodeId);}
  claimCommittee(claim){const b=this.store.blockAtIndex(Number(claim.consensusHeight));if(!b||b.hash!==claim.consensusHash)return [];let candidates=this.eligibleValidatorIds(Number(claim.consensusHeight)).filter(id=>id!==claim.workerId);if(!candidates.length&&this.c.allowSingleValidator)candidates=[this.identity.nodeId];return deterministicCommittee(`claim:${claim.claimId}:${claim.consensusHash}`,candidates,this.c.validatorCount).map(x=>x.nodeId);}
  blockCommittee(index,prevHash,round=0){const e=epochForHeight(index,this.c.validatorEpochBlocks);return this.committee(`block:${e}:${index}:${round}:${prevHash}`,Math.max(0,epochStartHeight(index,this.c.validatorEpochBlocks)-1));}
  blockLeader(index,prevHash,round=0){return deterministicLeader({height:index,round,prevHash,validators:this.blockCommittee(index,prevHash,round)});}
  threshold(committee){if(!committee.length)return Infinity;if(this.c.allowSingleValidator&&committee.length===1)return 1;return Math.max(quorumFor(committee.length),Math.min(this.c.validatorQuorum,committee.length));}
  validateTransactions(transactions,proposerRewardAddress,blockIndex=Number(this.head().index)+1){
    if(!isValidAddress(proposerRewardAddress))return {ok:false,reason:'invalid proposer reward address'};
    if(!Array.isArray(transactions)||transactions.length>this.c.maxBlockTx)return {ok:false,reason:'too many transactions'};
    const state=this.store.chainState();const balances=cloneMap(state.balances),nonces=cloneMap(state.nonces),bonds=cloneMap(state.bonds),seen=new Set(state.txIds);let totalFees=0n;
    const add=(addr,delta)=>balances.set(addr,(balances.get(addr)||0n)+BigInt(delta));
    for(const tx of transactions){
      if(!Wallet.verifyTransaction(tx,this.c.networkId))return {ok:false,reason:`invalid transaction ${tx?.txId||''}`};if(seen.has(tx.txId))return {ok:false,reason:'duplicate transaction'};seen.add(tx.txId);
      const amount=BigInt(tx.amountAtomic||0),fee=BigInt(tx.feeAtomic||0);if(fee<this.minFeeAtomic)return {ok:false,reason:'transaction fee below minimum'};const expected=(nonces.get(tx.from)||0)+1;if(Number(tx.nonce)!==expected)return {ok:false,reason:`bad nonce for ${tx.from}: expected ${expected}`};
      if(tx.type==='transfer'){
        const need=amount+fee;if((balances.get(tx.from)||0n)<need)return {ok:false,reason:'insufficient balance'};add(tx.from,-need);add(tx.to,amount);
      }else if(tx.type==='bond'){
        const need=amount+fee;if((balances.get(tx.from)||0n)<need)return {ok:false,reason:'insufficient balance for bond'};if(nodeIdOfKey(tx.validatorPublicKey)!==tx.validatorNodeId)return {ok:false,reason:'validator public key mismatch'};const old=bonds.get(tx.validatorNodeId);if(old&&(old.address!==tx.from||old.publicKey!==tx.validatorPublicKey))return {ok:false,reason:'validator bond ownership mismatch'};add(tx.from,-need);if(old)old.atomic+=amount;else bonds.set(tx.validatorNodeId,{nodeId:tx.validatorNodeId,address:tx.from,publicKey:tx.validatorPublicKey,rewardAddress:tx.rewardAddress,atomic:amount,jailUntilHeight:0});
      }else if(tx.type==='unbond'){
        const old=bonds.get(tx.validatorNodeId);if(!old||old.address!==tx.from)return {ok:false,reason:'validator bond not owned by sender'};if((old.jailUntilHeight||0)>Number(blockIndex))return {ok:false,reason:'validator is jailed'};if(amount>old.atomic)return {ok:false,reason:'unbond exceeds stake'};if((balances.get(tx.from)||0n)<fee)return {ok:false,reason:'insufficient liquid balance for unbond fee'};old.atomic-=amount;add(tx.from,-fee);
      }else return {ok:false,reason:'unsupported transaction type'};
      add(proposerRewardAddress,fee);nonces.set(tx.from,expected);totalFees+=fee;
    }
    return {ok:true,totalFeesAtomic:totalFees.toString(),balances,nonces,bonds};
  }
  verifySlashing(s,index){
    try{
      const e=s?.evidence;if(!e||s.evidenceId!==e.evidenceId||e.validatorId!==s.validatorId)return {ok:false,reason:'bad slash evidence'};const a=e.voteA,b=e.voteB;if(!Identity.verifyEnvelope(a,Infinity)||!Identity.verifyEnvelope(b,Infinity))return {ok:false,reason:'invalid slash signatures'};const pa=a.payload,pb=b.payload;if(pa?.type!=='block-vote'||pb?.type!=='block-vote'||!pa.approved||!pb.approved||a.nodeId!==b.nodeId||a.nodeId!==s.validatorId)return {ok:false,reason:'not equivocation votes'};if(Number(pa.height)!==Number(pb.height)||Number(pa.round)!==Number(pb.round)||pa.blockHash===pb.blockHash||pa.prevHash!==pb.prevHash)return {ok:false,reason:'not conflicting votes'};const parent=this.store.blockAtIndex(Number(pa.height)-1);if(!parent||parent.hash!==pa.prevHash)return {ok:false,reason:'slash votes are not anchored to canonical parent'};const committee=this.blockCommittee(Number(pa.height),pa.prevHash,Number(pa.round));if(!committee.includes(s.validatorId))return {ok:false,reason:'equivocator was not selected for that slot'};
      const bond=this.store.validatorSet(0n,index-1).find(v=>v.nodeId===s.validatorId)||this.store.bondForNode(s.validatorId);if(!bond)return {ok:false,reason:'validator has no bond'};const stake=BigInt(bond.atomic);const expectedPenalty=stake===0n?0n:((stake*BigInt(Math.round(this.c.slashFraction*1_000_000)))/1_000_000n||1n);if(BigInt(s.penaltyAtomic)!==expectedPenalty)return {ok:false,reason:'bad slash penalty'};if(Number(s.jailUntilHeight)!==Number(index)+this.c.slashJailBlocks)return {ok:false,reason:'bad jail height'};return {ok:true};
    }catch(e){return {ok:false,reason:e.message};}
  }
  prepareSlashings(index,evidence=[]){const out=[];const seen=new Set();for(const e of evidence){if(!e?.evidenceId||seen.has(e.evidenceId))continue;seen.add(e.evidenceId);const bond=this.store.bondForNode(e.validatorId);if(!bond)continue;const stake=BigInt(bond.atomic);const penalty=stake===0n?0n:((stake*BigInt(Math.round(this.c.slashFraction*1_000_000)))/1_000_000n||1n);out.push({version:1,evidenceId:e.evidenceId,validatorId:e.validatorId,penaltyAtomic:penalty.toString(),penaltyNRN:formatNRN(penalty),jailUntilHeight:Number(index)+this.c.slashJailBlocks,evidence:e});}return out;}
  projectedStateRoot({receipts=[],transactions=[],slashings=[],index,proposerRewardAddress}){
    const base=this.store.chainState();const balances=cloneMap(base.balances),nonces=cloneMap(base.nonces),bonds=cloneMap(base.bonds),pendingUnbonds=(base.pendingUnbonds||[]).map(x=>({...x}));
    const add=(addr,delta)=>{if(!addr)return;balances.set(addr,(balances.get(addr)||0n)+BigInt(delta));};
    for(const u of [...pendingUnbonds])if(u.releaseHeight<=Number(index)){add(u.address,u.atomic);pendingUnbonds.splice(pendingUnbonds.indexOf(u),1);}
    for(const r of receipts)for(const a of r.allocations||[])add(a.address||a.nodeId,BigInt(a.atomic||0));
    for(const tx of transactions){const fee=BigInt(tx.feeAtomic||0),amount=BigInt(tx.amountAtomic||0);if(tx.type==='transfer'){add(tx.from,-amount-fee);add(tx.to,amount);}else if(tx.type==='bond'){add(tx.from,-amount-fee);const old=bonds.get(tx.validatorNodeId);if(old)old.atomic=BigInt(old.atomic)+amount;else bonds.set(tx.validatorNodeId,{nodeId:tx.validatorNodeId,address:tx.from,publicKey:tx.validatorPublicKey,rewardAddress:tx.rewardAddress,atomic:amount,jailUntilHeight:0,slashedAtomic:0n});}else if(tx.type==='unbond'){const old=bonds.get(tx.validatorNodeId);if(old)old.atomic=BigInt(old.atomic)-amount;add(tx.from,-fee);pendingUnbonds.push({address:tx.from,atomic:amount,releaseHeight:Number(index)+this.c.unbondDelayBlocks,validatorNodeId:tx.validatorNodeId});}if(fee>0n)add(proposerRewardAddress,fee);nonces.set(tx.from,Math.max(nonces.get(tx.from)||0,Number(tx.nonce)||0));}
    for(const x of slashings){const b=bonds.get(x.validatorId);if(!b)continue;const p=BigInt(x.penaltyAtomic||0);b.atomic=BigInt(b.atomic)>p?BigInt(b.atomic)-p:0n;b.slashedAtomic=BigInt(b.slashedAtomic||0)+p;b.jailUntilHeight=Math.max(Number(b.jailUntilHeight)||0,Number(x.jailUntilHeight)||0);}
    return stateRoot({balances,nonces,bonds,pendingUnbonds});
  }
  build(receipts=[],transactions=[],slashEvidence=[],evolutionAnchors=[],round=0){
    const head=this.head();const requested=receipts.reduce((s,r)=>s+(r.allocations||[]).reduce((a,x)=>a+BigInt(x.atomic||0),0n),0n);const room=MAX_SUPPLY_ATOMIC-this.supplyAtomic();if(requested>room)throw new Error('NRN max supply reached');const proposerRewardAddress=this.rewardAddress();const index=Number(head.index)+1;const txv=this.validateTransactions(transactions,proposerRewardAddress,index);if(!txv.ok)throw new Error(txv.reason);
    const committee=this.blockCommittee(index,head.hash,round),threshold=this.threshold(committee);if(!committee.length)throw new Error('no validator committee available');const slashings=this.prepareSlashings(index,slashEvidence);
    const epoch=epochForHeight(index,this.c.validatorEpochBlocks),leader=this.blockLeader(index,head.hash,round);const root=this.projectedStateRoot({receipts,transactions,slashings,index,proposerRewardAddress});
    const body={version:5,index,round,epoch,leader,stateRoot:root,networkId:this.c.networkId,prevHash:head.hash,createdAt:Date.now(),proposer:this.identity.nodeId,proposerPublicKey:this.identity.publicPem,proposerRewardAddress,committee,threshold,receipts,transactions,slashings,evolutionAnchors,mintedNRN:formatNRN(requested),mintedAtomic:requested.toString()};const hash=crypto.createHash('sha256').update(canonical(body)).digest('hex');return {...body,hash,proposerSignature:this.identity.sign({hash}),validatorVotes:[],finalized:false};
  }
  verifyReceipt(r){
    if(!verifyClaim(r,this.c.networkId))return false;const pow=r.workerProof?.payload?.workPow,content=r.workerProof?.payload?.result?.content||'',challenge=r.workerProof?.payload?.challenge;if(!verifyWorkPow(pow,{networkId:this.c.networkId,taskId:r.taskId,challenge,nodeId:r.workerId,content,minBits:this.c.workPowBits}))return false;
    const committee=this.claimCommittee(r);if(!committee.length)return false;const votes=uniqueVotes(r.votes,'validation-vote','claimId',r.claimId,committee);if(votes.length<this.threshold(committee))return false;
    const expectedScore=deterministicWorkScore({outputChars:content.length});if(Math.abs(Number(r.score)-expectedScore)>1e-9)return false;const expectedGross=rewardForScore(Number(r.score),this.c.rewardPerScore,Number(r.createdAt));if(Math.abs(Number(r.grossNrn)-expectedGross)>1e-8||BigInt(r.grossAtomic)!==parseNRN(expectedGross.toFixed(8))||Number(r.era)!==currentEra(Number(r.createdAt)))return false;
    const expected=finalizeClaim(r,votes,{worker:this.c.rewardWorkerShare,validator:this.c.rewardValidatorShare,router:this.c.rewardRouterShare}).allocations;if(canonical(expected)!==canonical(r.allocations||[]))return false;const allocated=(r.allocations||[]).reduce((s,a)=>s+BigInt(a.atomic||0),0n);return allocated===BigInt(r.grossAtomic);
  }
  verifyProposal(block){
    if(!block||block.version!==5||block.index===0||block.networkId!==this.c.networkId||calcHash(block)!==block.hash)return {ok:false,reason:'bad hash/network/version'};if(nodeIdOfKey(block.proposerPublicKey)!==block.proposer||!verifySig(block.proposerPublicKey,{hash:block.hash},block.proposerSignature))return {ok:false,reason:'bad proposer signature'};if(!isValidAddress(block.proposerRewardAddress))return {ok:false,reason:'bad proposer reward address'};
    const head=this.head();if(block.index!==Number(head.index)+1||block.prevHash!==head.hash||Number(block.round)<0||Number(block.round)>=this.c.bftMaxRounds)return {ok:false,reason:'head/round mismatch'};const committee=this.blockCommittee(block.index,block.prevHash,Number(block.round));if(canonical(committee)!==canonical(block.committee||[])||Number(block.threshold)!==this.threshold(committee))return {ok:false,reason:'bad committee/threshold'};if(Number(block.epoch)!==epochForHeight(block.index,this.c.validatorEpochBlocks)||block.leader!==this.blockLeader(block.index,block.prevHash,Number(block.round)))return {ok:false,reason:'bad epoch/leader'};
    let minted=0n;for(const r of block.receipts||[]){if(!this.verifyReceipt(r))return {ok:false,reason:'receipt quorum/signature/work proof'};minted+=(r.allocations||[]).reduce((s,a)=>s+BigInt(a.atomic||0),0n);}if(minted!==BigInt(block.mintedAtomic||0)||formatNRN(minted)!==String(block.mintedNRN))return {ok:false,reason:'mint mismatch'};if(this.supplyAtomic()+minted>MAX_SUPPLY_ATOMIC)return {ok:false,reason:'supply cap'};
    const txv=this.validateTransactions(block.transactions||[],block.proposerRewardAddress,block.index);if(!txv.ok)return txv;for(const s of block.slashings||[]){const sv=this.verifySlashing(s,block.index);if(!sv.ok)return sv;}for(const a of block.evolutionAnchors||[]){if(!this.evolutionAnchorVerifier)return {ok:false,reason:'evolution anchor verifier unavailable'};const av=this.evolutionAnchorVerifier(a);if(!av?.ok)return {ok:false,reason:`evolution anchor: ${av?.reason||'invalid'}`};}const root=this.projectedStateRoot({receipts:block.receipts||[],transactions:block.transactions||[],slashings:block.slashings||[],index:block.index,proposerRewardAddress:block.proposerRewardAddress});if(root!==block.stateRoot)return {ok:false,reason:'state root mismatch'};return {ok:true};
  }
  verifyBlock(block){const p=this.verifyProposal(block);if(!p.ok)return p;const votes=uniqueVotes(block.validatorVotes,'block-vote','blockHash',block.hash,block.committee||[]).filter(v=>Number(v.payload.height)===Number(block.index)&&Number(v.payload.round)===Number(block.round)&&v.payload.prevHash===block.prevHash);if(votes.length<Number(block.threshold))return {ok:false,reason:'block finality quorum'};return {ok:true,votes};}
  commit(block){const v=this.verifyBlock(block);if(!v.ok)throw new Error(v.reason);block.finalized=true;this.store.addBlock(block);for(const vote of block.validatorVotes||[])this.store.recordValidatorVote(vote);return block;}
  importBlock(block){if(this.store.hasBlock(block.hash))return true;const v=this.verifyBlock(block);if(!v.ok)return false;block.finalized=true;this.store.addBlock(block);for(const vote of block.validatorVotes||[])this.store.recordValidatorVote(vote);return true;}
}
