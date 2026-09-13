import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Identity } from '../src/identity.js';
import { ReplayGuard } from '../src/security.js';
import { PeerManager } from '../src/peer-manager.js';
import { DHT } from '../src/dht.js';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'nm-foreign-'));
const id=new Identity(path.join(tmp,'id'),{allowInsecure:true});
const foreign=new Identity(path.join(tmp,'foreign'),{allowInsecure:true});
const peers=[];
const store={
  peers:()=>peers,
  upsertPeer:p=>peers.push(p),
  setPeerMetrics:()=>{},
  hasPeer:()=>false,
  purgeForeignPeers:()=>0
};
const c={networkId:'net-A',protocolVersion:'0.11.2',dhtK:20,dhtAlpha:3,p2pTimeoutMs:1000,bootstrapPeers:[],relayPeers:[],discoveryEnabled:false,dhtRefreshMs:60000,publicUrl:'',privateNode:false,autoReachability:false,port:48686};
const guardObj=new ReplayGuard();
const guard={inspectEnvelope:e=>guardObj.inspect(e,300000),verifyEnvelope:e=>guardObj.verify(e,300000),verifyDescriptor:()=>true};
const descriptor=()=>({nodeId:id.nodeId,publicKey:id.publicPem,networkId:c.networkId,descriptorSignature:'x'});
const dht=new DHT({config:c,identity:id,store,descriptor,guard});
const pm=new PeerManager({config:c,identity:id,store,descriptor,dht,guard});
const hello=foreign.envelope({networkId:'net-B',descriptor:{nodeId:foreign.nodeId,publicKey:foreign.publicPem}});
const gossip=foreign.envelope({networkId:'net-B',peers:[]});
const find=foreign.envelope({networkId:'net-B',target:'0'.repeat(64)});
const announce=foreign.envelope({networkId:'net-B',descriptor:{nodeId:foreign.nodeId,publicKey:foreign.publicPem}});
const a=pm.acceptHello(hello,{remoteIp:'203.0.113.10'});
const b=pm.acceptGossip(gossip);
const c1=dht.acceptFind(find);
const d=dht.acceptAnnounce(announce);
if(!a.foreignNetwork||!b.foreignNetwork||!c1.foreignNetwork||!d.foreignNetwork)throw new Error('foreign network not ignored');
if(peers.length)throw new Error('foreign peer was stored');
console.log('FOREIGN NETWORK V0.11.2 OK');
