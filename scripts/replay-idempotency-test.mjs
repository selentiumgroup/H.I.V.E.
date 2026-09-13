import { PeerManager } from '../src/peer-manager.js';
import { DHT } from '../src/dht.js';

function guardFactory(){
  const seen=new Set();
  return {
    inspectEnvelope(env){
      if(env?.bad)return {ok:false,status:'invalid'};
      const k=env?.nonce;
      if(seen.has(k))return {ok:false,status:'duplicate'};
      seen.add(k);return {ok:true,status:'valid'};
    },
    verifyEnvelope(){return true;},
    verifyDescriptor(d){return !!d?.nodeId;}
  };
}
const store={upsertPeer(){},peers(){return[];},setPeerMetrics(){},hasPeer(){return false;}};
const desc=()=>({nodeId:'b'.repeat(64),networkId:'net',listenPort:48686});
const dhtStub={localClosest(){return[];},iterativeFind:async()=>[]};
const pm=new PeerManager({config:{networkId:'net',protocolVersion:'0.11.1',publicUrl:'',privateNode:true,autoReachability:false},identity:{nodeId:'b'.repeat(64)},store,descriptor:desc,dht:dhtStub,guard:guardFactory()});
const hello={nodeId:'a'.repeat(64),nonce:'same-hello',payload:{networkId:'net',descriptor:{nodeId:'a'.repeat(64),networkId:'net',listenPort:48686}}};
const h1=pm.acceptHello(hello,{remoteIp:'203.0.113.8'});
const h2=pm.acceptHello(hello,{remoteIp:'203.0.113.8'});
if(h1.duplicate!==false&&h1.duplicate!==undefined)throw new Error('first hello flagged duplicate');
if(h2.duplicate!==true)throw new Error('duplicate hello not tolerated');
let invalidHello=false;try{pm.acceptHello({...hello,nonce:'bad',bad:true},{remoteIp:'203.0.113.8'});}catch{invalidHello=true;}
if(!invalidHello)throw new Error('invalid hello accepted');

const g2=guardFactory();
const dht=new DHT({config:{networkId:'net',dhtK:20},identity:{nodeId:'b'.repeat(64)},store,descriptor:desc,guard:g2});
const find={nodeId:'a'.repeat(64),nonce:'same-find',payload:{networkId:'net',target:'c'.repeat(64),descriptor:{nodeId:'a'.repeat(64),networkId:'net'}}};
const f1=dht.acceptFind(find);const f2=dht.acceptFind(find);
if(f1.duplicate!==false&&f1.duplicate!==undefined)throw new Error('first find flagged duplicate');
if(f2.duplicate!==true)throw new Error('duplicate dht find not tolerated');
let invalidFind=false;try{dht.acceptFind({...find,nonce:'bad-find',bad:true});}catch{invalidFind=true;}
if(!invalidFind)throw new Error('invalid dht request accepted');
console.log('IDEMPOTENT REPLAY V0.11.1 OK');
