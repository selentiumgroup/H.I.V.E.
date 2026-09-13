import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/db.js';
import { Identity } from '../src/identity.js';
import { EvolutionEngine, makeGenome } from '../src/evolution.js';
import { CollectiveEvolution, speciesOf, genomeDistance } from '../src/collective-evolution.js';

const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'neural-mesh-collective-'));
const store=new Store(dataDir);const llm={chat:async()=>({content:'{}'})};
const config={networkId:'collective-test',envelopeMaxSkewMs:600000,maxRemoteWorkers:4,llmModel:'model-a',evolutionModelPool:['model-a','model-b'],evolutionEnabled:true,evolutionAuto:false,evolutionLlmProposals:false,evolutionAcceptRemote:true,evolutionCanaryShare:.2,evolutionMinCanarySamples:4,evolutionMaxCanarySamples:20,evolutionPromotionMargin:.02,evolutionMaxErrorRate:.2,evolutionMinBenchmarkScore:.75,evolutionAutoTaskInterval:20,evolutionMinProposalIntervalMs:1,evolutionIdleMs:0,evolutionTickMs:1000,collectiveEvolutionEnabled:true,collectiveEvolutionAuto:false,collectiveEvolutionEpochMs:60000,collectiveEvolutionVotingMs:1000,collectiveEvolutionMinVoters:3,collectiveEvolutionMaxCandidates:8,collectiveEvolutionMaxVoteWeight:3,collectiveEvolutionAllowUnstaked:true,collectiveEvolutionSpeciesDistance:.18};
const dirs=[0,1,2].map(i=>path.join(dataDir,`id${i}`));for(const d of dirs)fs.mkdirSync(d,{recursive:true});const ids=dirs.map((d,i)=>new Identity(d,{password:`pass-${i}-collective`}));
const evolution=new EvolutionEngine({config,identity:ids[0],store,llm});
try{
  const genesis=evolution.champion();
  const p1=makeGenome({parentId:genesis.genomeId,generation:1,authorNodeId:ids[0].nodeId,policy:{...genesis.policy,router:{...genesis.policy.router,capabilityWeight:genesis.policy.router.capabilityWeight+.25}}});const c1=evolution.validateCandidate(p1);store.upsertEvolutionGenome({...c1,status:'candidate'});
  const p2=makeGenome({parentId:genesis.genomeId,generation:1,authorNodeId:ids[1].nodeId,policy:{...genesis.policy,modelChoice:'model-b'}});const c2=evolution.validateCandidate(p2);store.upsertEvolutionGenome({...c2,status:'candidate'});
  if(speciesOf(c1)===speciesOf(c2))throw new Error('species classifier failed to separate model species');if(genomeDistance(c1,c2)<=0)throw new Error('genome distance failed');
  const engines=ids.map(id=>new CollectiveEvolution({config,identity:id,store,evolution}));
  const t=engines[0].createTournament({epoch:7,candidates:[genesis.genomeId,c1.genomeId,c2.genomeId],durationMs:1});
  for(const e of engines)e.makeBallot(t.tournamentId);
  const tallyA=engines[0].tally(t.tournamentId),tallyB=engines[1].tally(t.tournamentId);if(tallyA.winnerId!==tallyB.winnerId||tallyA.voters!==3)throw new Error('collective tally does not converge');
  const final=engines[2].finalizeTournament(t.tournamentId);if(final.winnerId!==tallyA.winnerId)throw new Error('finalized winner mismatch');
  const breeder=engines.find(e=>e.identity.nodeId===final.tally.breederNodeId);if(!breeder)throw new Error('designated breeder missing');const born=breeder.breedFromTournament(t.tournamentId);if(!born.child?.genomeId||born.child.generation<2)throw new Error('collective crossover did not create offspring');const lineage=store.collectiveLineage(born.child.genomeId);if(lineage?.parents?.length!==2)throw new Error('offspring lineage missing');
  let protectedRejected=false;try{evolution.validateCandidate({...born.child,consensus:{quorum:1}});}catch{protectedRejected=true;}if(!protectedRejected)throw new Error('collective evolution escaped constitution');
  console.log('COLLECTIVE EVOLUTION V0.7 OK',{tournament:t.tournamentId.slice(0,16),voters:tallyA.voters,winner:tallyA.winnerId.slice(0,16),species:new Set([speciesOf(genesis),speciesOf(c1),speciesOf(c2)]).size,breeder:final.tally.breederNodeId.slice(0,16),offspring:born.child.genomeId.slice(0,16),lineage:true,constitution:true});
}finally{store.close();}
