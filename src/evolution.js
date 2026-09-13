import crypto from 'node:crypto';
import { canonical, Identity } from './identity.js';
import { inferCapabilities, rankPeers, DEFAULT_ROUTER_POLICY } from './router.js';

const CONSTITUTION = Object.freeze({
  version: 1,
  protectedModules: ['security','identity','wallet','keystore','ledger','validator','protocol','consensus','rewards'],
  invariants: [
    'Evolution candidates are data-only policies; arbitrary code execution is forbidden.',
    'Evolution cannot alter signatures, ledger rules, reward cap, validator quorum, wallet keys, API authorization, or keystore policy.',
    'Every candidate must pass schema validation and deterministic sandbox benchmarks before canary use.',
    'Canaries are reversible; promotion requires measured improvement and rollback remains available.'
  ]
});

const BASE_PROMPTS = Object.freeze({
  expert: 'You are an expert neural node in a decentralized AI network. Produce an independent, useful answer. State uncertainty when necessary. Do not expose hidden chain-of-thought.',
  critic: 'You are a strict critic node in a decentralized AI network. Identify factual, logical and completeness problems. Be concise and do not expose hidden chain-of-thought.',
  synthesis: 'You are the synthesis node. Combine independent expert answers into one accurate answer. Resolve contradictions, preserve useful details, and do not mention internal hidden chain-of-thought.'
});

const DEFAULT_KEYWORDS = Object.freeze({
  code: ['code','код','javascript','node','python','api','sql','bug','программ'],
  finance: ['finance','финанс','банк','рынок','trading','торгов','эконом'],
  legal: ['law','legal','юрид','договор','закон','регуля'],
  critic: ['critic','проверь','ошиб','verify','провер']
});

function clamp(n,min,max){n=Number(n);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):min;}
function sha(x){return crypto.createHash('sha256').update(typeof x==='string'?x:canonical(x)).digest('hex');}
function deepClone(x){return JSON.parse(JSON.stringify(x));}
function safeSuffix(s=''){
  s=String(s).trim().slice(0,600);
  if(/ignore\s+(all\s+)?previous|bypass|private\s*key|seed\s*phrase|disable\s+security|system\s+prompt|exfiltrat/i.test(s))throw new Error('unsafe prompt mutation');
  return s;
}
function normalizeKeywords(x={}){
  const out={};
  for(const k of ['code','finance','legal','critic']){
    const arr=Array.isArray(x[k])?x[k]:[];
    out[k]=[...new Set(arr.map(v=>String(v).trim().toLowerCase()).filter(v=>v.length>=2&&v.length<=48))].slice(0,24);
  }
  return out;
}
function normalizePolicy(input={}){
  const r=input.router||{};const s=input.promptSuffixes||{};
  return {
    router:{
      capabilityWeight:clamp(r.capabilityWeight??DEFAULT_ROUTER_POLICY.capabilityWeight,1,8),
      trustWeight:clamp(r.trustWeight??DEFAULT_ROUTER_POLICY.trustWeight,0,5),
      freshnessWeight:clamp(r.freshnessWeight??DEFAULT_ROUTER_POLICY.freshnessWeight,0,3),
      latencyWeight:clamp(r.latencyWeight??DEFAULT_ROUTER_POLICY.latencyWeight,0,3),
      freshnessWindowMs:Math.round(clamp(r.freshnessWindowMs??DEFAULT_ROUTER_POLICY.freshnessWindowMs,30000,600000)),
      remoteWorkers:Math.round(clamp(r.remoteWorkers??3,1,6))
    },
    promptSuffixes:{expert:safeSuffix(s.expert||''),critic:safeSuffix(s.critic||''),synthesis:safeSuffix(s.synthesis||'')},
    keywordAdditions:normalizeKeywords(input.keywordAdditions||{}),
    modelChoice:String(input.modelChoice||'').trim().slice(0,160)
  };
}
function makeGenome({parentId='',generation=0,authorNodeId='',policy,createdAt=Date.now()}){
  const p=normalizePolicy(policy);const body={version:1,parentId,generation:Number(generation),authorNodeId,policy:p,createdAt:Number(createdAt)};return {...body,genomeId:sha(body)};
}
function mean(xs){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;}
function taskBucket(taskId){return Number.parseInt(sha(String(taskId)).slice(0,8),16)/0xffffffff;}
function syntheticPeers(now=Date.now()){
  return [
    {nodeId:'finance-specialist',capabilities:['reasoning','finance'],trust:.48,latencyMs:700,lastSeen:now-1000,failures:0},
    {nodeId:'code-specialist',capabilities:['reasoning','code'],trust:.52,latencyMs:650,lastSeen:now-1000,failures:0},
    {nodeId:'legal-specialist',capabilities:['reasoning','legal'],trust:.50,latencyMs:680,lastSeen:now-1000,failures:0},
    {nodeId:'critic-specialist',capabilities:['reasoning','critic'],trust:.51,latencyMs:600,lastSeen:now-1000,failures:0},
    {nodeId:'fast-general',capabilities:['general','reasoning'],trust:.99,latencyMs:35,lastSeen:now-300,failures:0}
  ];
}

