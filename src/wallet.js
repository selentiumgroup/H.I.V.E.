import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonical } from './identity.js';
import { encryptJson, decryptJsonWithFallback } from './keystore.js';

const A=['ba','be','bi','bo','bu','da','de','di','do','du','ka','ke','ki','ko','ku','la'];
const B=['na','ne','ni','no','nu','ra','re','ri','ro','ru','sa','se','si','so','su','ta'];
const WORDS=Array.from({length:256},(_,i)=>A[i>>4]+B[i&15]);
const WORD_INDEX=new Map(WORDS.map((w,i)=>[w,i]));
const HRP='nrn';
const BECH32='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const ED25519_PKCS8_PREFIX=Buffer.from('302e020100300506032b657004220420','hex');

function checksumByte(entropy){return crypto.createHash('sha256').update(entropy).digest()[0];}
function entropyToMnemonic(entropy){if(!Buffer.isBuffer(entropy)||entropy.length!==23)throw new Error('NRN mnemonic entropy must be 23 bytes');const bytes=Buffer.concat([entropy,Buffer.from([checksumByte(entropy)])]);return [...bytes].map(x=>WORDS[x]).join(' ');}
function mnemonicToEntropy(mnemonic){const parts=String(mnemonic||'').trim().toLowerCase().split(/\s+/).filter(Boolean);if(parts.length!==24)throw new Error('NRN recovery phrase must contain exactly 24 words');const bytes=Buffer.from(parts.map(w=>{const i=WORD_INDEX.get(w);if(i===undefined)throw new Error(`Unknown NRN recovery word: ${w}`);return i;}));const entropy=bytes.subarray(0,23);if(bytes[23]!==checksumByte(entropy))throw new Error('NRN recovery phrase checksum mismatch');return entropy;}
function seedFromEntropy(entropy){return Buffer.from(crypto.hkdfSync('sha256',entropy,Buffer.from('NeuralMesh-NRN-Wallet-v1'),Buffer.from('account/0'),32));}
function privateKeyFromSeed(seed){return crypto.createPrivateKey({key:Buffer.concat([ED25519_PKCS8_PREFIX,seed]),format:'der',type:'pkcs8'});}
function pubDer(publicKey){const key=publicKey?.type==='public'?publicKey:crypto.createPublicKey(publicKey);return key.export({type:'spki',format:'der'});}
function convertBits(data,fromBits,toBits,pad=true){let acc=0,bits=0;const ret=[];const maxv=(1<<toBits)-1;for(const value of data){if(value<0||(value>>fromBits)!==0)throw new Error('invalid convertBits value');acc=(acc<<fromBits)|value;bits+=fromBits;while(bits>=toBits){bits-=toBits;ret.push((acc>>bits)&maxv);}}if(pad){if(bits)ret.push((acc<<(toBits-bits))&maxv);}else if(bits>=fromBits||((acc<<(toBits-bits))&maxv))throw new Error('invalid padding');return ret;}
function polymod(values){let chk=1;const GEN=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];for(const v of values){const top=chk>>>25;chk=((chk&0x1ffffff)<<5)^v;for(let i=0;i<5;i++)if((top>>>i)&1)chk^=GEN[i];}return chk>>>0;}
function hrpExpand(hrp){return [...hrp].map(c=>c.charCodeAt(0)>>5).concat([0],[...hrp].map(c=>c.charCodeAt(0)&31));}
function checksum(hrp,data){const values=hrpExpand(hrp).concat(data,[0,0,0,0,0,0]);const mod=polymod(values)^0x2bc830a3;return Array.from({length:6},(_,i)=>(mod>>>(5*(5-i)))&31);}
function encodeAddress(payload){const data=[0,...convertBits(payload,8,5,true)];const all=data.concat(checksum(HRP,data));return HRP+'1'+all.map(x=>BECH32[x]).join('');}
function decodeAddress(address){const s=String(address||'').toLowerCase();if(!s.startsWith(HRP+'1'))throw new Error('invalid NRN address prefix');const pos=s.lastIndexOf('1');const chars=s.slice(pos+1);if(chars.length<7)throw new Error('invalid NRN address');const data=[...chars].map(c=>{const i=BECH32.indexOf(c);if(i<0)throw new Error('invalid NRN address character');return i;});if(polymod(hrpExpand(s.slice(0,pos)).concat(data))!==0x2bc830a3)throw new Error('invalid NRN address checksum');const payload=data.slice(0,-6);if(payload[0]!==0)throw new Error('unsupported NRN address version');return Buffer.from(convertBits(payload.slice(1),5,8,false));}
export function addressFromPublicKey(publicKey){const h1=crypto.createHash('sha256').update(pubDer(publicKey)).digest();const h2=crypto.createHash('ripemd160').update(h1).digest();return encodeAddress(h2);}
export function isValidAddress(address){try{return decodeAddress(address).length===20;}catch{return false;}}
export function parseNRN(v){const s=String(v??'').trim();if(!/^\d+(?:\.\d{1,8})?$/.test(s))throw new Error('NRN amount must be a positive decimal with up to 8 decimals');const [a,b='']=s.split('.');return BigInt(a)*100000000n+BigInt((b+'00000000').slice(0,8));}
export function formatNRN(atomic){let x=BigInt(atomic);const neg=x<0n;if(neg)x=-x;const a=x/100000000n;const b=(x%100000000n).toString().padStart(8,'0').replace(/0+$/,'');return `${neg?'-':''}${a}${b?'.'+b:''}`;}
export function fixedNRN(atomic){let x=BigInt(atomic);const neg=x<0n;if(neg)x=-x;return `${neg?'-':''}${x/100000000n}.${(x%100000000n).toString().padStart(8,'0')}`;}

