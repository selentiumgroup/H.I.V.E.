import {spawn} from 'node:child_process';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const suites=[
 ['release-audit.mjs',30_000],
 ['v15-operator-test.mjs',60_000],
 ['v14-governance-test.mjs',60_000],
 ['v13-bft-test.mjs',180_000],
 ['v12-consensus-test.mjs',120_000],
 ['v11-content-network-test.mjs',120_000],
 ['v10-training-test.mjs',120_000],
 ['explorer-test.mjs',120_000],
 ['v08-learning-bft-test.mjs',60_000],
 ['v16-constitution-test.mjs',60_000],
 ['replay-idempotency-test.mjs',60_000],
 ['foreign-network-test.mjs',60_000],
 ['zero-touch-test.mjs',120_000],
 ['v1-load-test.mjs',60_000]
];
for(const [file,timeoutMs] of suites){process.stdout.write(`\n=== ${file} ===\n`);await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[`scripts/${file}`],{cwd:root,env:process.env,stdio:'inherit'});let done=false;const t=setTimeout(()=>{if(done)return;done=true;p.kill('SIGKILL');reject(new Error(`${file} timed out after ${timeoutMs}ms`));},timeoutMs);p.on('exit',code=>{if(done)return;done=true;clearTimeout(t);code===0?resolve():reject(new Error(`${file} failed with code ${code}`));});p.on('error',e=>{if(done)return;done=true;clearTimeout(t);reject(e);});});}
console.log('\nVERIFY V1.0 OK',{suites:suites.length});
