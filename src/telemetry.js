import os from 'node:os';
import { Identity } from './identity.js';
import { postJson } from './protocol.js';
import { peerEndpoint } from './peers.js';

function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
function round(n,d=2){const p=10**d;return Math.round((Number(n)||0)*p)/p;}
function safeJson(x,fallback=[]){try{return JSON.parse(x||'');}catch{return fallback;}}
function sum(xs,f){return xs.reduce((a,x)=>a+(Number(f(x))||0),0);}

export class Telemetry {
  constructor({config,identity,store,hardware,llm,ledger,evolution,collective,knowledge,validatorStatus,descriptor,relay,contentStore=null}){
    this.c=config;this.identity=identity;this.store=store;this.hardware=hardware;this.llm=llm;this.ledger=ledger;this.evolution=evolution;this.collective=collective;this.knowledge=knowledge;this.validatorStatus=validatorStatus;this.descriptor=descriptor;this.relay=relay;this.contentStore=contentStore;
    this.startedAt=Date.now();this.cache={at:0,value:null};this.pending=null;
  }
  taskMetrics(){
    const now=Date.now(),min=now-60_000,hour=now-3_600_000;
    const rows=this.store.db.prepare('SELECT route,created_at FROM tasks WHERE created_at>=? ORDER BY created_at DESC LIMIT 2000').all(hour);
    const minRows=rows.filter(r=>Number(r.created_at)>=min);let latencies=[],workers=0;
    for(const r of rows){for(const x of safeJson(r.route,[])){if(Number.isFinite(Number(x.latencyMs)))latencies.push(Number(x.latencyMs));workers++;}}
    latencies.sort((a,b)=>a-b);const pct=p=>latencies.length?latencies[Math.min(latencies.length-1,Math.floor((latencies.length-1)*p))]:0;
    return {tasksPerMinute:minRows.length,tasksLastHour:rows.length,avgWorkers:rows.length?round(workers/rows.length,2):0,avgLatencyMs:latencies.length?round(sum(latencies,x=>x)/latencies.length,0):0,p50LatencyMs:round(pct(.5),0),p95LatencyMs:round(pct(.95),0)};
  }
  counts(){
    const db=this.store.db,one=(sql)=>Number(db.prepare(sql).get()?.n||0);
    return {knowledgeArtifacts:one("SELECT COUNT(*) n FROM knowledge_artifacts WHERE status='active'"),federatedRounds:one('SELECT COUNT(*) n FROM federated_rounds'),genomes:one('SELECT COUNT(*) n FROM evolution_genomes'),tournaments:one('SELECT COUNT(*) n FROM collective_tournaments'),evolutionAnchors:one("SELECT COUNT(*) n FROM evolution_anchors WHERE status='anchored'"),receipts:one('SELECT COUNT(*) n FROM receipts')};
  }
  async localSnapshot(){
    const head=this.ledger.head(),llm=await this.llm.health().catch(()=>({ok:false,model:this.c.llmModel,provider:this.c.llmProvider}));const evo=this.evolution.status(),col=this.collective.status(),learning=this.knowledge.status(),v=this.validatorStatus();
    const d=this.descriptor(),memTotal=os.totalmem(),memFree=os.freemem(),gpus=this.hardware.gpu||[];
    return {version:1,networkId:this.c.networkId,protocolVersion:this.c.protocolVersion,ts:Date.now(),nodeId:this.identity.nodeId,url:d.url||'',relayUrl:d.relayUrl||'',mode:d.url?'direct':(d.relayUrl?'relay':'local'),capabilities:d.capabilities||[],hardware:{accelerator:this.hardware.accelerator,cpuCores:this.hardware.cpuCores,ramGiB:this.hardware.ramGiB,gpuCount:gpus.length,vramMiB:sum(gpus,g=>g.memoryMiB),gpu:gpus.map(g=>({name:g.name,memoryMiB:g.memoryMiB}))},runtime:{uptimeSec:round(process.uptime(),0),load1:round(os.loadavg()[0],2),load5:round(os.loadavg()[1],2),ramUsedGiB:round((memTotal-memFree)/1024**3,2),ramFreeGiB:round(memFree/1024**3,2),rssMiB:round(process.memoryUsage().rss/1024**2,0)},llm:{ok:!!llm.ok,model:llm.model||this.c.llmModel,provider:llm.provider||this.c.llmProvider},metrics:this.taskMetrics(),counts:this.counts(),ledger:{height:Number(head.index),head:head.hash,totalSupplyNRN:this.ledger.supply(),finalized:head.finalized!==false},validator:{eligible:(v.eligibleValidators||[]).includes(this.identity.nodeId),bondNRN:v.bond?.nrn||'0',committeeSize:(v.nextCommittee||[]).length},evolution:{championId:evo.champion?.genomeId||'',generation:evo.champion?.generation||0,fitness:Number(evo.champion?.stats?.fitness||0),canaryId:evo.canary?.genomeId||'',genePool:(col.genePool||[]).length,species:new Set((col.genePool||[]).map(x=>x.speciesId).filter(Boolean)).size,tournaments:(col.tournaments||[]).length,anchored:this.counts().evolutionAnchors},learning:{artifacts:(learning.artifacts||[]).length,currentRound:learning.currentRound||'',currentUpdates:Number(learning.currentUpdates)||0,rounds:(learning.rounds||[]).length},content:this.contentStore?.stats?.()||{objects:0,bytes:0,providers:0,replicationTarget:0},peers:this.store.peers().map(p=>({nodeId:p.nodeId,lastSeen:Number(p.lastSeen),latencyMs:round(p.latencyMs,0),trust:round(p.trust,3),mode:p.url?'direct':(p.relayUrl?'relay':'unknown')}))};
  }
  verifyRemoteProof(proof,expectedNodeId=''){
    if(!proof||!Identity.verifyEnvelope(proof,60_000))return null;const p=proof.payload;if(p?.type!=='telemetry-snapshot'||p?.networkId!==this.c.networkId||!p.snapshot)return null;if(expectedNodeId&&proof.nodeId!==expectedNodeId)return null;if(p.snapshot.nodeId!==proof.nodeId)return null;return p.snapshot;
  }
  async fetchPeer(peer){
    const payload={networkId:this.c.networkId,type:'telemetry-request',requestedAt:Date.now()},env=this.identity.envelope(payload),u=peerEndpoint(peer);let x;
    if(u)x=await postJson(u,'/p2p/telemetry',env,3500);else if(peer.relayUrl)x=await this.relay.sendViaRelay(peer,'telemetry',{request:env});else throw new Error('peer unavailable');
    const proof=x?.proof||x;const snap=this.verifyRemoteProof(proof,peer.nodeId);if(!snap)throw new Error('invalid telemetry proof');return snap;
  }
  aggregate(nodes){
    const live=nodes.filter(n=>Date.now()-Number(n.ts||0)<120_000),gpu=live.filter(n=>Number(n.hardware?.gpuCount)>0),cpu=live.filter(n=>!Number(n.hardware?.gpuCount));const taskRate=sum(live,n=>n.metrics?.tasksPerMinute);const lats=live.map(n=>Number(n.metrics?.avgLatencyMs)||0).filter(Boolean);const supply=live.map(n=>Number(n.ledger?.totalSupplyNRN)||0).sort((a,b)=>b-a)[0]||0;const heights=live.map(n=>Number(n.ledger?.height)||0);
    const models={};for(const n of live){const k=n.llm?.model||'unknown';models[k]=(models[k]||0)+1;}
    return {liveNeurons:live.length,gpuNodes:gpu.length,cpuNodes:cpu.length,totalCpuCores:sum(live,n=>n.hardware?.cpuCores),totalRamGiB:round(sum(live,n=>n.hardware?.ramGiB),1),totalVramGiB:round(sum(live,n=>n.hardware?.vramMiB)/1024,1),tasksPerMinute:taskRate,avgLatencyMs:lats.length?round(sum(lats,x=>x)/lats.length,0):0,ledgerHeight:heights.length?Math.max(...heights):0,totalSupplyNRN:supply,validators:live.filter(n=>n.validator?.eligible).length,knowledgeArtifacts:Math.max(0,...live.map(n=>Number(n.counts?.knowledgeArtifacts)||0)),federatedRounds:Math.max(0,...live.map(n=>Number(n.counts?.federatedRounds)||0)),genePool:Math.max(0,...live.map(n=>Number(n.evolution?.genePool)||0)),species:Math.max(0,...live.map(n=>Number(n.evolution?.species)||0)),anchoredEvolution:Math.max(0,...live.map(n=>Number(n.evolution?.anchored)||0)),contentObjects:Math.max(0,...live.map(n=>Number(n.content?.objects)||0)),contentReplicaRecords:sum(live,n=>n.content?.providers),models};
  }
  edges(nodes){const known=new Set(nodes.map(n=>n.nodeId)),seen=new Set(),out=[];for(const n of nodes){for(const p of n.peers||[]){if(!known.has(p.nodeId)||p.nodeId===n.nodeId)continue;const a=[n.nodeId,p.nodeId].sort(),k=a.join(':');if(seen.has(k))continue;seen.add(k);out.push({source:a[0],target:a[1],latencyMs:Number(p.latencyMs)||0,trust:Number(p.trust)||0,mode:p.mode||''});}}return out;}
  async explorer({force=false}={}){
    if(!force&&this.cache.value&&Date.now()-this.cache.at<5000)return this.cache.value;if(this.pending)return this.pending;
    this.pending=(async()=>{const local=await this.localSnapshot(),peers=this.store.peers().filter(p=>p.nodeId!==this.identity.nodeId).slice(0,48);const settled=await Promise.allSettled(peers.map(p=>this.fetchPeer(p)));const remotes=settled.filter(x=>x.status==='fulfilled').map(x=>x.value);const map=new Map([[local.nodeId,local],...remotes.map(n=>[n.nodeId,n])]);const nodes=[...map.values()].sort((a,b)=>a.nodeId.localeCompare(b.nodeId)),value={generatedAt:Date.now(),networkId:this.c.networkId,protocolVersion:this.c.protocolVersion,summary:this.aggregate(nodes),nodes,edges:this.edges(nodes),unreachable:peers.filter(p=>!map.has(p.nodeId)).map(p=>({nodeId:p.nodeId,lastSeen:p.lastSeen,failures:p.failures,mode:p.url?'direct':(p.relayUrl?'relay':'unknown')}))};this.cache={at:Date.now(),value};return value;})();
    try{return await this.pending;}finally{this.pending=null;}
  }
}
