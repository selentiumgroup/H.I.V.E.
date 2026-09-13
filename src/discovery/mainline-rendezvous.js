import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import { bencode, bdecode, text } from './bencode.js';

function endpointKey(x){return `${x.host}:${x.port}`;}
function splitHostPort(s){
  s=String(s||'').trim();const m=s.match(/^\[([^\]]+)\]:(\d+)$/);if(m)return {host:m[1],port:Number(m[2])};
  const i=s.lastIndexOf(':');if(i<1)return {host:s,port:6881};return {host:s.slice(0,i),port:Number(s.slice(i+1))||6881};
}
function compactPeer(buf){if(!Buffer.isBuffer(buf)||buf.length!==6)return null;return {host:`${buf[0]}.${buf[1]}.${buf[2]}.${buf[3]}`,port:buf.readUInt16BE(4)};}
function compactNodes(buf){
  const out=[];if(!Buffer.isBuffer(buf))return out;
  for(let i=0;i+26<=buf.length;i+=26){const b=buf.subarray(i,i+26);out.push({id:b.subarray(0,20),host:`${b[20]}.${b[21]}.${b[22]}.${b[23]}`,port:b.readUInt16BE(24)});}return out;
}
function xorDistance(a,b){let n=0n;for(let i=0;i<20;i++)n=(n<<8n)|BigInt(a[i]^b[i]);return n;}
function isPrivateIPv4(ip){const a=String(ip).split('.').map(Number);if(a.length!==4||a.some(x=>!Number.isInteger(x)||x<0||x>255))return true;return a[0]===0||a[0]===10||a[0]===127||(a[0]===169&&a[1]===254)||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&a[1]===168)||(a[0]===100&&a[1]>=64&&a[1]<=127)||a[0]>=224;}
function isUsablePeer(p,allowPrivate=false){return p&&p.port>0&&p.port<65536&&p.host&&p.host!=='0.0.0.0'&&(allowPrivate||!isPrivateIPv4(p.host));}

/**
 * Minimal BEP-5 client used only as an external rendezvous substrate.
 * Neural Mesh data never enters the BitTorrent DHT.  We publish a synthetic
 * info-hash and use returned compact peers as candidate HTTP endpoints.
 */
