import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootstrapLlmRuntime } from '../src/runtime-bootstrap.js';

const installed=new Set(); let pulls=0,chats=0;
const server=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/api/tags'){res.end(JSON.stringify({models:[...installed].map(name=>({name,model:name}))}));return;}
  if(req.url==='/api/pull'&&req.method==='POST'){
    let s='';for await(const c of req)s+=c;const x=JSON.parse(s);installed.add(x.model);pulls++;
    res.end(JSON.stringify({status:'success'})+'\n');return;
  }
  if(req.url==='/api/chat'&&req.method==='POST'){
    let s='';for await(const c of req)s+=c;const x=JSON.parse(s);chats++;
    if(!installed.has(x.model)){res.statusCode=404;res.end(JSON.stringify({error:'model not found'}));return;}
    assert.equal(x.think,false,'runtime smoke test must disable thinking');
    assert.ok((x.options?.num_predict||0)>=32,'runtime smoke test needs enough final-answer budget');
    res.end(JSON.stringify({message:{content:'OK',thinking:''},eval_count:1,prompt_eval_count:1,done_reason:'stop'}));return;
  }
  res.statusCode=404;res.end('{}');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'neural-runtime-test-'));
process.env.LLM_PROVIDER='ollama';
process.env.LLM_BASE_URL=`http://127.0.0.1:${port}`;
process.env.AUTO_MODEL='true';
process.env.MODEL_PROFILE='balanced';
process.env.DETECTED_CPU_CORES='12';
process.env.DETECTED_RAM_MIB='32768';
process.env.DETECTED_GPU_COUNT='0';
process.env.DETECTED_GPU_VRAM_MIB='0';
process.env.AUTO_PULL_MODEL='true';
process.env.MODEL_SMOKE_TEST='true';
const state=await bootstrapLlmRuntime({rootDir:tmp,log:()=>{}});
assert.equal(state.model,'qwen3:8b');
assert.equal(process.env.LLM_MODEL,'qwen3:8b');
assert.equal(pulls,1);
assert.equal(chats,1);
assert.ok(fs.existsSync(path.join(tmp,'.runtime.json')));
server.close();fs.rmSync(tmp,{recursive:true,force:true});
console.log('RUNTIME PROVISION V0.7.3 OK');
