import os from 'node:os';
import { execFileSync } from 'node:child_process';

function envInt(name){const n=Number.parseInt(process.env[name]||'',10);return Number.isFinite(n)&&n>0?n:0;}

export function hardwareInfo() {
  let gpu = [];
  try {
    const out = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total','--format=csv,noheader,nounits'], {encoding:'utf8', timeout:1500});
    gpu = out.trim().split(/\r?\n/).filter(Boolean).map(line => {
      const i=line.lastIndexOf(','); return {name:line.slice(0,i).trim(), memoryMiB:Number(line.slice(i+1).trim())||0};
    });
  } catch {}
  const hostGpuCount=envInt('DETECTED_GPU_COUNT'),hostGpuVram=envInt('DETECTED_GPU_VRAM_MIB');
  if(!gpu.length&&hostGpuCount){
    const each=Math.floor(hostGpuVram/hostGpuCount);
    gpu=Array.from({length:hostGpuCount},(_,i)=>({name:`host-nvidia-${i+1}`,memoryMiB:each}));
  }
  const cpuCores=envInt('DETECTED_CPU_CORES')||os.cpus().length;
  const ramMiB=envInt('DETECTED_RAM_MIB')||Math.round(os.totalmem()/1024/1024);
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: os.cpus()[0]?.model || 'unknown',
    cpuCores,
    ramGiB: Math.round(ramMiB/1024),
    gpu,
    accelerator: gpu.length ? 'gpu' : 'cpu',
    modelProfile:process.env.MODEL_PROFILE||'',
    llmModel:process.env.LLM_MODEL||''
  };
}
