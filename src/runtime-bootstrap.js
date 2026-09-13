import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MODELS = [
  { name:'qwen3:0.6b', rank:0 },
  { name:'qwen3:1.7b', rank:1 },
  { name:'qwen3:4b',   rank:2 },
  { name:'qwen3:8b',   rank:3 },
  { name:'qwen3:14b',  rank:4 },
  { name:'qwen3:30b',  rank:5 },
];

function truthy(v, d=false){
  if(v==null || v==='') return d;
  return ['1','true','yes','on'].includes(String(v).toLowerCase());
}
function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }
function commandExists(cmd){
  const r=spawnSync(process.platform==='win32'?'where':'sh',process.platform==='win32'?[cmd]:['-lc',`command -v ${cmd} >/dev/null 2>&1`],{stdio:'ignore'});
  return r.status===0;
}
function isLocalUrl(raw){
  try { const u=new URL(raw); return ['127.0.0.1','localhost','::1','[::1]'].includes(u.hostname); }
  catch { return false; }
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

export function detectHardware(){
  const cpuCores=Number(process.env.DETECTED_CPU_CORES)||os.cpus().length||1;
  const ramMiB=Number(process.env.DETECTED_RAM_MIB)||Math.round(os.totalmem()/1024/1024);
  let gpu=[];
  try{
    const out=execFileSync('nvidia-smi',['--query-gpu=name,memory.total','--format=csv,noheader,nounits'],{encoding:'utf8',timeout:2000});
    gpu=out.trim().split(/\r?\n/).filter(Boolean).map(line=>{
      const i=line.lastIndexOf(',');
      return {name:line.slice(0,i).trim(),memoryMiB:Number(line.slice(i+1).trim())||0};
    });
  }catch{}
  if(!gpu.length && Number(process.env.DETECTED_GPU_COUNT)>0){
    const count=Number(process.env.DETECTED_GPU_COUNT)||0;
    const total=Number(process.env.DETECTED_GPU_VRAM_MIB)||0;
    gpu=Array.from({length:count},(_,i)=>({name:`detected-gpu-${i+1}`,memoryMiB:Math.floor(total/Math.max(1,count))}));
  }
  const totalVramMiB=gpu.reduce((a,g)=>a+(Number(g.memoryMiB)||0),0);
  return {cpuCores,ramMiB,ramGiB:Math.round(ramMiB/1024),gpu,totalVramMiB,gpuCount:gpu.length,platform:process.platform,arch:process.arch};
}

export function selectModelForHardware(hw,{profile='balanced',maxModel='qwen3:30b',explicitModel='',autoModel=true}={}){
  if(!autoModel && explicitModel) return {selected:explicitModel,candidates:[explicitModel],reason:'manual override (AUTO_MODEL=false)'};
  let idx=0;
  let reason='';
  if(hw.gpuCount>0 && hw.totalVramMiB>0){
    const v=hw.totalVramMiB;
    // Conservative thresholds leave room for KV cache + runtime overhead.
    if(v>=32768) idx=5;
    else if(v>=18000) idx=4;
    else if(v>=10000) idx=3;
    else if(v>=6000) idx=2;
    else if(v>=3200) idx=1;
    else idx=0;
    reason=`GPU ${hw.gpuCount} device(s), ${v} MiB total VRAM`;
  }else{
    const r=hw.ramMiB,c=hw.cpuCores;
    if(r>=131072 && c>=24) idx=5;
    else if(r>=65536 && c>=16) idx=4;
    else if(r>=32768 && c>=12) idx=3;
    else if(r>=24576 && c>=8) idx=2;
    else if(r>=8192 && c>=2) idx=1;
    else idx=0;
    reason=`CPU ${c} core(s), ${r} MiB RAM`;
  }
  if(String(profile).toLowerCase()==='fast') idx--;
  if(String(profile).toLowerCase()==='quality') idx++;
  idx=clamp(idx,0,MODELS.length-1);
  const maxRank=MODELS.find(m=>m.name===maxModel)?.rank;
  if(Number.isInteger(maxRank)) idx=Math.min(idx,maxRank);
  const candidates=[];
  for(let i=idx;i>=0;i--) candidates.push(MODELS[i].name);
  return {selected:MODELS[idx].name,candidates,reason:`${reason}; profile=${profile}`};
}

async function ollamaTags(baseUrl,timeoutMs=3000){
  const r=await fetch(`${baseUrl}/api/tags`,{signal:AbortSignal.timeout(timeoutMs)});
  if(!r.ok) throw new Error(`Ollama ${r.status}`);
  return r.json();
}
async function ollamaAlive(baseUrl){ try{await ollamaTags(baseUrl,1800);return true;}catch{return false;} }
async function installedModels(baseUrl){
  const x=await ollamaTags(baseUrl,5000);
  return new Set((x.models||[]).flatMap(m=>[m.name,m.model]).filter(Boolean));
}
function modelPresent(names,model){
  if(names.has(model)) return true;
  if(!model.includes(':')) return [...names].some(x=>String(x).split(':')[0]===model);
  return false;
}

async function pullModel(baseUrl,model,{log=console.log}={}){
  log(`[runtime] downloading model ${model} ...`);
  const r=await fetch(`${baseUrl}/api/pull`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,stream:true})
  });
  if(!r.ok) throw new Error(`Ollama pull ${r.status}: ${await r.text()}`);
  if(!r.body) return;
  const reader=r.body.getReader(); const dec=new TextDecoder(); let buf='',last='';
  for(;;){
    const {done,value}=await reader.read(); if(done) break;
    buf+=dec.decode(value,{stream:true});
    const lines=buf.split(/\r?\n/); buf=lines.pop()||'';
    for(const line of lines){
      if(!line.trim()) continue;
      try{const j=JSON.parse(line); if(j.error) throw new Error(j.error); if(j.status&&j.status!==last){last=j.status; if(['pulling manifest','verifying sha256 digest','writing manifest','success'].includes(j.status)) log(`[runtime] ${model}: ${j.status}`);}}
      catch(e){ if(e instanceof SyntaxError) continue; throw e; }
    }
  }
}

