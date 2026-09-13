function asBuffer(v){
  if(Buffer.isBuffer(v))return v;
  if(v instanceof Uint8Array)return Buffer.from(v);
  return Buffer.from(String(v),'utf8');
}

export function bencode(value){
  if(Buffer.isBuffer(value)||value instanceof Uint8Array||typeof value==='string'){
    const b=asBuffer(value);return Buffer.concat([Buffer.from(String(b.length)+':'),b]);
  }
  if(Number.isInteger(value)||typeof value==='bigint')return Buffer.from(`i${value}e`);
  if(Array.isArray(value))return Buffer.concat([Buffer.from('l'),...value.map(bencode),Buffer.from('e')]);
  if(value&&typeof value==='object'){
    const keys=Object.keys(value).sort();const parts=[Buffer.from('d')];
    for(const k of keys){if(value[k]===undefined||value[k]===null)continue;parts.push(bencode(k),bencode(value[k]));}
    parts.push(Buffer.from('e'));return Buffer.concat(parts);
  }
  throw new TypeError(`unsupported bencode type: ${typeof value}`);
}

export function bdecode(buf){
  buf=Buffer.from(buf);let i=0;
  function parse(){
    if(i>=buf.length)throw new Error('unexpected end of bencode');
    const c=buf[i];
    if(c===0x69){ // i
      i++;const e=buf.indexOf(0x65,i);if(e<0)throw new Error('unterminated integer');
      const n=Number(buf.subarray(i,e).toString('ascii'));if(!Number.isSafeInteger(n))throw new Error('invalid integer');i=e+1;return n;
    }
    if(c===0x6c){i++;const a=[];while(buf[i]!==0x65)a.push(parse());i++;return a;}
    if(c===0x64){i++;const o={};while(buf[i]!==0x65){const k=parse().toString('utf8');o[k]=parse();}i++;return o;}
    if(c>=0x30&&c<=0x39){const colon=buf.indexOf(0x3a,i);if(colon<0)throw new Error('invalid bytes length');const len=Number(buf.subarray(i,colon).toString('ascii'));if(!Number.isSafeInteger(len)||len<0)throw new Error('invalid bytes length');i=colon+1;const end=i+len;if(end>buf.length)throw new Error('truncated bytes');const out=buf.subarray(i,end);i=end;return out;}
    throw new Error(`invalid bencode token 0x${c.toString(16)}`);
  }
  const out=parse();if(i!==buf.length)throw new Error('trailing bencode data');return out;
}

export function text(v){return Buffer.isBuffer(v)?v.toString('utf8'):String(v??'');}
