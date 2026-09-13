export function peerEndpoint(p){return String(p?.url||p?.dialUrl||'').replace(/\/$/,'');}

export function descriptorView(p){
  if(!p)return p;
  const {dialUrl,trust,latencyMs,lastSeen,failures,...d}=p;
  return d;
}

export function isDialable(p){return !!peerEndpoint(p);}
