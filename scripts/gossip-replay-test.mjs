import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Identity } from '../src/identity.js';
import { ReplayGuard } from '../src/security.js';
import { PeerManager } from '../src/peer-manager.js';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nm-gossip-'));
const identity=new Identity(dir,{password:'test-password',allowInsecure:false});
const replay=new ReplayGuard();
const guard={inspectEnvelope:(env)=>replay.inspect(env,300000),verifyEnvelope:(env)=>replay.verify(env,300000),verifyDescriptor:()=>true};
const store={peers:()=>[],upsertPeer:()=>{},setPeerMetrics:()=>{}};
const pm=new PeerManager({config:{networkId:'testnet',bootstrapPeers:[],relayPeers:[],publicUrl:'',privateNode:false,autoReachability:false},identity,store,descriptor:()=>({}),dht:{},guard});
const env=identity.envelope({networkId:'testnet',peers:[]});
const first=pm.acceptGossip(env);
const second=pm.acceptGossip(env);
if(!first?.ok||first.duplicate) throw new Error('first gossip should be accepted');
if(!second?.ok||!second.duplicate) throw new Error('duplicate gossip should be ignored safely');
const bad={...identity.envelope({networkId:'testnet',peers:[]}),signature:'AAAA'};
let rejected=false;
try{pm.acceptGossip(bad);}catch(e){rejected=/invalid gossip/.test(String(e.message));}
if(!rejected) throw new Error('invalid gossip signature was not rejected');
console.log('GOSSIP REPLAY V0.8.1 OK');
