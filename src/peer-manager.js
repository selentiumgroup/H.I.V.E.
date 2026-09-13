import dgram from 'node:dgram';
import { postJson } from './protocol.js';
import { peerEndpoint, descriptorView } from './peers.js';

function cleanUrl(u){return String(u||'').replace(/\/$/,'');}
function httpUrl(ip,port){
  if(!ip||!Number.isInteger(Number(port))||Number(port)<1||Number(port)>65535)return '';
  const host=String(ip).includes(':')?`[${String(ip).replace(/^\[|\]$/g,'')}]`:String(ip);
  return `http://${host}:${Number(port)}`;
}

export class PeerManager {
  constructor({config,identity,store,descriptor,dht,onPeer,onRelayCandidate,onPublicUrl,guard}){
    this.c=config;this.identity=identity;this.store=store;this.descriptor=descriptor;this.dht=dht;this.onPeer=onPeer;this.onRelayCandidate=onRelayCandidate;this.onPublicUrl=onPublicUrl;this.guard=guard;this.socket=null;this.timers=[];this.seeds=new Set();this.reachabilityBusy=false;
  }
  async start(){
    const purged=this.store.purgeForeignPeers?.(this.c.networkId)||0;if(purged)console.log(`[p2p] purged ${purged} cached peer(s) from foreign NETWORK_ID`);
    for(const u of [...this.c.bootstrapPeers,...this.c.relayPeers])this.addSeed(u);
    for(const p of this.store.peers())if(!p.networkId||p.networkId===this.c.networkId)this.addSeed(peerEndpoint(p));
    await this.bootstrap();
    if(this.c.discoveryEnabled)this.startLan();
    for(const delay of [250,750,1500,3000]){const t=setTimeout(()=>this.bootstrap().catch(()=>{}),delay);t.unref?.();this.timers.push(t);}
    this.timers.push(setInterval(()=>this.bootstrap().catch(()=>{}),5000));
    this.timers.push(setInterval(()=>this.gossip().catch(()=>{}),8000));
    this.timers.push(setInterval(()=>this.announceLan(),5000));
    this.timers.push(setInterval(()=>this.dht.refresh().catch(()=>{}),this.c.dhtRefreshMs));
    await this.dht.iterativeFind(this.identity.nodeId).catch(()=>{});await this.dht.announce().catch(()=>{});
  }
  addSeed(url){url=cleanUrl(url);if(url)this.seeds.add(url);}
  async discoverCandidate(url,source='external'){url=cleanUrl(url);if(!url)return;this.addSeed(url);return this.join(url,{source});}
  async bootstrap(){
    for(const p of this.store.peers())if(!p.networkId||p.networkId===this.c.networkId)this.addSeed(peerEndpoint(p));
    await Promise.allSettled([...this.seeds].slice(0,64).map(u=>this.join(u,{source:'cache/bootstrap'})));
  }
  stop(){for(const t of this.timers)clearInterval(t);try{this.socket?.close();}catch{}}
  startLan(){
    try{
      const s=dgram.createSocket({type:'udp4',reuseAddr:true});this.socket=s;
      s.on('message',(buf,rinfo)=>{try{const x=JSON.parse(buf.toString());if(x.networkId!==this.c.networkId||x.nodeId===this.identity.nodeId)return;const u=httpUrl(rinfo.address,Number(x.port));if(u)this.discoverCandidate(u,'lan').catch(()=>{});}catch{}});
      s.bind(this.c.discoveryPort,()=>{try{s.addMembership(this.c.discoveryGroup);s.setMulticastTTL(1);this.announceLan();}catch{}});
    }catch{}
  }
  announceLan(){if(!this.socket)return;try{const msg=Buffer.from(JSON.stringify({networkId:this.c.networkId,nodeId:this.identity.nodeId,port:this.c.port}));this.socket.send(msg,this.c.discoveryPort,this.c.discoveryGroup);}catch{}}
  async maybeEstablishReachability(viaUrl,observedIp,remoteDescriptor){
    if(this.c.publicUrl||this.c.privateNode||!this.c.autoReachability||this.reachabilityBusy)return;
    this.reachabilityBusy=true;
    try{
      const probe=await postJson(viaUrl,'/p2p/probe-me',this.identity.envelope({networkId:this.c.networkId,listenPort:this.c.port,expectedNodeId:this.identity.nodeId}),6000);
      if(probe?.reachable&&probe.url){this.c.publicUrl=cleanUrl(probe.url);await this.onPublicUrl?.(this.c.publicUrl);return;}
    }catch{}
    finally{this.reachabilityBusy=false;}
    if(!this.c.publicUrl&&remoteDescriptor?.relayCapable)await this.onRelayCandidate?.(viaUrl,remoteDescriptor);
  }
  async join(url,{source='unknown'}={}){
    url=cleanUrl(url);if(!url||url===this.c.publicUrl)return null;
    const st=Date.now();
    const res=await postJson(url,'/p2p/hello',this.identity.envelope({networkId:this.c.networkId,descriptor:this.descriptor()}),8000);
    if(res?.foreignNetwork||res?.networkId!==this.c.networkId){this.seeds.delete(url);return null;}
    if(!res.descriptor||!this.guard.verifyDescriptor(res.descriptor))return null;
    if(res.descriptor.nodeId===this.identity.nodeId)return null;
    const p={...res.descriptor,latencyMs:Date.now()-st};
    this.store.upsertPeer(p,{dialUrl:url});this.store.setPeerMetrics(p.nodeId,p.latencyMs,true);this.addSeed(url);
    for(const q of res.peers||[])if(q.nodeId!==this.identity.nodeId&&this.guard.verifyDescriptor(q)){this.store.upsertPeer(q);if(q.url)this.addSeed(q.url);}
    await this.maybeEstablishReachability(url,res.observedIp,p);
    if(!this.c.publicUrl&&p.relayCapable)await this.onRelayCandidate?.(url,p);
    await this.dht.iterativeFind(this.identity.nodeId).catch(()=>{});await this.onPeer?.({...p,dialUrl:url},res,source);return p;
  }
  acceptHello(env,{remoteIp}={}){
    const replay=this.guard.inspectEnvelope?this.guard.inspectEnvelope(env):null;
    if(replay){
      if(!replay.ok&&replay.status!=='duplicate')throw new Error('invalid hello envelope');
    }else if(!this.guard.verifyEnvelope(env))throw new Error('invalid hello envelope');
    if(env.payload?.networkId!==this.c.networkId)return {ok:false,foreignNetwork:true,networkId:this.c.networkId,protocolVersion:this.c.protocolVersion};
    const p=env.payload.descriptor;if(!p?.nodeId||p.nodeId!==env.nodeId||!this.guard.verifyDescriptor(p))throw new Error('invalid descriptor/admission');
    if(replay?.status!=='duplicate'){const dialUrl=httpUrl(remoteIp,Number(p.listenPort));this.store.upsertPeer(p,{dialUrl});if(dialUrl)this.addSeed(dialUrl);}
    return {networkId:this.c.networkId,protocolVersion:this.c.protocolVersion,descriptor:this.descriptor(),peers:this.dht.localClosest(env.nodeId),observedIp:remoteIp||'',ledger:null,duplicate:replay?.status==='duplicate'};
  }
  async acceptProbeMe(env,{remoteIp}={}){
    const replay=this.guard.inspectEnvelope?this.guard.inspectEnvelope(env):null;
    if(replay){if(!replay.ok&&replay.status!=='duplicate')throw new Error('invalid probe');}else if(!this.guard.verifyEnvelope(env))throw new Error('invalid probe');
    if(env.payload?.networkId!==this.c.networkId)return {ok:false,foreignNetwork:true,networkId:this.c.networkId,reachable:false};
    const port=Number(env.payload.listenPort);if(!Number.isInteger(port)||port<1||port>65535||env.payload.expectedNodeId!==env.nodeId)throw new Error('invalid probe request');
    const candidate=httpUrl(remoteIp,port);if(!candidate)return {reachable:false};
    try{const r=await postJson(candidate,'/p2p/ping',this.identity.envelope({networkId:this.c.networkId,expectedNodeId:env.nodeId}),4000);return {reachable:r?.descriptor?.nodeId===env.nodeId,url:candidate};}catch{return {reachable:false};}
  }
  acceptPing(env){
    const replay=this.guard.inspectEnvelope?this.guard.inspectEnvelope(env):null;
    if(replay){if(!replay.ok&&replay.status!=='duplicate')throw new Error('invalid ping');}else if(!this.guard.verifyEnvelope(env))throw new Error('invalid ping');
    if(env.payload?.networkId!==this.c.networkId)return {ok:false,foreignNetwork:true,networkId:this.c.networkId};
    if(env.payload.expectedNodeId&&env.payload.expectedNodeId!==this.identity.nodeId)throw new Error('wrong target node');
    return {ok:true,descriptor:this.descriptor()};
  }
  async gossip(){
    const ps=this.store.peers().filter(p=>peerEndpoint(p)&&p.nodeId!==this.identity.nodeId).slice(0,16);if(!ps.length)return;
    const payload=this.identity.envelope({networkId:this.c.networkId,peers:[this.descriptor(),...this.store.peers().slice(0,32).map(descriptorView)]});
    await Promise.allSettled(ps.slice(0,4).map(async p=>{const u=peerEndpoint(p),st=Date.now();try{await postJson(u,'/p2p/gossip',payload,5000);this.store.setPeerMetrics(p.nodeId,Date.now()-st,true);}catch{this.store.setPeerMetrics(p.nodeId,9999,false);}}));
  }
  acceptGossip(env){
    const replay=this.guard.inspectEnvelope?this.guard.inspectEnvelope(env):null;
    if(replay){
      if(replay.status==='duplicate')return {ok:true,duplicate:true};
      if(!replay.ok)throw new Error('invalid gossip');
    }else if(!this.guard.verifyEnvelope(env))throw new Error('invalid gossip');
    if(env.payload?.networkId!==this.c.networkId)return {ok:true,ignored:true,foreignNetwork:true,networkId:this.c.networkId};
    for(const p of env.payload.peers||[])if(p.nodeId!==this.identity.nodeId&&this.guard.verifyDescriptor(p)){this.store.upsertPeer(p);if(p.url){this.addSeed(p.url);queueMicrotask(()=>this.join(p.url,{source:'gossip'}).catch(()=>{}));}}
    return {ok:true,duplicate:false};
  }
}
