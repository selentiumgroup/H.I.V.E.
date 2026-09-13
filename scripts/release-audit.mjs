import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const forbiddenNames=new Set(['.local-keystore-secret','wallet-v2.json','identity-v2.json','.env','node.db','mesh.db','ledger.db']);
const bad=[];const suspicious=[];
function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git'].includes(ent.name))continue;const p=path.join(dir,ent.name),rel=path.relative(root,p).replaceAll('\\','/');if(ent.isDirectory()){walk(p);continue;}if(forbiddenNames.has(ent.name))bad.push(rel);if(rel.startsWith('data/')&&rel!=='data/.gitkeep')bad.push(rel);if(/\.(pem|key|p12|pfx)$/i.test(ent.name))bad.push(rel);const st=fs.statSync(p);if(st.size<=2_000_000&&/\.(json|md|txt|js|mjs|sh|example|yml|yaml)$/i.test(ent.name)){const t=fs.readFileSync(p,'utf8');if(/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/.test(t))bad.push(rel+':private-key');if(/(?:WALLET_PASSWORD|NODE_KEY_PASSWORD|API_TOKEN)\s*=\s*[^\s#][^\n]{12,}/.test(t)&&!rel.endsWith('.example'))suspicious.push(rel+':credential-like');}}
}
walk(root);
const uniq=[...new Set(bad)],sus=[...new Set(suspicious)];const out={ok:uniq.length===0,root,forbidden:uniq,suspicious:sus};console.log(JSON.stringify(out,null,2));if(!out.ok)process.exit(2);
