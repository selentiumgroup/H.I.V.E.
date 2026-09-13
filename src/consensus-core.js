import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonical } from './identity.js';

export function epochForHeight(height, epochBlocks){return Math.floor(Math.max(0,Number(height)-1)/Math.max(1,Number(epochBlocks)||1));}
export function epochStartHeight(height, epochBlocks){const e=epochForHeight(height,epochBlocks);return e*Math.max(1,Number(epochBlocks)||1)+1;}
export function deterministicLeader({height,round,prevHash,validators=[]}){
  const xs=[...validators].sort();if(!xs.length)return '';
  const h=crypto.createHash('sha256').update(`${height}:${round}:${prevHash}`).digest();
  const n=h.readUInt32BE(0)%xs.length;return xs[n];
}
export function stateRoot(state){
  const balances=[...state.balances.entries()].map(([address,atomic])=>[address,atomic.toString()]).sort((a,b)=>a[0].localeCompare(b[0]));
  const nonces=[...state.nonces.entries()].map(([address,nonce])=>[address,Number(nonce)]).sort((a,b)=>a[0].localeCompare(b[0]));
  const bonds=[...state.bonds.values()].map(x=>({nodeId:x.nodeId,address:x.address,publicKey:x.publicKey,rewardAddress:x.rewardAddress,atomic:BigInt(x.atomic||0).toString(),jailUntilHeight:Number(x.jailUntilHeight)||0,slashedAtomic:BigInt(x.slashedAtomic||0).toString()})).sort((a,b)=>a.nodeId.localeCompare(b.nodeId));
  const pending=(state.pendingUnbonds||[]).map(x=>({address:x.address,atomic:BigInt(x.atomic).toString(),releaseHeight:Number(x.releaseHeight),validatorNodeId:x.validatorNodeId||''})).sort((a,b)=>a.releaseHeight-b.releaseHeight||a.address.localeCompare(b.address));
  return crypto.createHash('sha256').update(canonical({balances,nonces,bonds,pendingUnbonds:pending})).digest('hex');
}

export class SnapshotManager{
  constructor({config,identity,store}){this.c=config;this.identity=identity;this.store=store;this.dir=path.join(config.dataDir,'snapshots');fs.mkdirSync(this.dir,{recursive:true});}
  maybeCreate(block){if(!this.c.snapshotIntervalBlocks||Number(block.index)%this.c.snapshotIntervalBlocks!==0)return null;return this.create(block.index);}
  create(height=Number(this.store.ledgerHead().index)){
    const block=this.store.blockAtIndex(height);if(!block)throw new Error('snapshot block not found');const state=this.store.chainState(height);const payload={version:1,networkId:this.c.networkId,height:Number(height),blockHash:block.hash,stateRoot:block.stateRoot||stateRoot(state),totalSupplyAtomic:this.store.totalSupplyAtomic().toString(),createdAt:Date.now(),validatorEpoch:epochForHeight(height,this.c.validatorEpochBlocks)};const proof=this.identity.envelope({networkId:this.c.networkId,type:'state-snapshot',payload});const file=path.join(this.dir,`snapshot-${height}-${block.hash.slice(0,12)}.json`);fs.writeFileSync(file,JSON.stringify({payload,proof},null,2),{mode:0o600});this.store.upsertCheckpoint?.({height,blockHash:block.hash,stateRoot:payload.stateRoot,file,proof,createdAt:payload.createdAt});return {payload,proof,file};
  }
  latest(){return this.store.latestCheckpoint?.()||null;}
}
