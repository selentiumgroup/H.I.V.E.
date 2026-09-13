import crypto from 'node:crypto';

export function encryptJson(payload,password){
  if(!password) throw new Error('keystore password required');
  const salt=crypto.randomBytes(16);const iv=crypto.randomBytes(12);
  const key=crypto.scryptSync(password,salt,32,{N:1<<15,r:8,p:1,maxmem:128*1024*1024});
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  key.fill(0);
  return {version:2,kdf:'scrypt',cipher:'aes-256-gcm',salt:salt.toString('base64'),iv:iv.toString('base64'),tag:tag.toString('base64'),ciphertext:ciphertext.toString('base64')};
}

export function decryptJson(blob,password){
  if(!blob||blob.version!==2||blob.kdf!=='scrypt'||blob.cipher!=='aes-256-gcm')throw new Error('unsupported keystore');
  if(!password)throw new Error('keystore password required');
  const salt=Buffer.from(blob.salt,'base64'),iv=Buffer.from(blob.iv,'base64'),tag=Buffer.from(blob.tag,'base64'),ciphertext=Buffer.from(blob.ciphertext,'base64');
  const key=crypto.scryptSync(password,salt,32,{N:1<<15,r:8,p:1,maxmem:128*1024*1024});
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);
  let clear;
  try{clear=Buffer.concat([decipher.update(ciphertext),decipher.final()]);}catch{key.fill(0);throw new Error('invalid keystore password or corrupted keystore');}
  key.fill(0);try{return JSON.parse(clear.toString('utf8'));}finally{clear.fill(0);}
}


export function decryptJsonWithFallback(blob,passwords=[]){
  const seen=new Set();let lastError=null;
  for(const raw of passwords){
    const password=String(raw||'');if(!password||seen.has(password))continue;seen.add(password);
    try{return {payload:decryptJson(blob,password),password};}catch(e){lastError=e;}
  }
  throw lastError||new Error('no usable keystore password candidate');
}
