import {spawn} from 'node:child_process';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');const tests=['v13-bft-test.mjs','replay-idempotency-test.mjs','foreign-network-test.mjs','v16-constitution-test.mjs'];
for(const test of tests){await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[`scripts/${test}`],{cwd:root,stdio:'inherit',env:process.env});p.on('exit',c=>c===0?resolve():reject(new Error(`${test} failed ${c}`)));p.on('error',reject);});}
console.log('CHAOS V1.0 OK',{tests:tests.length});
