import crypto from 'node:crypto';
import { canonical, Identity } from './identity.js';
import { makeGenome, normalizePolicy } from './evolution.js';

function sha(x){return crypto.createHash('sha256').update(typeof x==='string'?x:canonical(x)).digest('hex');}
function clamp(n,min,max){n=Number(n);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):min;}
function mean(xs){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;}
function q(n,step=.5){return Math.round(Number(n)/step)*step;}

export function speciesOf(genome){
  const p=normalizePolicy(genome?.policy||{}),r=p.router;
  const signature={model:p.modelChoice||'default',workers:r.remoteWorkers,cap:q(r.capabilityWeight),trust:q(r.trustWeight),latency:q(r.latencyWeight),fresh:q(r.freshnessWeight)};
  return `sp_${sha(signature).slice(0,12)}`;
}

export function genomeDistance(a,b){
  const A=normalizePolicy(a?.policy||{}),B=normalizePolicy(b?.policy||{}),ar=A.router,br=B.router;
  const numeric=[Math.abs(ar.capabilityWeight-br.capabilityWeight)/7,Math.abs(ar.trustWeight-br.trustWeight)/5,Math.abs(ar.freshnessWeight-br.freshnessWeight)/3,Math.abs(ar.latencyWeight-br.latencyWeight)/3,Math.abs(ar.remoteWorkers-br.remoteWorkers)/5,Math.min(1,Math.abs(ar.freshnessWindowMs-br.freshnessWindowMs)/570000)];
  const model=A.modelChoice===B.modelChoice?0:1;
  const kw=(x)=>new Set(Object.values(x.keywordAdditions||{}).flat());const ka=kw(A),kb=kw(B),union=new Set([...ka,...kb]);let inter=0;for(const x of ka)if(kb.has(x))inter++;const keyword=union.size?1-inter/union.size:0;
  return clamp(.68*mean(numeric)+.20*model+.12*keyword,0,1);
}

function candidateQuality(evolution,store,g){const b=Number(g.benchmarkScore||evolution.benchmark(g).score)||0;const s=store.evolutionStats(g.genomeId,200);const f=s.samples?s.fitness:b;return clamp(.62*b+.38*f,0,1);}

