import crypto from 'node:crypto';
import { postJson } from './protocol.js';
import { peerEndpoint, descriptorView } from './peers.js';

function idBig(id){try{return BigInt('0x'+String(id).padStart(64,'0').slice(-64));}catch{return 0n;}}
export function xorDistance(a,b){return idBig(a)^idBig(b);}
export function randomNodeId(){return crypto.randomBytes(32).toString('hex');}
export function closestPeers(peers,target,k=20){const seen=new Set();return peers.filter(p=>p?.nodeId&&!seen.has(p.nodeId)&&seen.add(p.nodeId)).map(p=>({p,d:xorDistance(p.nodeId,target)})).sort((a,b)=>a.d<b.d?-1:a.d>b.d?1:0).slice(0,k).map(x=>x.p);}

export class DHT {
  constructor({config,identity,store,descriptor,guard}){this.c=config;this.identity=identity;this.store=store;this.descriptor=descriptor;this.guard=guard;}
  localClosest(target){return closestPeers([this.descriptor(),...this.store.peers().map(descriptorView)],target,this.c.dhtK);}
  acceptFind(env){
    const replay=this.guard.inspectEnvelope?this.guard.inspectEnvelope(env):null;
    if(replay){if(!replay.ok&&replay.status!=='duplicate')throw new Error('invalid dht request');}else if(!this.guard.verifyEnvelope(env))throw new Error('invalid dht request');
    if(env.payload?.networkId!==this.c.networkId)return {ok:true,ignored:true,foreignNetwork:true,networkId:this.c.networkId,peers:[]};
    const d=env.payload?.descriptor;if(replay?.status!=='duplicate'&&d?.nodeId===env.nodeId&&this.guard.verifyDescriptor(d))this.store.upsertPeer(d);
    const target=env.payload?.target;if(!/^[0-9a-f]{64}$/i.test(target||''))throw new Error('invalid target');return {networkId:this.c.networkId,peers:this.localClosest(target),duplicate:replay?.status==='duplicate'};
  }
  acceptAnnounce(env){
    const replay=this.guard.inspectEnvelope?this.guard.inspectEnvelope(env):null;
    if(replay){if(!replay.ok&&replay.status!=='duplicate')throw new Error('invalid dht announce');}else if(!this.guard.verifyEnvelope(env))throw new Error('invalid dht announce');
    if(env.payload?.networkId!==this.c.networkId)return {ok:true,ignored:true,foreignNetwork:true,networkId:this.c.networkId};const d=env.payload?.descriptor;if(!d?.nodeId||d.nodeId!==env.nodeId||!this.guard.verifyDescriptor(d))throw new Error('descriptor mismatch/admission failure');if(replay?.status!=='duplicate')this.store.upsertPeer(d);return {ok:true,duplicate:replay?.status==='duplicate'};
  }
  async iterativeFind(target){
    let known=closestPeers(this.store.peers(),target,this.c.dhtK);const queried=new Set();let rounds=0;
    while(rounds++<8){const batch=known.filter(p=>peerEndpoint(p)&&!queried.has(p.nodeId)).slice(0,this.c.dhtAlpha);if(!batch.length)break;for(const p of batch)queried.add(p.nodeId);
      const replies=await Promise.allSettled(batch.map(p=>postJson(peerEndpoint(p),'/p2p/dht/find-node',this.identity.envelope({networkId:this.c.networkId,target,descriptor:this.descriptor()}),this.c.p2pTimeoutMs)));let added=0;
      for(const r of replies){if(r.status!=='fulfilled')continue;for(const p of r.value.peers||[]){if(p.nodeId!==this.identity.nodeId&&this.guard.verifyDescriptor(p)){const before=this.store.hasPeer(p.nodeId);this.store.upsertPeer(p);if(!before)added++;}}}known=closestPeers(this.store.peers(),target,this.c.dhtK);if(!added&&batch.every(p=>queried.has(p.nodeId)))break;
    }return known;
  }
  async announce(){const peers=closestPeers(this.store.peers().filter(p=>peerEndpoint(p)),this.identity.nodeId,Math.min(5,this.c.dhtK));const env=this.identity.envelope({networkId:this.c.networkId,descriptor:this.descriptor()});await Promise.allSettled(peers.map(p=>postJson(peerEndpoint(p),'/p2p/dht/announce',env,5000)));}
  async refresh(){await this.iterativeFind(randomNodeId());await this.iterativeFind(this.identity.nodeId);await this.announce();}
}
