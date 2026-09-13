import fs from 'node:fs';import path from 'node:path';import {loadConfig} from '../src/config.js';
process.env.AUTO_LOCAL_SECRET ??= 'false';
const c=loadConfig(),errors=[],warn=[];
if(c.securityMode!=='mainnet')warn.push('SECURITY_MODE is not mainnet');
if(!c.explicitWalletPassword)errors.push('WALLET_PASSWORD must be explicitly set');
if(!c.explicitNodeKeyPassword)errors.push('NODE_KEY_PASSWORD must be explicitly set');
if(c.autoBootstrapValidators)errors.push('AUTO_BOOTSTRAP_VALIDATORS must be false');
if(c.allowUntrustedTestnetFastSync)errors.push('ALLOW_UNTRUSTED_TESTNET_FAST_SYNC must be false');
if(c.autoInstallOllama)errors.push('AUTO_INSTALL_OLLAMA must be false');
if(!c.apiToken||c.apiToken.length<24)errors.push('API_TOKEN must be at least 24 chars');
if(!c.constitutionEnabled)errors.push('CONSTITUTION_ENABLED must be true');
if(!c.trustedCheckpointValidatorRoot)warn.push('TRUSTED_CHECKPOINT_VALIDATOR_ROOT not configured');
const manifest=path.resolve(process.env.NETWORK_MANIFEST||'network-manifest.json');let m=null;
if(!fs.existsSync(manifest))errors.push(`network manifest missing: ${manifest}`);else{try{m=JSON.parse(fs.readFileSync(manifest,'utf8'));}catch{errors.push(`network manifest is not valid JSON: ${manifest}`);}}
if(m){const raw=JSON.stringify(m);if(String(m.format||'').includes('template')||/SET_BY_FINAL|"REQUIRED"/.test(raw))errors.push('network manifest is a template/unfinalized ceremony artifact');if(m.networkId&&m.networkId!==c.networkId)errors.push(`networkId mismatch: manifest=${m.networkId} runtime=${c.networkId}`);const mp=m.protocolVersion||m.consensusProtocol;if(mp&&mp!==c.protocolVersion)errors.push(`protocol mismatch: manifest=${mp} runtime=${c.protocolVersion}`);if(!m.genesisHash||String(m.genesisHash).includes('SET_BY'))errors.push('final genesisHash missing');}
const releaseManifest=path.resolve(process.env.RELEASE_MANIFEST||'release-manifest.json');let rm=null;
if(!fs.existsSync(releaseManifest))errors.push(`release manifest missing: ${releaseManifest}`);else{try{rm=JSON.parse(fs.readFileSync(releaseManifest,'utf8'));}catch{errors.push(`release manifest is not valid JSON: ${releaseManifest}`);}}
if(rm){if(rm.softwareVersion!==c.softwareVersion)errors.push(`release softwareVersion mismatch: ${rm.softwareVersion} != ${c.softwareVersion}`);if(rm.consensusProtocol!==c.protocolVersion)errors.push(`release protocol mismatch: ${rm.consensusProtocol} != ${c.protocolVersion}`);if(!/^[0-9a-f]{64}$/.test(rm.releaseRoot||''))errors.push('releaseRoot missing/invalid');}
const localSecret=path.join(c.dataDir,'.local-keystore-secret');if(fs.existsSync(localSecret))errors.push('mainnet must not depend on data/.local-keystore-secret; use explicit operator secrets/HSM policy');
if(c.networkId.includes('testnet'))warn.push('NETWORK_ID identifies a testnet; do not use this profile for public mainnet genesis');
const out={ok:errors.length===0,errors,warnings:warn,softwareVersion:c.softwareVersion,networkId:c.networkId,protocolVersion:c.protocolVersion,manifest,releaseManifest,releaseRoot:rm?.releaseRoot||null};console.log(JSON.stringify(out,null,2));if(errors.length)process.exit(2);
