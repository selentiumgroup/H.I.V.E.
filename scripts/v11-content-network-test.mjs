import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Identity} from '../src/identity.js';import {Store} from '../src/db.js';import {ContentStore} from '../src/content-store.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nm-v11-content-'));
function mk(name){const d=path.join(root,name);fs.mkdirSync(d,{recursive:true});const id=new Identity(d,{password:'content-test-pass'}),store=new Store(d),config={contentStoreDir:path.join(d,'content'),contentMaxObjectBytes:8*1024*1024,contentChunkBytes:64*1024,contentReplicationFactor:3};return {d,id,store,cas:new ContentStore({config,store,identity:id})};}
function transfer(src,dst,hash,sourceNodeId){const info=src.cas.chunkInfo(hash),parts=[];for(let i=0;i<info.chunks;i++){const x=src.cas.chunk(hash,i);parts.push(Buffer.from(x.data,'base64'));}const b=Buffer.concat(parts);return dst.cas.importBuffer(hash,b,{kind:info.kind,source:sourceNodeId,meta:{replicated:true}});}
const A=mk('A'),B=mk('B'),C=mk('C');
const payload=Buffer.concat([Buffer.from('NEURAL-MESH-LORA\n'),Buffer.alloc(512*1024,7)]);const a=A.cas.putBuffer(payload,{kind:'lora-adapter',source:A.id.nodeId,meta:{adapterId:'skill-v11'}});if(!a?.hash||!A.cas.has(a.hash))throw new Error('A did not store content');
B.cas.noteProvider(a.hash,A.id.nodeId,1);const b=transfer(A,B,a.hash,A.id.nodeId);if(b.hash!==a.hash||!B.cas.has(a.hash))throw new Error('B replication failed');
// Original author disappears. Only B remains as a provider.
A.store.close();fs.rmSync(A.d,{recursive:true,force:true});
C.cas.noteProvider(a.hash,B.id.nodeId,.9);const c=transfer(B,C,a.hash,B.id.nodeId);if(c.hash!==a.hash||!C.cas.has(a.hash))throw new Error('C recovery from replica failed');
if(!C.cas.read(a.hash).equals(payload))throw new Error('replicated content corrupted');
console.log('CONTENT NETWORK V0.11 OK',JSON.stringify({hash:a.hash.slice(0,16),bytes:a.bytes,authorGone:true,replicaB:true,recoveredByC:true,contentEqual:true}));
B.store.close();C.store.close();fs.rmSync(root,{recursive:true,force:true});