async function smokeModel(baseUrl,model,timeoutMs){
  const r=await fetch(`${baseUrl}/api/chat`,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({model,messages:[{role:'user',content:'Reply with exactly OK.'}],stream:false,think:false,options:{num_predict:32,temperature:0}}),
    signal:AbortSignal.timeout(timeoutMs)
  });
  if(!r.ok) throw new Error(`model test ${r.status}: ${await r.text()}`);
  const x=await r.json();
  const content=String(x.message?.content||'').trim();
  if(!content){
    const thinking=String(x.message?.thinking||'').trim();
    const why=[x.done_reason?`done_reason=${x.done_reason}`:'',Number.isFinite(x.eval_count)?`eval_count=${x.eval_count}`:'',thinking?`thinking_only=${thinking.length} chars`:''].filter(Boolean).join(', ');
    throw new Error(`model returned no final content${why?` (${why})`:''}`);
  }
  return true;
}

function installOllamaLinux(){
  if(!commandExists('curl')) throw new Error('curl is required for automatic Ollama installation');
  const tmp=path.join(os.tmpdir(),`neural-ollama-install-${process.pid}.sh`);
  const dl=spawnSync('curl',['-fsSL','https://ollama.com/install.sh','-o',tmp],{stdio:'inherit'});
  if(dl.status!==0) throw new Error('failed to download official Ollama installer');
  fs.chmodSync(tmp,0o700);
  const run=spawnSync('sh',[tmp],{stdio:'inherit'});
  try{fs.unlinkSync(tmp);}catch{}
  if(run.status!==0) throw new Error(`Ollama installer failed with code ${run.status}`);
}
function installOllamaMac(){
  if(!commandExists('brew')) throw new Error('Homebrew is required for automatic Ollama installation on macOS');
  const r=spawnSync('brew',['install','ollama'],{stdio:'inherit'});
  if(r.status!==0) throw new Error(`brew install ollama failed with code ${r.status}`);
}
function startLocalOllama(baseUrl){
  if(!commandExists('ollama')) throw new Error('ollama executable not found after installation');
  let host='127.0.0.1:11434';
  try{const u=new URL(baseUrl);host=`${u.hostname}:${u.port||11434}`;}catch{}
  const child=spawn('ollama',['serve'],{detached:true,stdio:'ignore',env:{...process.env,OLLAMA_HOST:host}});
  child.unref();
}
async function ensureLocalOllama(baseUrl,{autoInstall,log}){
  if(await ollamaAlive(baseUrl)) return;
  if(!commandExists('ollama')){
    if(!autoInstall) throw new Error('Ollama is not installed and AUTO_INSTALL_OLLAMA=false');
    log('[runtime] Ollama not found; installing automatically...');
    if(process.platform==='linux') installOllamaLinux();
    else if(process.platform==='darwin') installOllamaMac();
    else throw new Error('automatic Ollama installation is supported on Linux/macOS; install Ollama manually on this OS');
  }
  log('[runtime] starting Ollama service...');
  startLocalOllama(baseUrl);
  for(let i=0;i<60;i++){ if(await ollamaAlive(baseUrl)) return; await sleep(1000); }
  throw new Error(`Ollama did not become ready at ${baseUrl}`);
}

