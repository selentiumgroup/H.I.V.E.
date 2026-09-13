import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Wallet } from '../src/wallet.js';

const cmd=process.argv[2]||'show';
const dataDir=path.resolve(process.env.DATA_DIR||'./data');
const secure=path.join(dataDir,'wallet-v2.json'),legacy=path.join(dataDir,'wallet.json');
const localSecretFile=path.join(dataDir,'.local-keystore-secret');
const autoLocal=!['0','false','no','off'].includes(String(process.env.AUTO_LOCAL_SECRET??'true').toLowerCase());

function localSecret({create=false}={}){
  try { const x=fs.readFileSync(localSecretFile,'utf8').trim(); if(x.length>=32)return x; } catch {}
  if(!create||!autoLocal)return '';
  fs.mkdirSync(dataDir,{recursive:true});
  const x=crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(localSecretFile,x+'\n',{mode:0o600});
  return x;
}

const explicitPassword=process.env.WALLET_PASSWORD||'';
const password=explicitPassword||localSecret({create:cmd==='restore'});
const allowInsecure=['1','true','yes','on'].includes(String(process.env.ALLOW_INSECURE_KEYSTORE||'').toLowerCase());

if(cmd==='restore'){
  const phrase=String(process.env.WALLET_MNEMONIC||'').trim();
  if(!phrase)throw new Error('Set WALLET_MNEMONIC to the 24-word recovery phrase');
  if(fs.existsSync(secure)||fs.existsSync(legacy))throw new Error(`Refusing to overwrite existing wallet in ${dataDir}`);
  const w=Wallet.fromMnemonic(dataDir,phrase,{password,allowInsecure});
  console.log(`Restored NRN wallet\nAddress: ${w.address}\nFile: ${w.file}`);
  process.exit(0);
}
const w=new Wallet(dataDir,{password,allowInsecure});
if(cmd==='address'){console.log(w.address);process.exit(0);}
if(cmd==='show'){
  console.log(`NRN WALLET v0.7\nAddress: ${w.address}\nRecovery phrase: ${w.mnemonic}\nWallet file: ${w.file}\nEncrypted: ${w.file.endsWith('wallet-v2.json')?'yes':'no'}\n\nKeep the recovery phrase and WALLET_PASSWORD/local keystore secret offline. Anyone who has the recovery phrase can control this wallet.`);
  process.exit(0);
}
throw new Error('Usage: npm run wallet -- [show|address|restore]');
