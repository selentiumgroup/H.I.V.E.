import http from 'node:http';
import assert from 'node:assert/strict';
import { LLM } from '../src/llm.js';

let calls=[];
const server=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/api/chat'&&req.method==='POST'){
    let s=''; for await(const c of req) s+=c; const x=JSON.parse(s); calls.push(x);
    if(x.think===true){
      res.end(JSON.stringify({message:{content:'',thinking:'internal reasoning only'},done:true,done_reason:'length',eval_count:64,prompt_eval_count:3}));
    }else{
      res.end(JSON.stringify({message:{content:'FINAL OK',thinking:''},done:true,done_reason:'stop',eval_count:2,prompt_eval_count:3}));
    }
    return;
  }
  res.statusCode=404;res.end('{}');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
const llm=new LLM({llmProvider:'ollama',llmBaseUrl:`http://127.0.0.1:${port}`,llmModel:'qwen3:4b',llmTimeoutMs:5000,llmThink:true});
const out=await llm.chat([{role:'user',content:'hello'}]);
assert.equal(out.content,'FINAL OK');
assert.equal(calls.length,2,'thinking-only response should retry once');
assert.equal(calls[0].think,true);
assert.equal(calls[1].think,false);
assert.ok(!out.content.includes('internal reasoning'));
server.close();
console.log('OLLAMA THINKING FALLBACK V0.7.3 OK');