function txIdAndSign(wallet,body){const txId=crypto.createHash('sha256').update(canonical(body)).digest('hex');return {...body,txId,signature:wallet.sign(body)};}
function verifySignedTx(tx,networkId,allowedTypes){
  try{if(!tx||tx.version!==2||!allowedTypes.includes(tx.type)||tx.networkId!==networkId||!isValidAddress(tx.from))return false;const key=crypto.createPublicKey(tx.fromPublicKey);if(addressFromPublicKey(key)!==tx.from)return false;if(!Number.isSafeInteger(Number(tx.nonce))||Number(tx.nonce)<1)return false;const {txId,signature,...body}=tx;const expected=crypto.createHash('sha256').update(canonical(body)).digest('hex');if(expected!==txId)return false;return crypto.verify(null,Buffer.from(canonical(body)),key,Buffer.from(signature,'base64'));}catch{return false;}
}

export class Wallet {
  constructor(dataDir,{mnemonic='',password='',fallbackPasswords=[],allowInsecure=false}={}){
    fs.mkdirSync(dataDir,{recursive:true});this.secureFile=path.join(dataDir,'wallet-v2.json');this.legacyFile=path.join(dataDir,'wallet.json');let x=null;
    if(fs.existsSync(this.secureFile)){
      const blob=JSON.parse(fs.readFileSync(this.secureFile,'utf8'));const result=decryptJsonWithFallback(blob,[password,...fallbackPasswords]);x=result.payload;
      if(password&&result.password!==password){
        const bak=this.secureFile+'.pre-migration-'+Date.now()+'.bak';fs.copyFileSync(this.secureFile,bak);fs.writeFileSync(this.secureFile,JSON.stringify(encryptJson(x,password),null,2),{mode:0o600});
        console.log(`[keystore] NRN wallet migrated to current password; backup=${bak}`);
      }
    }else if(fs.existsSync(this.legacyFile)){
      const legacy=JSON.parse(fs.readFileSync(this.legacyFile,'utf8'));x=legacy;
      if(password){fs.writeFileSync(this.secureFile,JSON.stringify(encryptJson(legacy,password),null,2),{mode:0o600});try{fs.renameSync(this.legacyFile,this.legacyFile+'.migrated.bak');}catch{}}
      else if(!allowInsecure)throw new Error('legacy plaintext wallet found; set WALLET_PASSWORD to migrate it');
    }else{
      const phrase=String(mnemonic||process.env.WALLET_MNEMONIC||'').trim()||entropyToMnemonic(crypto.randomBytes(23));const entropy=mnemonicToEntropy(phrase);const priv=privateKeyFromSeed(seedFromEntropy(entropy));const pub=crypto.createPublicKey(priv);const address=addressFromPublicKey(pub);
      x={version:2,address,publicKey:pub.export({type:'spki',format:'pem'}).toString(),privateKey:priv.export({type:'pkcs8',format:'pem'}).toString(),mnemonic:phrase,createdAt:new Date().toISOString()};
      if(password)fs.writeFileSync(this.secureFile,JSON.stringify(encryptJson(x,password),null,2),{mode:0o600});
      else if(allowInsecure)fs.writeFileSync(this.legacyFile,JSON.stringify(x,null,2),{mode:0o600});
      else throw new Error('WALLET_PASSWORD is required for encrypted NRN wallet');
    }
    this.file=fs.existsSync(this.secureFile)?this.secureFile:this.legacyFile;this.mnemonic=x.mnemonic;this.privateKey=crypto.createPrivateKey(x.privateKey);this.publicKey=crypto.createPublicKey(x.publicKey);this.publicPem=this.publicKey.export({type:'spki',format:'pem'}).toString();this.address=addressFromPublicKey(this.publicKey);if(x.address!==this.address)throw new Error('wallet file address mismatch');
  }
  sign(payload){return crypto.sign(null,Buffer.from(canonical(payload)),this.privateKey).toString('base64');}
  createTransfer({networkId,to,amountAtomic,feeAtomic,nonce}){if(!isValidAddress(to))throw new Error('invalid destination NRN address');const amount=BigInt(amountAtomic),fee=BigInt(feeAtomic);if(amount<=0n)throw new Error('amount must be positive');if(fee<0n)throw new Error('fee cannot be negative');return txIdAndSign(this,{version:2,type:'transfer',networkId,from:this.address,fromPublicKey:this.publicPem,to,amountAtomic:amount.toString(),feeAtomic:fee.toString(),nonce:Number(nonce),createdAt:Date.now()});}
  createBond({networkId,nodeId,nodePublicKey,rewardAddress,amountAtomic,feeAtomic,nonce}){const amount=BigInt(amountAtomic),fee=BigInt(feeAtomic);if(!/^[0-9a-f]{64}$/i.test(nodeId||''))throw new Error('invalid validator node id');if(!isValidAddress(rewardAddress))throw new Error('invalid validator reward address');if(amount<=0n)throw new Error('bond must be positive');return txIdAndSign(this,{version:2,type:'bond',networkId,from:this.address,fromPublicKey:this.publicPem,validatorNodeId:nodeId,validatorPublicKey:nodePublicKey,rewardAddress,amountAtomic:amount.toString(),feeAtomic:fee.toString(),nonce:Number(nonce),createdAt:Date.now()});}
  createUnbond({networkId,nodeId,amountAtomic,feeAtomic,nonce}){const amount=BigInt(amountAtomic),fee=BigInt(feeAtomic);if(!/^[0-9a-f]{64}$/i.test(nodeId||''))throw new Error('invalid validator node id');if(amount<=0n)throw new Error('unbond must be positive');return txIdAndSign(this,{version:2,type:'unbond',networkId,from:this.address,fromPublicKey:this.publicPem,validatorNodeId:nodeId,amountAtomic:amount.toString(),feeAtomic:fee.toString(),nonce:Number(nonce),createdAt:Date.now()});}
  static verifyTransaction(tx,networkId){
    if(!verifySignedTx(tx,networkId,['transfer','bond','unbond']))return false;
    try{const fee=BigInt(tx.feeAtomic);if(fee<0n)return false;if(tx.type==='transfer')return isValidAddress(tx.to)&&BigInt(tx.amountAtomic)>0n;if(tx.type==='bond')return /^[0-9a-f]{64}$/i.test(tx.validatorNodeId||'')&&isValidAddress(tx.rewardAddress)&&BigInt(tx.amountAtomic)>0n&&!!tx.validatorPublicKey;if(tx.type==='unbond')return /^[0-9a-f]{64}$/i.test(tx.validatorNodeId||'')&&BigInt(tx.amountAtomic)>0n;return false;}catch{return false;}
  }
  static verifyTransfer(tx,networkId){return tx?.type==='transfer'&&Wallet.verifyTransaction(tx,networkId);}
  static fromMnemonic(dataDir,mnemonic,opts={}){return new Wallet(dataDir,{mnemonic,...opts});}
  static validateMnemonic(mnemonic){try{mnemonicToEntropy(mnemonic);return true;}catch{return false;}}
}
