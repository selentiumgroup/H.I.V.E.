export const DEFAULT_ROUTER_POLICY=Object.freeze({capabilityWeight:3,trustWeight:2,freshnessWeight:1,latencyWeight:1.5,freshnessWindowMs:120000,remoteWorkers:3});

function overlap(caps, wanted) {
  if (!wanted?.length) return caps.includes('general') ? 1 : .5;
  return wanted.reduce((s,x)=>s+(caps.includes(x)?1:0),0)/wanted.length;
}
function hasAny(t,words=[]){return words.some(w=>w&&t.includes(String(w).toLowerCase()));}

export function inferCapabilities(text='', policy={}) {
  const t=text.toLowerCase(); const caps=['reasoning'];const extra=policy.keywordAdditions||{};
  if(/code|код|javascript|node|python|api|sql|bug|программ/.test(t)||hasAny(t,extra.code)) caps.push('code');
  if(/finance|финанс|банк|рынок|trading|торгов|эконом/.test(t)||hasAny(t,extra.finance)) caps.push('finance');
  if(/law|legal|юрид|договор|закон|регуля/.test(t)||hasAny(t,extra.legal)) caps.push('legal');
  if(/critic|проверь|ошиб|verify|провер/.test(t)||hasAny(t,extra.critic)) caps.push('critic');
  return [...new Set(caps)];
}

export function rankPeers(peers, wanted, limit=3, policy=DEFAULT_ROUTER_POLICY) {
  const now=Date.now();const p={...DEFAULT_ROUTER_POLICY,...(policy||{})};const window=Math.max(30000,Number(p.freshnessWindowMs)||120000);
  return peers.filter(x=>now-x.lastSeen<window && x.failures<5).map(x=>{
    const cap=overlap(x.capabilities,wanted);
    const freshness=Math.max(0.2,1-(now-x.lastSeen)/window);
    const latency=Math.max(0.1,Math.min(1,1000/Math.max(100,x.latencyMs)));
    const score=cap*Number(p.capabilityWeight)+(x.trust||.1)*Number(p.trustWeight)+freshness*Number(p.freshnessWeight)+latency*Number(p.latencyWeight);
    return {...x,routeScore:score};
  }).sort((a,b)=>b.routeScore-a.routeScore).slice(0,limit);
}