export class MainlineRendezvous {
  constructor({config,identity,onCandidate}){
    this.c=config;this.identity=identity;this.onCandidate=onCandidate;this.socket=null;this.pending=new Map();this.running=false;this.timer=null;this.lookupTimer=null;this.lastCandidates=[];
    this.nodeId=crypto.createHash('sha1').update(`neural-node:${identity.nodeId}`).digest();
    this.infoHash=crypto.createHash('sha1').update(`neural-mesh-rendezvous:${config.networkId}:v1`).digest();
  }
  status(){return {enabled:this.c.mainlineDhtEnabled,running:this.running,udpPort:this.c.mainlineDhtPort,infoHash:this.infoHash.toString('hex'),candidates:this.lastCandidates.slice(0,20)};}
  async resolveBootstrap(){
    const out=[];
    for(const raw of this.c.mainlineDhtBootstrap){const x=splitHostPort(raw);try{const addrs=await dns.lookup(x.host,{all:true,family:4});for(const a of addrs)out.push({host:a.address,port:x.port});}catch{if(/^\d+\.\d+\.\d+\.\d+$/.test(x.host))out.push(x);}}
    return [...new Map(out.map(x=>[endpointKey(x),x])).values()];
  }
  async start(){
    if(!this.c.mainlineDhtEnabled||this.running)return;this.running=true;
    this.socket=dgram.createSocket('udp4');
    this.socket.on('message',(msg,rinfo)=>this.onMessage(msg,rinfo));this.socket.on('error',()=>{});
    await new Promise((resolve,reject)=>{const onErr=e=>{this.socket.off('listening',onListen);reject(e);};const onListen=()=>{this.socket.off('error',onErr);resolve();};this.socket.once('error',onErr);this.socket.once('listening',onListen);this.socket.bind(this.c.mainlineDhtPort,this.c.mainlineDhtHost);});
    await this.cycle().catch(()=>{});
    this.lookupTimer=setInterval(()=>this.cycle().catch(()=>{}),this.c.mainlineLookupMs);this.lookupTimer.unref?.();
  }
  stop(){this.running=false;if(this.lookupTimer)clearInterval(this.lookupTimer);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('rendezvous stopped'));}this.pending.clear();try{this.socket?.close();}catch{}this.socket=null;}
  onMessage(msg){
    let x;try{x=bdecode(msg);}catch{return;}const tid=Buffer.isBuffer(x?.t)?x.t.toString('hex'):'';const p=this.pending.get(tid);if(!p)return;this.pending.delete(tid);clearTimeout(p.timer);if(text(x.y)==='r')p.resolve(x.r||{});else p.reject(new Error('dht error response'));
  }
  query(peer,q,a,timeout=this.c.mainlineQueryTimeoutMs){
    if(!this.socket)return Promise.reject(new Error('dht socket not started'));let tid;
    do{tid=crypto.randomBytes(2);}while(this.pending.has(tid.toString('hex')));const key=tid.toString('hex');const packet=bencode({t:tid,y:'q',q,a});
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(key);reject(new Error('dht query timeout'));},timeout);timer.unref?.();this.pending.set(key,{resolve,reject,timer});this.socket.send(packet,peer.port,peer.host,e=>{if(e){clearTimeout(timer);this.pending.delete(key);reject(e);}});});
  }
  async getPeers(peer){return this.query(peer,'get_peers',{id:this.nodeId,info_hash:this.infoHash});}
  async announce(peer,token){return this.query(peer,'announce_peer',{id:this.nodeId,info_hash:this.infoHash,port:this.c.port,token,implied_port:0});}
  async cycle(){
    if(!this.running)return [];
    const seeds=await this.resolveBootstrap();if(!seeds.length)return [];
    const nodes=new Map(),queried=new Set(),tokens=[],found=new Map();
    const ingest=(r,source)=>{
      if(Buffer.isBuffer(r?.token))tokens.push({peer:source,token:r.token,id:source.id||null});
      for(const v of r?.values||[]){const p=compactPeer(v);if(isUsablePeer(p,this.c.mainlineAllowPrivateCandidates))found.set(endpointKey(p),p);}
      for(const n of compactNodes(r?.nodes)){if(isUsablePeer(n,true))nodes.set(endpointKey(n),n);}
    };
    await Promise.allSettled(seeds.map(async s=>{try{ingest(await this.getPeers(s),s);}catch{}}));
    for(let round=0;round<this.c.mainlineRounds;round++){
      const queue=[...nodes.values()].filter(n=>!queried.has(endpointKey(n))).sort((a,b)=>{const da=xorDistance(a.id,this.infoHash),db=xorDistance(b.id,this.infoHash);return da<db?-1:da>db?1:0;}).slice(0,this.c.mainlineAlpha);if(!queue.length)break;
      await Promise.allSettled(queue.map(async n=>{queried.add(endpointKey(n));try{ingest(await this.getPeers(n),n);}catch{}}));
    }
    const uniqueTokens=[...new Map(tokens.map(x=>[endpointKey(x.peer),x])).values()].sort((a,b)=>{if(!a.id)return 1;if(!b.id)return-1;const da=xorDistance(a.id,this.infoHash),db=xorDistance(b.id,this.infoHash);return da<db?-1:da>db?1:0;}).slice(0,this.c.mainlineAnnounceNodes);
    if(this.c.mainlineDhtAnnounce)await Promise.allSettled(uniqueTokens.map(x=>this.announce(x.peer,x.token)));
    const candidates=[...found.values()].filter(p=>!(p.port===this.c.port&&(p.host==='127.0.0.1'||p.host==='0.0.0.0'))).slice(0,this.c.mainlineMaxCandidates);this.lastCandidates=candidates.map(x=>`http://${x.host}:${x.port}`);
    const dial=candidates.slice(0,this.c.mainlineDialLimit);await Promise.allSettled(dial.map(p=>Promise.resolve(this.onCandidate?.(`http://${p.host}:${p.port}`,'mainline-dht'))));
    return candidates;
  }
}