function writeRuntimeState(root,state){
  try{
    fs.writeFileSync(path.join(root,'.runtime.json'),JSON.stringify({...state,updatedAt:new Date().toISOString()},null,2)+'\n',{mode:0o644});
  }catch{}
}

export async function bootstrapLlmRuntime({rootDir=null,log=console.log}={}){
  const root=rootDir||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const provider=truthy(process.env.MOCK_LLM,false)?'mock':(process.env.LLM_PROVIDER||'ollama');
  const hw=detectHardware();
  process.env.DETECTED_CPU_CORES=String(hw.cpuCores);
  process.env.DETECTED_RAM_MIB=String(hw.ramMiB);
  process.env.DETECTED_GPU_COUNT=String(hw.gpuCount);
  process.env.DETECTED_GPU_VRAM_MIB=String(hw.totalVramMiB);
  if(provider==='mock') return {provider:'mock',hardware:hw,model:'mock-neuron',ready:true};
  if(provider!=='ollama') return {provider,hardware:hw,model:process.env.LLM_MODEL||'',ready:true,managed:false};

  const profile=process.env.MODEL_PROFILE||'balanced';
  const autoModel=truthy(process.env.AUTO_MODEL,true);
  const explicit=process.env.LLM_MODEL||'';
  const maxModel=process.env.AUTO_MODEL_MAX||'qwen3:30b';
  const choice=selectModelForHardware(hw,{profile,maxModel,explicitModel:explicit,autoModel});
  const baseUrl=(process.env.LLM_BASE_URL||'http://127.0.0.1:11434').replace(/\/$/,'');
  const securityMode=(process.env.SECURITY_MODE||'testnet').toLowerCase();
  const autoInstall=truthy(process.env.AUTO_INSTALL_OLLAMA,securityMode!=='mainnet');
  const autoPull=truthy(process.env.AUTO_PULL_MODEL,true);
  const smoke=truthy(process.env.MODEL_SMOKE_TEST,true);
  const smokeTimeout=Number(process.env.MODEL_TEST_TIMEOUT_MS)||300000;

  log(`[runtime] hardware: CPU=${hw.cpuCores}, RAM=${hw.ramMiB} MiB, GPU=${hw.gpuCount}, VRAM=${hw.totalVramMiB} MiB`);
  log(`[runtime] model policy: ${choice.reason}; selected ${choice.selected}`);

  if(isLocalUrl(baseUrl)) await ensureLocalOllama(baseUrl,{autoInstall,log});
  else {
    for(let i=0;i<90;i++){ if(await ollamaAlive(baseUrl)) break; if(i===89) throw new Error(`remote Ollama is unavailable at ${baseUrl}`); await sleep(1000); }
  }

  let names=await installedModels(baseUrl);
  let finalModel=''; let lastError='';
  for(const model of choice.candidates){
    try{
      if(!modelPresent(names,model)){
        if(!autoPull) throw new Error(`${model} is missing and AUTO_PULL_MODEL=false`);
        await pullModel(baseUrl,model,{log});
        names=await installedModels(baseUrl);
      }
      if(smoke){
        log(`[runtime] testing ${model} ...`);
        await smokeModel(baseUrl,model,smokeTimeout);
      }
      finalModel=model; break;
    }catch(e){
      lastError=e.message;
      log(`[runtime] ${model} failed (${e.message}); trying smaller model...`);
    }
  }
  if(!finalModel) throw new Error(`no compatible Ollama model could be started${lastError?`: ${lastError}`:''}`);
  process.env.LLM_MODEL=finalModel;
  if(!process.env.EVOLUTION_MODEL_POOL) process.env.EVOLUTION_MODEL_POOL=finalModel;
  process.env.MODEL_SELECTION_REASON=choice.reason;
  process.env.HARDWARE_PROFILE=`${hw.gpuCount?'gpu':'cpu'}-${profile}`;
  const state={provider:'ollama',ready:true,managed:true,baseUrl,model:finalModel,hardware:hw,profile,reason:choice.reason};
  writeRuntimeState(root,state);
  log(`[runtime] ready: ${finalModel}`);
  return state;
}
