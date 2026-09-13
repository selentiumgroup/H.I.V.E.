import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function sha256(b){return crypto.createHash('sha256').update(b).digest('hex');}
function validHash(h){return /^[0-9a-f]{64}$/.test(String(h||''));}

export class ContentStore {
  constructor({config,store,identity}){
    this.c=config;this.store=store;this.identity=identity;
    this.dir=path.resolve(this.c.contentStoreDir);fs.mkdirSync(this.dir,{recursive:true});
    this.inflight=new Map();
  }
  objectPath(hash){if(!validHash(hash))throw new Error('invalid content hash');return path.join(this.dir,hash.slice(0,2),hash.slice(2,4),hash);}
  has(hash){try{return fs.statSync(this.objectPath(hash)).isFile();}catch{return false;}}
  putBuffer(buf,{kind='blob',source='',meta={}}={}){
    if(!Buffer.isBuffer(buf))buf=Buffer.from(buf);if(buf.length>this.c.contentMaxObjectBytes)throw new Error('content object too large');
    const hash=sha256(buf),f=this.objectPath(hash);fs.mkdirSync(path.dirname(f),{recursive:true});if(!fs.existsSync(f)){const tmp=`${f}.${process.pid}.${Date.now()}.tmp`;fs.writeFileSync(tmp,buf,{mode:0o600});fs.renameSync(tmp,f);}this.store.upsertContentObject({hash,bytes:buf.length,kind,localPath:f,source,meta,verified:true});this.store.upsertContentProvider({hash,nodeId:this.identity.nodeId,lastSeen:Date.now(),score:1});return this.info(hash);
  }
  putFile(file,opts={}){const st=fs.statSync(file);if(st.size>this.c.contentMaxObjectBytes)throw new Error('content object too large');return this.putBuffer(fs.readFileSync(file),opts);}
  info(hash){const o=this.store.contentObject(hash);if(!o)return null;return {...o,available:this.has(hash)};}
  list(limit=100){return this.store.contentObjects(limit).map(o=>({...o,available:this.has(o.hash)}));}
  read(hash){const o=this.info(hash);if(!o?.available)throw new Error('content unavailable');const b=fs.readFileSync(o.localPath);if(sha256(b)!==hash)throw new Error('content integrity failure');return b;}
  chunkInfo(hash,chunkBytes=this.c.contentChunkBytes){const b=this.read(hash);return {hash,bytes:b.length,chunkBytes,chunks:Math.ceil(b.length/chunkBytes),kind:this.store.contentObject(hash)?.kind||'blob'};}
  chunk(hash,index,chunkBytes=this.c.contentChunkBytes){const info=this.chunkInfo(hash,chunkBytes),i=Number(index);if(!Number.isInteger(i)||i<0||i>=info.chunks)throw new Error('invalid content chunk');const b=this.read(hash),start=i*chunkBytes,end=Math.min(b.length,start+chunkBytes);return {...info,index:i,data:b.subarray(start,end).toString('base64')};}
  importBuffer(hash,buf,{kind='blob',source='',meta={}}={}){if(!validHash(hash)||sha256(buf)!==hash)throw new Error('content hash mismatch');return this.putBuffer(buf,{kind,source,meta});}
  noteProvider(hash,nodeId,score=0.5){if(validHash(hash)&&nodeId)this.store.upsertContentProvider({hash,nodeId,lastSeen:Date.now(),score});}
  providers(hash){return this.store.contentProviders(hash);}
  stats(){const xs=this.store.contentObjects(100000),bytes=xs.reduce((s,x)=>s+Number(x.bytes||0),0);return {objects:xs.length,bytes,providers:this.store.contentProviderCount(),replicationTarget:this.c.contentReplicationFactor};}
}
