import crypto from 'node:crypto';
import { postJson, sleep } from './protocol.js';

function cleanUrl(u){return String(u||'').replace(/\/$/,'');}

export class RelayService {
  constructor({config,identity,store,descriptor,onInfer,onValidate,onCommit,onTransaction,onEvolution,onLearning,onEvolutionAnchorValidate,onTelemetry,onConsensus,onGovernance,onConstitution,guard}){
    this.c=config;this.identity=identity;this.store=store;this.descriptor=descriptor;this.onInfer=onInfer;this.onValidate=onValidate;this.onCommit=onCommit;this.onTransaction=onTransaction;this.onEvolution=onEvolution;this.onLearning=onLearning;this.onEvolutionAnchorValidate=onEvolutionAnchorValidate;this.onTelemetry=onTelemetry;this.onConsensus=onConsensus;this.onGovernance=onGovernance;this.onConstitution=onConstitution;this.guard=guard;
    this.queues=new Map();this.waiters=new Map();this.running=false;this.loopPromise=null;this.activeRelay=cleanUrl(this.c.relayPeers[0]||'');this.candidates=[];
  }
  status(){return {enabled:this.c.relayEnabled,activeRelay:this.activeRelay,clientMode:!this.c.publicUrl&&!!this.activeRelay};}
  addRelayCandidate(url){url=cleanUrl(url);if(!url||url===this.c.publicUrl)return;if(!this.candidates.includes(url))this.candidates.push(url);if(!this.activeRelay)this.activeRelay=url;if(!this.c.publicUrl)this.start();}
  acceptRegister(env,relayEndpoint=''){
    if(!this.c.relayEnabled)throw new Error('relay disabled');if(!this.guard.verifyEnvelope(env)||env.payload?.networkId!==this.c.networkId)throw new Error('invalid/replayed relay registration');const d=env.payload.descriptor;
    if(!d?.nodeId||d.nodeId!==env.nodeId||!this.guard.verifyDescriptor(d))throw new Error('descriptor mismatch/admission');
    const endpoint=cleanUrl(relayEndpoint);if(d.url||!d.relayUrl||cleanUrl(d.relayUrl)!==endpoint)throw new Error('private descriptor relay binding mismatch');
    this.store.upsertPeer(d);return {ok:true,relayUrl:endpoint,descriptor:this.descriptor()};
  }
  async acceptSend(env){if(!this.c.relayEnabled)throw new Error('relay disabled');if(!this.guard.verifyEnvelope(env)||env.payload?.networkId!==this.c.networkId)throw new Error('invalid/replayed relay message');const {destination,kind,payload}=env.payload;if(!destination||!kind)throw new Error('invalid relay destination');const requestId=crypto.randomUUID();const msg={requestId,source:env.nodeId,destination,kind,payload,createdAt:Date.now()};const q=this.queues.get(destination)||[];q.push(msg);this.queues.set(destination,q);return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.waiters.delete(requestId);reject(new Error('relay response timeout'));},this.c.llmTimeoutMs+10000);this.waiters.set(requestId,{destination,resolve:(v)=>{clearTimeout(timer);resolve(v);},reject});});}
  acceptPoll(env){if(!this.c.relayEnabled)throw new Error('relay disabled');if(!this.guard.verifyEnvelope(env)||env.payload?.networkId!==this.c.networkId)throw new Error('invalid/replayed relay poll');const q=this.queues.get(env.nodeId)||[];const messages=q.splice(0,8);this.queues.set(env.nodeId,q);return {messages};}
  acceptRespond(env){if(!this.c.relayEnabled)throw new Error('relay disabled');if(!this.guard.verifyEnvelope(env)||env.payload?.networkId!==this.c.networkId)throw new Error('invalid/replayed relay response');const {requestId,result,error}=env.payload;const w=this.waiters.get(requestId);if(!w)return {ok:false,reason:'request expired'};if(env.nodeId!==w.destination)throw new Error('relay response source mismatch');this.waiters.delete(requestId);w.resolve(error?{error}:{result});return {ok:true};}
  async sendViaRelay(peer,kind,payload){if(!peer.relayUrl)throw new Error('peer has no relay');const x=await postJson(peer.relayUrl,'/p2p/relay/send',this.identity.envelope({networkId:this.c.networkId,destination:peer.nodeId,kind,payload}),this.c.llmTimeoutMs+15000);if(x.error)throw new Error(x.error);return x.result;}
  async register(){
    if(this.c.publicUrl||!this.activeRelay)return;const d={...this.descriptor(),url:'',relayUrl:this.activeRelay};
    await postJson(this.activeRelay,'/p2p/relay/register',this.identity.envelope({networkId:this.c.networkId,descriptor:d}),8000);this.store.upsertPeer({...d,nodeId:this.identity.nodeId});
  }
  rotateRelay(){if(this.candidates.length<2)return;const i=Math.max(0,this.candidates.indexOf(this.activeRelay));this.activeRelay=this.candidates[(i+1)%this.candidates.length];}
  async pollLoop(){
    this.running=true;let failures=0;
    while(this.running){
      if(this.c.publicUrl||!this.activeRelay){await sleep(this.c.relayPollMs);continue;}
      try{await this.register();const r=await postJson(this.activeRelay,'/p2p/relay/poll',this.identity.envelope({networkId:this.c.networkId}),8000);failures=0;for(const m of r.messages||[]){let result=null,error=null;try{if(m.kind==='infer')result=await this.onInfer(m.payload);else if(m.kind==='validate')result=await this.onValidate(m.payload);else if(m.kind==='commit')result=await this.onCommit(m.payload,m.source);else if(m.kind==='transaction')result=await this.onTransaction(m.payload);else if(m.kind==='evolution')result=await this.onEvolution(m.payload,m.source);else if(m.kind==='learning')result=await this.onLearning(m.payload,m.source);else if(m.kind==='evolution-anchor-validate')result={vote:await this.onEvolutionAnchorValidate(m.payload,m.source)};else if(m.kind==='telemetry')result=await this.onTelemetry(m.payload,m.source);else if(m.kind==='consensus')result=await this.onConsensus(m.payload,m.source);else if(m.kind==='governance')result=await this.onGovernance(m.payload,m.source);else if(m.kind==='constitution')result=await this.onConstitution(m.payload,m.source);else throw new Error('unsupported relay kind');}catch(e){error=e.message;}await postJson(this.activeRelay,'/p2p/relay/respond',this.identity.envelope({networkId:this.c.networkId,requestId:m.requestId,result,error}),8000);}}
      catch{failures++;if(failures>=3){this.rotateRelay();failures=0;}}
      await sleep(this.c.relayPollMs);
    }
  }
  start(){if(!this.loopPromise){this.loopPromise=this.pollLoop().finally(()=>{this.loopPromise=null;});}}
  stop(){this.running=false;}
}
