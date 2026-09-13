export class LLM {
  constructor(config) { this.c = config; }
  async chat(messages, {temperature=0.2, json=false, model=null}={}) {
    const chosenModel=model||this.c.llmModel;
    if (this.c.llmProvider === 'mock') {
      const last = messages.filter(m=>m.role==='user').at(-1)?.content || '';
      return {content:`[mock:${chosenModel}] ${last.slice(0,800)}`, usage:{prompt:0,completion:0}, raw:{}};
    }
    if (this.c.llmProvider === 'ollama') {
      const run = async (think) => {
        const res = await fetch(`${this.c.llmBaseUrl}/api/chat`, {
          method:'POST', headers:{'content-type':'application/json'},
          body:JSON.stringify({model:chosenModel,messages,stream:false,think,format:json?'json':undefined,keep_alive:'5m',options:{temperature,num_ctx:this.c.llmNumCtx||2048,num_thread:this.c.llmNumThread||undefined}}),
          signal:AbortSignal.timeout(this.c.llmTimeoutMs)
        });
        if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
        return res.json();
      };
      let x=await run(!!this.c.llmThink);
      let content=String(x.message?.content||'').trim();
      // Thinking-capable models can spend the whole generation budget in
      // message.thinking and leave final content empty. Never expose the
      // private reasoning trace as the answer; retry once with thinking off.
      if(!content && x.message?.thinking && this.c.llmThink) {
        x=await run(false);
        content=String(x.message?.content||'').trim();
      }
      if(!content){
        const thinking=String(x.message?.thinking||'').trim();
        const why=[x.done_reason?`done_reason=${x.done_reason}`:'',Number.isFinite(x.eval_count)?`eval_count=${x.eval_count}`:'',thinking?`thinking_only=${thinking.length} chars`:''].filter(Boolean).join(', ');
        throw new Error(`Ollama model '${chosenModel}' returned no final content${why?` (${why})`:''}`);
      }
      return {content, usage:{prompt:x.prompt_eval_count||0,completion:x.eval_count||0}, raw:x};
    }
    if (this.c.llmProvider === 'openai-compatible') {
      const headers={'content-type':'application/json'};
      if (this.c.llmApiKey) headers.authorization=`Bearer ${this.c.llmApiKey}`;
      const res=await fetch(`${this.c.llmBaseUrl}/v1/chat/completions`,{
        method:'POST',headers,body:JSON.stringify({model:chosenModel,messages,temperature,stream:false,response_format:json?{type:'json_object'}:undefined}),
        signal:AbortSignal.timeout(this.c.llmTimeoutMs)
      });
      if(!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
      const x=await res.json(); return {content:x.choices?.[0]?.message?.content||'',usage:x.usage||{},raw:x};
    }
    throw new Error(`Unknown LLM_PROVIDER=${this.c.llmProvider}`);
  }
  async health() {
    if (this.c.llmProvider==='mock') return {ok:true,provider:'mock',model:this.c.llmModel};
    try {
      if (this.c.llmProvider==='ollama') {
        const r=await fetch(`${this.c.llmBaseUrl}/api/tags`,{signal:AbortSignal.timeout(2500)});
        if (!r.ok) return {ok:false,provider:'ollama',model:this.c.llmModel,error:`Ollama ${r.status}`};
        const x=await r.json();
        const names=(x.models||[]).flatMap(m=>[m.name,m.model]).filter(Boolean);
        const present=names.includes(this.c.llmModel) || names.some(n=>String(n).split(':')[0]===this.c.llmModel && !this.c.llmModel.includes(':'));
        return {ok:present,provider:'ollama',model:this.c.llmModel,modelPresent:present,installedModels:names.slice(0,32),error:present?undefined:`model '${this.c.llmModel}' is not installed`};
      }
      const headers={}; if(this.c.llmApiKey) headers.authorization=`Bearer ${this.c.llmApiKey}`;
      const r=await fetch(`${this.c.llmBaseUrl}/v1/models`,{headers,signal:AbortSignal.timeout(2500)});
      return {ok:r.ok,provider:'openai-compatible',model:this.c.llmModel};
    } catch(e) { return {ok:false,provider:this.c.llmProvider,model:this.c.llmModel,error:e.message}; }
  }
}
