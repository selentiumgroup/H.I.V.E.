export async function postJson(url,path,payload,ms=10000){
  const base=String(url||'').replace(/\/$/,'');
  if(!base) throw new Error('peer has no direct URL');
  const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(ms)});
  const text=await r.text(); let data={};
  try{data=text?JSON.parse(text):{};}catch{data={error:text};}
  if(!r.ok)throw new Error(`${r.status} ${data.error||text}`);
  return data;
}

export function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
