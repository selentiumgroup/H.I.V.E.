import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/db.js';
import { Identity } from '../src/identity.js';
import { EvolutionEngine, makeGenome } from '../src/evolution.js';

const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'neural-mesh-evolution-'));
const identity=new Identity(dataDir,{password:'evolution-test-password'});
const store=new Store(dataDir);
const config={
  evolutionEnabled:true,evolutionAuto:false,evolutionLlmProposals:false,evolutionAcceptRemote:true,
  evolutionCanaryShare:.5,evolutionMinCanarySamples:6,evolutionMaxCanarySamples:20,evolutionPromotionMargin:.02,evolutionMaxErrorRate:.2,evolutionMinBenchmarkScore:.75,
  evolutionAutoTaskInterval:20,evolutionMinProposalIntervalMs:1,evolutionIdleMs:0,evolutionTickMs:1000,maxRemoteWorkers:4,llmModel:'model-a',evolutionModelPool:['model-a','model-b']
};
const llm={chat:async()=>({content:'{}'})};
const evolution=new EvolutionEngine({config,identity,store,llm});
try{
  const genesis=evolution.champion();
  if(!genesis||genesis.generation!==0)throw new Error('missing evolution genesis');
  if(evolution.constitution.protectedModules.length<5)throw new Error('constitution not active');

  const candidate=await evolution.propose({reason:'test',useLlm:false});
  if(candidate.generation!==1||candidate.parentId!==genesis.genomeId)throw new Error('candidate lineage incorrect');
  evolution.startCanary(candidate.genomeId);

  for(let i=0;i<8;i++)evolution.recordTask({taskId:`champ-${i}`,genomeId:genesis.genomeId,success:true,latencyMs:110000,outputChars:120,workerCount:1});
  for(let i=0;i<8;i++)evolution.recordTask({taskId:`canary-${i}`,genomeId:candidate.genomeId,success:true,latencyMs:20,outputChars:2200,workerCount:3});
  evolution.maybeAdvance();
  const promoted=evolution.champion();
  if(promoted.genomeId!==candidate.genomeId)throw new Error('better canary was not promoted');

  let protectedRejected=false;
  try{evolution.validateCandidate({...candidate,security:{disable:true}});}catch{protectedRejected=true;}
  if(!protectedRejected)throw new Error('protected mutation was accepted');
  let unknownModelRejected=false;
  try{evolution.validateCandidate(makeGenome({parentId:genesis.genomeId,generation:9,authorNodeId:identity.nodeId,policy:{...genesis.policy,modelChoice:'unapproved-model'}}));}catch{unknownModelRejected=true;}
  if(!unknownModelRejected)throw new Error('unapproved model was accepted');

  const rolled=evolution.rollback();
  if(rolled.genomeId!==genesis.genomeId)throw new Error('rollback did not restore previous champion');
  config.evolutionAuto=true;config.evolutionAutoTaskInterval=4;config.evolutionMinProposalIntervalMs=0;for(let i=0;i<4;i++)evolution.recordTask({taskId:`sleep-${i}`,genomeId:genesis.genomeId,success:true,latencyMs:10,outputChars:1200,workerCount:2});await evolution.autoTick();if(!evolution.canary())throw new Error('digital sleep did not create canary');

  console.log('EVOLUTION V0.7 LOCAL OK',{constitution:evolution.constitution.hash.slice(0,16),genesis:genesis.genomeId.slice(0,16),candidate:candidate.genomeId.slice(0,16),promoted:true,rollback:true,protectedCore:true,modelAllowlist:true,digitalSleep:true});
}finally{store.close();}