export class EvolutionEngine {
  constructor({config,identity,store,llm}){
    this.c=config;this.identity=identity;this.store=store;this.llm=llm;this.timer=null;this.busy=false;
    this.constitution={...CONSTITUTION,hash:sha(CONSTITUTION)};
    this.ensureGenesis();
  }
  ensureGenesis(){
    if(this.store.evolutionChampion())return;
    const policy={router:{...DEFAULT_ROUTER_POLICY,remoteWorkers:Math.min(3,this.c.maxRemoteWorkers||3)},promptSuffixes:{expert:'',critic:'',synthesis:''},keywordAdditions:{code:[],finance:[],legal:[],critic:[]},modelChoice:this.c.llmModel};
    const g=makeGenome({generation:0,authorNodeId:'genesis',policy,createdAt:0});
    this.store.upsertEvolutionGenome({...g,status:'champion',benchmarkScore:this.benchmark(g).score});
    this.store.addEvolutionEvent('genesis',g.genomeId,{constitutionHash:this.constitution.hash});
  }
  champion(){return this.store.evolutionChampion();}
  canary(){return this.store.evolutionCanary();}
  status(){
    const champ=this.champion(),canary=this.canary();
    return {enabled:this.c.evolutionEnabled,auto:this.c.evolutionAuto,constitution:this.constitution,champion:champ?this.publicGenome(champ):null,canary:canary?this.publicGenome(canary):null,canaryShare:clamp(this.c.evolutionCanaryShare,0,1),minCanarySamples:this.c.evolutionMinCanarySamples,promotionMargin:this.c.evolutionPromotionMargin,modelPool:this.c.evolutionModelPool||[this.c.llmModel],idleMs:this.c.evolutionIdleMs,recentEvents:this.store.evolutionEvents(20)};
  }
  publicGenome(g){if(!g)return null;return {...g,stats:this.store.evolutionStats(g.genomeId,100)};}
  policyForTask(taskId){const canary=this.canary();if(canary&&taskBucket(taskId)<clamp(this.c.evolutionCanaryShare,0,1))return {genome:canary,isCanary:true};return {genome:this.champion(),isCanary:false};}
  systemPrompt(role,taskId){const {genome}=this.policyForTask(taskId);const suffix=genome?.policy?.promptSuffixes?.[role]||'';return `${BASE_PROMPTS[role]||BASE_PROMPTS.expert}${suffix?`\nAdditional evolved policy: ${suffix}`:''}`;}
  modelForTask(taskId){const {genome}=this.policyForTask(taskId);const choice=genome?.policy?.modelChoice||this.c.llmModel;return (this.c.evolutionModelPool||[this.c.llmModel]).includes(choice)?choice:this.c.llmModel;}
  inferCapabilities(text,taskId){const {genome}=this.policyForTask(taskId);return inferCapabilities(text,{keywordAdditions:genome?.policy?.keywordAdditions||{}});}
  route(peers,wanted,taskId,hardLimit=this.c.maxRemoteWorkers){const {genome}=this.policyForTask(taskId);const p=genome?.policy?.router||DEFAULT_ROUTER_POLICY;const limit=Math.max(1,Math.min(Number(hardLimit)||3,Number(p.remoteWorkers)||3));return rankPeers(peers,wanted,limit,p);}
  benchmark(genome){
    const p=normalizePolicy(genome?.policy||{});const peers=syntheticPeers();const cases=[
      {text:'analyze bank finance economics',expected:'finance-specialist'},
      {text:'fix node javascript api bug',expected:'code-specialist'},
      {text:'review legal contract regulation',expected:'legal-specialist'},
      {text:'verify this answer and find errors',expected:'critic-specialist'}
    ];
    let hits=0;const details=[];
    for(const c of cases){const wanted=inferCapabilities(c.text,{keywordAdditions:p.keywordAdditions});const top=rankPeers(peers,wanted,1,p.router)[0]?.nodeId||'';const ok=top===c.expected;if(ok)hits++;details.push({case:c.text,expected:c.expected,selected:top,ok});}
    const routing=hits/cases.length;const workerPenalty=Math.max(0,(p.router.remoteWorkers-3)*0.01);const promptPenalty=Object.values(p.promptSuffixes).reduce((s,x)=>s+Math.min(0.02,x.length/30000),0);const score=Number(Math.max(0,Math.min(1,routing-workerPenalty-promptPenalty)).toFixed(6));return {ok:routing>=.75,score,routing,details};
  }
  validateCandidate(candidate){
    if(!candidate||candidate.version!==1)throw new Error('candidate version mismatch');
    if(candidate.authorNodeId&&typeof candidate.authorNodeId!=='string')throw new Error('bad author');
    const allowed=new Set(['version','parentId','generation','authorNodeId','policy','createdAt','genomeId','status','benchmarkScore','updatedAt','stats']);for(const k of Object.keys(candidate))if(!allowed.has(k))throw new Error(`protected/unknown candidate field: ${k}`);
    const policy=normalizePolicy(candidate.policy||{});const body={version:1,parentId:String(candidate.parentId||''),generation:Number(candidate.generation||0),authorNodeId:String(candidate.authorNodeId||''),policy,createdAt:Number(candidate.createdAt||0)};const id=sha(body);if(candidate.genomeId&&candidate.genomeId!==id)throw new Error('candidate hash mismatch');
    const normalized={...body,genomeId:id};const pool=this.c.evolutionModelPool||[this.c.llmModel];if(normalized.policy.modelChoice&&!pool.includes(normalized.policy.modelChoice))throw new Error('model choice is outside EVOLUTION_MODEL_POOL');const b=this.benchmark(normalized);if(!b.ok||b.score<this.c.evolutionMinBenchmarkScore)throw new Error(`sandbox benchmark failed: ${b.score}`);return {...normalized,benchmarkScore:b.score};
  }
  async propose({reason='auto',useLlm=true}={}){
    if(!this.c.evolutionEnabled)throw new Error('evolution disabled');const parent=this.champion();if(!parent)throw new Error('no champion');let patch=null;
    if(useLlm&&this.c.evolutionLlmProposals&&this.llm){try{patch=await this.proposeWithLlm(parent,reason);}catch(e){this.store.addEvolutionEvent('proposal-llm-fallback',parent.genomeId,{error:e.message});}}
    if(!patch)patch=this.deterministicMutation(parent);
    const policy=this.applyPatch(parent.policy,patch);const candidate=makeGenome({parentId:parent.genomeId,generation:Number(parent.generation)+1,authorNodeId:this.identity.nodeId,policy});const checked=this.validateCandidate(candidate);this.store.upsertEvolutionGenome({...checked,status:'candidate'});this.store.addEvolutionEvent('candidate',checked.genomeId,{reason,parentId:parent.genomeId,benchmarkScore:checked.benchmarkScore});return this.publicGenome(this.store.evolutionGenome(checked.genomeId));
  }
  async proposeWithLlm(parent,reason){
    const telemetry={championStats:this.store.evolutionStats(parent.genomeId,100),peers:this.store.stats?.()||{},reason};
    const sys='You optimize a decentralized AI routing policy. Return ONLY JSON. You may change ONLY router numeric weights, remoteWorkers, promptSuffixes, keywordAdditions, and modelChoice from the supplied model pool. Never propose code, shell commands, URLs, security/ledger/wallet/consensus changes, or instructions to bypass safeguards.';
    const user=JSON.stringify({currentPolicy:parent.policy,telemetry,allowed:{router:{capabilityWeight:[1,8],trustWeight:[0,5],freshnessWeight:[0,3],latencyWeight:[0,3],freshnessWindowMs:[30000,600000],remoteWorkers:[1,6]},promptSuffixes:'short text <=600 chars each',keywordAdditions:'up to 24 short keywords/domain',modelChoice:this.c.evolutionModelPool||[this.c.llmModel]}});
    const out=await this.llm.chat([{role:'system',content:sys},{role:'user',content:user}],{temperature:.35,json:true});let x=JSON.parse(out.content||'{}');if(x.policy)x=x.policy;return x;
  }
  deterministicMutation(parent){
    const p=parent.policy.router;const stats=this.store.evolutionStats(parent.genomeId,100);const slow=stats.avgLatencyMs>20000;const pool=this.c.evolutionModelPool||[this.c.llmModel];let modelChoice=parent.policy.modelChoice||this.c.llmModel;if(slow&&pool.length>1){const i=Math.max(0,pool.indexOf(modelChoice));modelChoice=pool[(i+1)%pool.length];}return {router:{...p,capabilityWeight:clamp(p.capabilityWeight+(slow?.15:.25),1,8),latencyWeight:clamp(p.latencyWeight+(slow?.20:-.05),0,3),remoteWorkers:Math.round(clamp(p.remoteWorkers+(slow?-1:0),1,6))},promptSuffixes:{...parent.policy.promptSuffixes},keywordAdditions:{...parent.policy.keywordAdditions},modelChoice};
  }
  applyPatch(base,patch={}){
    const out=deepClone(base);if(patch.router)Object.assign(out.router,patch.router);if(patch.promptSuffixes)Object.assign(out.promptSuffixes,patch.promptSuffixes);if(patch.keywordAdditions)for(const k of Object.keys(out.keywordAdditions))if(Array.isArray(patch.keywordAdditions[k]))out.keywordAdditions[k]=[...out.keywordAdditions[k],...patch.keywordAdditions[k]];if(patch.modelChoice)out.modelChoice=patch.modelChoice;return normalizePolicy(out);
  }
  importCandidate(candidate,authorNodeId=''){
    if(!this.c.evolutionAcceptRemote)throw new Error('remote evolution disabled');const checked=this.validateCandidate({...candidate,authorNodeId:candidate.authorNodeId||authorNodeId});if(checked.authorNodeId&&authorNodeId&&checked.authorNodeId!==authorNodeId)throw new Error('candidate author mismatch');if(!this.store.evolutionGenome(checked.genomeId)){this.store.upsertEvolutionGenome({...checked,status:'candidate'});this.store.addEvolutionEvent('candidate-imported',checked.genomeId,{authorNodeId});}return this.publicGenome(this.store.evolutionGenome(checked.genomeId));
  }
  startCanary(genomeId){
    if(!this.c.evolutionEnabled)throw new Error('evolution disabled');const g=this.store.evolutionGenome(genomeId);if(!g)throw new Error('candidate not found');if(g.status==='champion')return this.publicGenome(g);this.validateCandidate(g);const old=this.canary();if(old&&old.genomeId!==g.genomeId)this.store.setEvolutionStatus(old.genomeId,'candidate');this.store.setEvolutionStatus(g.genomeId,'canary');this.store.addEvolutionEvent('canary-start',g.genomeId,{share:this.c.evolutionCanaryShare});return this.publicGenome(this.store.evolutionGenome(g.genomeId));
  }
  promote(genomeId=this.canary()?.genomeId,{force=false}={}){
    const g=this.store.evolutionGenome(genomeId);if(!g)throw new Error('genome not found');const champion=this.champion();const gs=this.store.evolutionStats(g.genomeId,200),cs=this.store.evolutionStats(champion.genomeId,200);if(!force){if(gs.samples<this.c.evolutionMinCanarySamples)throw new Error(`need ${this.c.evolutionMinCanarySamples} canary samples`);if(cs.samples>=Math.min(3,this.c.evolutionMinCanarySamples)&&gs.fitness<cs.fitness+this.c.evolutionPromotionMargin)throw new Error(`candidate fitness ${gs.fitness.toFixed(4)} has not exceeded champion ${cs.fitness.toFixed(4)} by margin`);}
    if(champion&&champion.genomeId!==g.genomeId)this.store.setEvolutionStatus(champion.genomeId,'archived');this.store.setEvolutionStatus(g.genomeId,'champion');this.store.clearOtherEvolutionStatus('champion',g.genomeId,'archived');this.store.clearOtherEvolutionStatus('canary',g.genomeId,'candidate');this.store.addEvolutionEvent('promoted',g.genomeId,{previous:champion?.genomeId||'',candidateStats:gs,championStats:cs,force});return this.publicGenome(this.store.evolutionGenome(g.genomeId));
  }
  reject(genomeId=this.canary()?.genomeId,reason='rejected'){
    if(!genomeId)throw new Error('no canary');this.store.setEvolutionStatus(genomeId,'rejected');this.store.addEvolutionEvent('rejected',genomeId,{reason});return {ok:true,genomeId};
  }
  rollback(){
    const current=this.champion();const previous=this.store.evolutionGenomes(100).find(g=>g.status==='archived'&&g.genomeId!==current?.genomeId);if(!previous)throw new Error('no archived champion available');if(current)this.store.setEvolutionStatus(current.genomeId,'archived');this.store.setEvolutionStatus(previous.genomeId,'champion');const canary=this.canary();if(canary)this.store.setEvolutionStatus(canary.genomeId,'candidate');this.store.addEvolutionEvent('rollback',previous.genomeId,{from:current?.genomeId||''});return this.publicGenome(this.store.evolutionGenome(previous.genomeId));
  }
  recordTask({taskId,genomeId,success=true,latencyMs=0,outputChars=0,workerCount=1,userScore=null}){
    const latencyFactor=Math.max(0,1-Math.min(1,Number(latencyMs)/120000));const lengthFactor=Math.min(1,Math.max(.15,Number(outputChars)/1600));const diversity=Math.min(1,Math.max(.2,Number(workerCount)/3));let heuristic=success?.55+.25*lengthFactor+.12*diversity+.08*latencyFactor:0;if(userScore!==null&&Number.isFinite(Number(userScore)))heuristic=.3*heuristic+.7*clamp((Number(userScore)+1)/2,0,1);heuristic=clamp(heuristic,0,1);this.store.addEvolutionObservation({taskId,genomeId,success,latencyMs,outputChars,workerCount,heuristicScore:heuristic,userScore});return heuristic;
  }
  feedback(taskId,score){score=clamp(score,-1,1);const ok=this.store.setEvolutionFeedback(taskId,score);if(!ok)throw new Error('task observation not found');this.store.addEvolutionEvent('feedback','',{taskId,score});return {ok:true,taskId,score};}
  maybeAdvance(){
    const canary=this.canary();if(!canary)return null;const s=this.store.evolutionStats(canary.genomeId,200);if(s.samples<this.c.evolutionMinCanarySamples)return null;const champ=this.champion(),cs=this.store.evolutionStats(champ.genomeId,200);if(s.errorRate>this.c.evolutionMaxErrorRate)return this.reject(canary.genomeId,'error-rate');if(cs.samples&&s.fitness>=cs.fitness+this.c.evolutionPromotionMargin)return this.promote(canary.genomeId);if(s.samples>=this.c.evolutionMaxCanarySamples){if(s.fitness>=(cs.fitness||0))return this.promote(canary.genomeId,{force:true});return this.reject(canary.genomeId,'max-samples-no-improvement');}return null;
  }
  async autoTick(){
    if(!this.c.evolutionEnabled||!this.c.evolutionAuto||this.busy)return;this.busy=true;try{const advanced=this.maybeAdvance();if(advanced)return;const canary=this.canary();if(canary)return;const champ=this.champion(),s=this.store.evolutionStats(champ.genomeId,this.c.evolutionAutoTaskInterval*3);if(s.samples<this.c.evolutionAutoTaskInterval)return;const lastTask=this.store.lastEvolutionObservationAt();if(lastTask&&Date.now()-lastTask<this.c.evolutionIdleMs)return;const last=this.store.evolutionEvents(1)[0];if(last&&Date.now()-last.createdAt<this.c.evolutionMinProposalIntervalMs)return;const candidate=await this.propose({reason:'idle-auto',useLlm:true});this.startCanary(candidate.genomeId);}finally{this.busy=false;}
  }
  start(){if(!this.c.evolutionEnabled||this.timer)return;this.timer=setInterval(()=>this.autoTick().catch(e=>this.store.addEvolutionEvent('auto-error','',{error:e.message})),this.c.evolutionTickMs);this.timer.unref?.();}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
}

export { CONSTITUTION, BASE_PROMPTS, makeGenome, normalizePolicy };
