import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { encryptJson, decryptJsonWithFallback } from './keystore.js';

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

export class Identity {
  constructor(dataDir,{password='',fallbackPasswords=[],allowInsecure=false}={}) {
    fs.mkdirSync(dataDir,{ recursive:true });
    this.secureFile=path.join(dataDir,'identity-v2.json');this.legacyFile=path.join(dataDir,'identity.json');
    let x=null;
    if(fs.existsSync(this.secureFile)){
      const blob=JSON.parse(fs.readFileSync(this.secureFile,'utf8'));
      const result=decryptJsonWithFallback(blob,[password,...fallbackPasswords]);x=result.payload;
      if(password&&result.password!==password){
        const bak=this.secureFile+'.pre-migration-'+Date.now()+'.bak';fs.copyFileSync(this.secureFile,bak);fs.writeFileSync(this.secureFile,JSON.stringify(encryptJson(x,password),null,2),{mode:0o600});
        console.log(`[keystore] node identity migrated to current password; backup=${bak}`);
      }
    }else if(fs.existsSync(this.legacyFile)){
      const legacy=JSON.parse(fs.readFileSync(this.legacyFile,'utf8'));
      x=legacy;
      if(password){fs.writeFileSync(this.secureFile,JSON.stringify(encryptJson(legacy,password),null,2),{mode:0o600});try{fs.renameSync(this.legacyFile,this.legacyFile+'.migrated.bak');}catch{}}
      else if(!allowInsecure)throw new Error('legacy plaintext node identity found; set NODE_KEY_PASSWORD to migrate it');
    }else{
      const kp=crypto.generateKeyPairSync('ed25519');x={privateKey:kp.privateKey.export({type:'pkcs8',format:'pem'}),publicKey:kp.publicKey.export({type:'spki',format:'pem'}),createdAt:new Date().toISOString()};
      if(password)fs.writeFileSync(this.secureFile,JSON.stringify(encryptJson(x,password),null,2),{mode:0o600});
      else if(allowInsecure)fs.writeFileSync(this.legacyFile,JSON.stringify(x,null,2),{mode:0o600});
      else throw new Error('NODE_KEY_PASSWORD or WALLET_PASSWORD is required for encrypted node identity');
    }
    this.privateKey=crypto.createPrivateKey(x.privateKey);this.publicKey=crypto.createPublicKey(x.publicKey);
    const der=this.publicKey.export({type:'spki',format:'der'});this.nodeId=crypto.createHash('sha256').update(der).digest('hex');this.publicPem=this.publicKey.export({type:'spki',format:'pem'}).toString();
  }
  sign(payload){return crypto.sign(null,Buffer.from(canonical(payload)),this.privateKey).toString('base64');}
  envelope(payload){const body={nodeId:this.nodeId,publicKey:this.publicPem,ts:Date.now(),nonce:crypto.randomUUID(),payload};return {...body,signature:this.sign(body)};}
  static verifyEnvelope(env,maxSkewMs=5*60_000){
    try{const {signature,...body}=env;if(!signature||!body.nodeId||!body.publicKey||!body.ts||!body.nonce)return false;if(Math.abs(Date.now()-body.ts)>maxSkewMs)return false;const key=crypto.createPublicKey(body.publicKey);const der=key.export({type:'spki',format:'der'});const expectedId=crypto.createHash('sha256').update(der).digest('hex');if(expectedId!==body.nodeId)return false;return crypto.verify(null,Buffer.from(canonical(body)),key,Buffer.from(signature,'base64'));}catch{return false;}
  }
}