export class CollectiveEvolution {
  constructor({config,identity,store,evolution,ledger=null}){this.c=config;this.identity=identity;this.store=store;this.evolution=evolution;this.ledger=ledger;this.timer=null;this.callbacks={};this.busy=false;}
  setLedger(ledger){this.ledger=ledger;}
  enabled(){return !!this.c.collectiveEvolutionEnabled;}
  status(){const ts=this.store.collectiveTournaments(10);return {enabled:this.enabled(),auto:this.c.collectiveEvolutionAuto,epochMs:this.c.collectiveEvolutionEpochMs,minVoters:this.c.collectiveEvolutionMinVoters,maxCandidates:this.c.collectiveEvolutionMaxCandidates,maxPerAuthor:this.c.collectiveEvolutionMaxPerAuthor,allowUnstaked:this.c.collectiveEvolutionAllowUnstaked,speciesDistance:this.c.collectiveEvolutionSpeciesDistance,genePool:this.genePool(30),tournaments:ts.map(t=>({...t,votes:this.store.collectiveVotes(t.tournamentId).length,tally:t.status==='finalized'?this.tally(t.tournamentId):undefined}))};}
  genePool(limit=50){return this.store.evolutionGenomes(limit).map(g=>{const lineage=this.store.collectiveLineage(g.genomeId);return {...this.evolution.publicGenome(g),speciesId:lineage?.speciesId||speciesOf(g),parents:lineage?.parents||[g.parentId].filter(Boolean),collectiveTournamentId:lineage?.tournamentId||'',quality:candidateQuality(this.evolution,this.store,g)};});}
  selectCandidates(limit=this.c.collectiveEvolutionMaxCandidates){
    const champ=this.evolution.champion();const pool=this.genePool(200).filter(g=>!['rejected'].includes(g.status));if(champ&&!pool.some(g=>g.genomeId===champ.genomeId))pool.push({...champ,speciesId:speciesOf(champ),quality:candidateQuality(this.evolution,this.store,champ)});
    pool.sort((a,b)=>b.quality-a.quality||b.benchmarkScore-a.benchmarkScore||a.genomeId.localeCompare(b.genomeId));const picked=[],authors=new Map();const authorOk=g=>(authors.get(g.authorNodeId||'')||0)<this.c.collectiveEvolutionMaxPerAuthor;
    for(const g of pool){if(picked.length>=limit)break;if(!authorOk(g))continue;const diverse=!picked.length||picked.every(x=>genomeDistance(g,x)>=this.c.collectiveEvolutionSpeciesDistance);if(diverse||picked.length<2){picked.push(g);authors.set(g.authorNodeId||'',(authors.get(g.authorNodeId||'')||0)+1);}}
    for(const g of pool){if(picked.length>=limit)break;if(!authorOk(g)||picked.some(x=>x.genomeId===g.genomeId))continue;picked.push(g);authors.set(g.authorNodeId||'',(authors.get(g.authorNodeId||'')||0)+1);}return picked.map(g=>g.genomeId).sort();
  }
  createTournament({epoch=null,candidates=null,durationMs=null}={}){
    if(!this.enabled())throw new Error('collective evolution disabled');epoch=epoch??Math.floor(Date.now()/this.c.collectiveEvolutionEpochMs);const ids=[...(candidates||this.selectCandidates())].filter(id=>this.store.evolutionGenome(id)).sort();if(ids.length<2)throw new Error('collective tournament needs at least 2 genomes');if(ids.length>this.c.collectiveEvolutionMaxCandidates)throw new Error('too many tournament candidates');const seed=sha(`${this.c.networkId}:${epoch}:${this.evolution.constitution.hash}:${ids.join(',')}`);const tournamentId=sha({version:1,epoch,seed,candidates:ids});const now=Date.now();const t={tournamentId,epoch,seed,status:'open',candidates:ids,winnerId:'',createdAt:now,closesAt:now+(durationMs??this.c.collectiveEvolutionVotingMs)};this.store.upsertCollectiveTournament(t);this.store.addEvolutionEvent('collective-tournament-open','',{tournamentId,epoch,candidates:ids});return this.store.collectiveTournament(tournamentId);
  }
  importTournament(t){if(!this.enabled())throw new Error('collective evolution disabled');if(!t||!Array.isArray(t.candidates)||t.candidates.length<2)throw new Error('invalid tournament');const ids=[...new Set(t.candidates.map(String))].sort();if(ids.length>this.c.collectiveEvolutionMaxCandidates)throw new Error('too many candidates');const seed=sha(`${this.c.networkId}:${Number(t.epoch)}:${this.evolution.constitution.hash}:${ids.join(',')}`);const id=sha({version:1,epoch:Number(t.epoch),seed,candidates:ids});if(seed!==t.seed||id!==t.tournamentId)throw new Error('tournament commitment mismatch');for(const gid of ids)if(!this.store.evolutionGenome(gid))throw new Error(`missing tournament genome ${gid}`);return this.store.upsertCollectiveTournament({...t,candidates:ids,seed,tournamentId:id,status:'open',winnerId:''});}
  voterWeight(nodeId){
    if(this.ledger){const b=this.store.bondForNode(nodeId);if(b){const nrn=Number(b.nrn||0);return clamp(1+Math.log10(1+nrn),1,this.c.collectiveEvolutionMaxVoteWeight);}}
    return this.c.collectiveEvolutionAllowUnstaked?1:0;
  }
  evaluate(genomeId,tournamentId=''){
    const g=this.store.evolutionGenome(genomeId);if(!g)throw new Error('genome not found');const bench=this.evolution.benchmark(g);const stats=this.store.evolutionStats(genomeId,200);const champ=this.evolution.champion();const novelty=champ&&champ.genomeId!==g.genomeId?genomeDistance(g,champ):0;const observed=stats.samples?stats.fitness:bench.score;const score=clamp(.58*bench.score+.32*observed+.10*novelty,0,1);return {genomeId,score:Number(score.toFixed(8)),benchmark:bench.score,observed:Number(observed.toFixed(8)),novelty:Number(novelty.toFixed(8)),samples:stats.samples,speciesId:speciesOf(g),tournamentId};
  }
  makeBallot(tournamentId){
    const t=this.store.collectiveTournament(tournamentId);if(!t||t.status!=='open')throw new Error('tournament not open');const weight=this.voterWeight(this.identity.nodeId);if(weight<=0)throw new Error('node is not eligible to vote');const evaluations=t.candidates.map(id=>this.evaluate(id,tournamentId)).sort((a,b)=>b.score-a.score||a.genomeId.localeCompare(b.genomeId));const ranking=evaluations.map(x=>x.genomeId);const payload={networkId:this.c.networkId,type:'collective-evolution-ballot',tournamentId,nodeId:this.identity.nodeId,ranking,evaluations,weight:Number(weight.toFixed(6)),createdAt:Date.now()};const proof=this.identity.envelope(payload);const vote={tournamentId,nodeId:this.identity.nodeId,genomeId:ranking[0],score:evaluations[0].score,weight:payload.weight,proof,createdAt:payload.createdAt};this.store.addCollectiveVote(vote);return vote;
  }
  importBallot(proof){
    if(!proof||!Identity.verifyEnvelope(proof,this.c.envelopeMaxSkewMs))throw new Error('invalid collective ballot signature');const p=proof.payload;if(p?.networkId!==this.c.networkId||p?.type!=='collective-evolution-ballot'||p?.nodeId!==proof.nodeId)throw new Error('collective ballot identity/network mismatch');const t=this.store.collectiveTournament(p.tournamentId);if(!t)throw new Error('unknown tournament');if(t.status!=='open'||Date.now()>t.closesAt+this.c.envelopeMaxSkewMs)throw new Error('tournament closed');if(!Array.isArray(p.ranking)||p.ranking.length!==t.candidates.length||[...p.ranking].sort().join(',')!==[...t.candidates].sort().join(','))throw new Error('ballot candidate set mismatch');if(new Set(p.ranking).size!==p.ranking.length)throw new Error('duplicate ranking entries');const expectedWeight=this.voterWeight(proof.nodeId);if(expectedWeight<=0)throw new Error('voter not eligible');const weight=Math.min(Number(p.weight)||0,expectedWeight,this.c.collectiveEvolutionMaxVoteWeight);if(weight<=0)throw new Error('invalid vote weight');const top=String(p.ranking[0]);const evalTop=Array.isArray(p.evaluations)?p.evaluations.find(x=>x.genomeId===top):null;this.store.addCollectiveVote({tournamentId:t.tournamentId,nodeId:proof.nodeId,genomeId:top,score:clamp(evalTop?.score??0,0,1),weight,proof,createdAt:Number(p.createdAt)||Date.now()});return {ok:true,tournamentId:t.tournamentId,nodeId:proof.nodeId,top,weight};
  }
  tally(tournamentId){
    const t=this.store.collectiveTournament(tournamentId);if(!t)throw new Error('tournament not found');const votes=this.store.collectiveVotes(tournamentId),n=t.candidates.length;const scores=new Map(t.candidates.map(id=>[id,0]));const firsts=new Map(t.candidates.map(id=>[id,0]));let totalWeight=0;
    for(const v of votes){const p=v.proof?.payload;if(!p||!Identity.verifyEnvelope(v.proof,Infinity))continue;const w=clamp(v.weight,0,this.c.collectiveEvolutionMaxVoteWeight);totalWeight+=w;for(let i=0;i<p.ranking.length;i++){const id=p.ranking[i];if(!scores.has(id))continue;scores.set(id,scores.get(id)+w*(n-i));if(i===0)firsts.set(id,firsts.get(id)+w);}}
    const rows=t.candidates.map(id=>({genomeId:id,points:Number((scores.get(id)||0).toFixed(8)),firstWeight:Number((firsts.get(id)||0).toFixed(8)),benchmark:Number(this.store.evolutionGenome(id)?.benchmarkScore||0),speciesId:speciesOf(this.store.evolutionGenome(id))})).sort((a,b)=>b.points-a.points||b.firstWeight-a.firstWeight||b.benchmark-a.benchmark||a.genomeId.localeCompare(b.genomeId));const voterIds=votes.map(v=>v.nodeId).sort();return {tournamentId,voters:votes.length,voterIds,breederNodeId:voterIds[0]||'',totalWeight:Number(totalWeight.toFixed(8)),ranking:rows,winnerId:rows[0]?.genomeId||''};
  }
  finalizeTournament(tournamentId,{force=false}={}){
    const t=this.store.collectiveTournament(tournamentId);if(!t)throw new Error('tournament not found');const tally=this.tally(tournamentId);if(!force&&tally.voters<this.c.collectiveEvolutionMinVoters)throw new Error(`need ${this.c.collectiveEvolutionMinVoters} collective voters`);if(!tally.winnerId)throw new Error('no tournament winner');this.store.upsertCollectiveTournament({...t,status:'finalized',winnerId:tally.winnerId});this.store.addEvolutionEvent('collective-tournament-finalized',tally.winnerId,{tournamentId,voters:tally.voters,totalWeight:tally.totalWeight,ranking:tally.ranking});return {...this.store.collectiveTournament(tournamentId),tally};
  }
  crossover(parentAId,parentBId,{tournamentId='',mutate=true}={}){
    const a=this.store.evolutionGenome(parentAId),b=this.store.evolutionGenome(parentBId);if(!a||!b)throw new Error('crossover parent missing');if(a.genomeId===b.genomeId)throw new Error('crossover needs distinct parents');const A=normalizePolicy(a.policy),B=normalizePolicy(b.policy);const r={};for(const k of ['capabilityWeight','trustWeight','freshnessWeight','latencyWeight','freshnessWindowMs','remoteWorkers'])r[k]=(Number(A.router[k])+Number(B.router[k]))/2;r.remoteWorkers=Math.round(r.remoteWorkers);r.freshnessWindowMs=Math.round(r.freshnessWindowMs);
    const seed=sha(`${tournamentId}:${a.genomeId}:${b.genomeId}`);const choose=(x,y,i)=>Number.parseInt(seed.slice(i,i+2),16)%2?x:y;const promptSuffixes={expert:choose(A.promptSuffixes.expert,B.promptSuffixes.expert,0),critic:choose(A.promptSuffixes.critic,B.promptSuffixes.critic,2),synthesis:choose(A.promptSuffixes.synthesis,B.promptSuffixes.synthesis,4)};const keywordAdditions={};for(const k of ['code','finance','legal','critic'])keywordAdditions[k]=[...new Set([...(A.keywordAdditions[k]||[]),...(B.keywordAdditions[k]||[])])].slice(0,24);let modelChoice=choose(A.modelChoice,B.modelChoice,6);
    if(mutate){const delta=((Number.parseInt(seed.slice(8,12),16)%201)-100)/1000;r.capabilityWeight+=delta;r.latencyWeight-=delta/2;if(Number.parseInt(seed.slice(12,14),16)%5===0)r.remoteWorkers+=Number.parseInt(seed.slice(14,16),16)%2?1:-1;}
    const policy=normalizePolicy({router:r,promptSuffixes,keywordAdditions,modelChoice});const generation=Math.max(Number(a.generation),Number(b.generation))+1;const tournament=this.store.collectiveTournament(tournamentId);const createdAt=tournament?Number(tournament.createdAt):Math.max(Number(a.createdAt)||0,Number(b.createdAt)||0)+1;const child=makeGenome({parentId:`${a.genomeId}+${b.genomeId}`,generation,authorNodeId:this.identity.nodeId,policy,createdAt});const checked=this.evolution.validateCandidate(child);this.store.upsertEvolutionGenome({...checked,status:'candidate'});const sp=speciesOf(checked);this.store.setCollectiveLineage(checked.genomeId,{parents:[a.genomeId,b.genomeId],speciesId:sp,tournamentId});this.store.addEvolutionEvent('collective-offspring',checked.genomeId,{parents:[a.genomeId,b.genomeId],speciesId:sp,tournamentId});return this.evolution.publicGenome(this.store.evolutionGenome(checked.genomeId));
  }
  breedFromTournament(tournamentId,{force=false}={}){const f=this.finalizeTournament(tournamentId,{force});if(!force&&f.tally.breederNodeId&&f.tally.breederNodeId!==this.identity.nodeId)throw new Error(`designated breeder is ${f.tally.breederNodeId}`);const ranked=f.tally.ranking;if(ranked.length<2)throw new Error('not enough parents');const winnerGenome=this.store.evolutionGenome(f.winnerId);let second=ranked.find(x=>x.genomeId!==f.winnerId&&genomeDistance(winnerGenome,this.store.evolutionGenome(x.genomeId))>=this.c.collectiveEvolutionSpeciesDistance)||ranked.find(x=>x.genomeId!==f.winnerId);const child=this.crossover(f.winnerId,second.genomeId,{tournamentId,mutate:true});return {winner:this.evolution.publicGenome(this.store.evolutionGenome(f.winnerId)),mate:this.evolution.publicGenome(this.store.evolutionGenome(second.genomeId)),child,tournament:f};}
  async autoTick(){
    if(!this.enabled()||!this.c.collectiveEvolutionAuto||this.busy)return;this.busy=true;try{
      const epoch=Math.floor(Date.now()/this.c.collectiveEvolutionEpochMs);let current=this.store.collectiveTournaments(50).find(t=>t.epoch===epoch);
      if(!current){try{current=this.createTournament({epoch});await this.callbacks.broadcastTournament?.(current);}catch{}}
      const opens=this.store.collectiveTournaments(50).filter(t=>t.status==='open');
      for(const t of opens){
        if(!this.store.collectiveVotes(t.tournamentId).some(v=>v.nodeId===this.identity.nodeId)){try{const vote=this.makeBallot(t.tournamentId);await this.callbacks.broadcastBallot?.(vote.proof);}catch{}}
        const votes=this.store.collectiveVotes(t.tournamentId);if(Date.now()>=t.closesAt&&votes.length>=this.c.collectiveEvolutionMinVoters){
          try{const f=this.finalizeTournament(t.tournamentId);let anchored=true;if(this.c.evolutionBftAnchorEnabled&&this.callbacks.anchorTournament){const a=await this.callbacks.anchorTournament(f);anchored=!!a?.anchored;}if(anchored){if(!this.evolution.canary()&&f.winnerId!==this.evolution.champion()?.genomeId)this.evolution.startCanary(f.winnerId);if(f.tally.breederNodeId===this.identity.nodeId){const b=this.breedFromTournament(t.tournamentId,{force:true});await this.callbacks.broadcastCandidate?.(b.child);}}}catch{}
        }
      }
    }finally{this.busy=false;}
  }
  start(callbacks={}){this.callbacks=callbacks||{};if(!this.enabled()||this.timer)return;this.timer=setInterval(()=>this.autoTick().catch(()=>{}),this.c.collectiveEvolutionTickMs);this.timer.unref?.();}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
}
