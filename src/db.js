import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { formatNRN, parseNRN } from './wallet.js';
import { canonical, Identity } from './identity.js';

function safe(db,sql){try{db.exec(sql);}catch{}}
function allocationAtomic(a){try{return a.atomic!==undefined?BigInt(a.atomic):parseNRN(String(a.nrn??0));}catch{return 0n;}}

export class Store {
  constructor(dataDir,config=null){
    this.config=config||{};fs.mkdirSync(dataDir,{recursive:true});this.db=new DatabaseSync(path.join(dataDir,'mesh-v4.sqlite'));
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS peers(
        node_id TEXT PRIMARY KEY,url TEXT NOT NULL DEFAULT '',dial_url TEXT NOT NULL DEFAULT '',relay_url TEXT NOT NULL DEFAULT '',public_key TEXT NOT NULL,
        capabilities TEXT NOT NULL,hardware TEXT NOT NULL,model TEXT,provider TEXT NOT NULL DEFAULT '',protocol_version TEXT NOT NULL DEFAULT '',listen_port INTEGER NOT NULL DEFAULT 0,relay_capable INTEGER NOT NULL DEFAULT 0,
        reward_address TEXT NOT NULL DEFAULT '',network_id TEXT NOT NULL DEFAULT '',descriptor_signature TEXT NOT NULL DEFAULT '',issued_at INTEGER NOT NULL DEFAULT 0,admission TEXT NOT NULL DEFAULT '{}',trust REAL NOT NULL DEFAULT 0.15,
        latency_ms REAL NOT NULL DEFAULT 9999,last_seen INTEGER NOT NULL,failures INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS tasks(task_id TEXT PRIMARY KEY,prompt TEXT NOT NULL,answer TEXT,route TEXT,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts(receipt_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,worker_id TEXT NOT NULL,origin_id TEXT NOT NULL,score REAL NOT NULL,nrn REAL NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memory(key TEXT PRIMARY KEY,value TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger_blocks(block_index INTEGER PRIMARY KEY,block_hash TEXT UNIQUE NOT NULL,prev_hash TEXT NOT NULL,payload TEXT NOT NULL,minted_nrn REAL NOT NULL,minted_atomic TEXT NOT NULL DEFAULT '0',created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mempool(tx_id TEXT PRIMARY KEY,payload TEXT NOT NULL,received_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS validator_votes(
        vote_id TEXT PRIMARY KEY,validator_id TEXT NOT NULL,height INTEGER NOT NULL,round INTEGER NOT NULL,block_hash TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_validator_votes_slot ON validator_votes(validator_id,height,round);
      CREATE TABLE IF NOT EXISTS slash_evidence(
        evidence_id TEXT PRIMARY KEY,validator_id TEXT NOT NULL,height INTEGER NOT NULL,round INTEGER NOT NULL,payload TEXT NOT NULL,consumed INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evolution_genomes(
        genome_id TEXT PRIMARY KEY,parent_id TEXT NOT NULL DEFAULT '',generation INTEGER NOT NULL DEFAULT 0,author_node_id TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,policy TEXT NOT NULL,benchmark_score REAL NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_evolution_genomes_status ON evolution_genomes(status,updated_at);
      CREATE TABLE IF NOT EXISTS evolution_observations(
        task_id TEXT PRIMARY KEY,genome_id TEXT NOT NULL,success INTEGER NOT NULL,latency_ms REAL NOT NULL,output_chars INTEGER NOT NULL,worker_count INTEGER NOT NULL,heuristic_score REAL NOT NULL,user_score REAL,created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_evolution_observations_genome ON evolution_observations(genome_id,created_at);
      CREATE TABLE IF NOT EXISTS evolution_events(
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL,genome_id TEXT NOT NULL DEFAULT '',payload TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collective_tournaments(
        tournament_id TEXT PRIMARY KEY,epoch INTEGER NOT NULL,seed TEXT NOT NULL,status TEXT NOT NULL,candidates TEXT NOT NULL,winner_id TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,closes_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collective_votes(
        tournament_id TEXT NOT NULL,node_id TEXT NOT NULL,genome_id TEXT NOT NULL,score REAL NOT NULL,weight REAL NOT NULL,proof TEXT NOT NULL,created_at INTEGER NOT NULL,
        PRIMARY KEY(tournament_id,node_id)
      );
      CREATE INDEX IF NOT EXISTS idx_collective_votes_tournament ON collective_votes(tournament_id,created_at);
      CREATE TABLE IF NOT EXISTS collective_lineage(
        genome_id TEXT PRIMARY KEY,parents TEXT NOT NULL,species_id TEXT NOT NULL,tournament_id TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_artifacts(
        artifact_id TEXT PRIMARY KEY,author_node_id TEXT NOT NULL,type TEXT NOT NULL,domain TEXT NOT NULL,quality REAL NOT NULL,payload TEXT NOT NULL,proof TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_domain ON knowledge_artifacts(domain,quality,created_at);
      CREATE TABLE IF NOT EXISTS federated_updates(
        round_id TEXT NOT NULL,node_id TEXT NOT NULL,vector TEXT NOT NULL,weight REAL NOT NULL,proof TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(round_id,node_id)
      );
      CREATE TABLE IF NOT EXISTS federated_rounds(
        round_id TEXT PRIMARY KEY,status TEXT NOT NULL,aggregate_vector TEXT NOT NULL DEFAULT '[]',participants INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evolution_anchors(
        anchor_id TEXT PRIMARY KEY,tournament_id TEXT NOT NULL,winner_id TEXT NOT NULL,tally_hash TEXT NOT NULL,consensus_hash TEXT NOT NULL,committee TEXT NOT NULL,threshold INTEGER NOT NULL,votes TEXT NOT NULL,status TEXT NOT NULL,block_index INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS training_runs(
        run_id TEXT PRIMARY KEY,node_id TEXT NOT NULL,base_model TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL,dataset_hash TEXT NOT NULL,artifact_count INTEGER NOT NULL DEFAULT 0,adapter_id TEXT NOT NULL DEFAULT '',metrics TEXT NOT NULL DEFAULT '{}',error TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS model_adapters(
        adapter_id TEXT PRIMARY KEY,author_node_id TEXT NOT NULL,base_model TEXT NOT NULL,domain TEXT NOT NULL DEFAULT 'general',manifest TEXT NOT NULL,proof TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'candidate',benchmark_score REAL NOT NULL DEFAULT 0,local_path TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS content_objects(
        content_hash TEXT PRIMARY KEY,bytes INTEGER NOT NULL,kind TEXT NOT NULL DEFAULT 'blob',local_path TEXT NOT NULL DEFAULT '',source TEXT NOT NULL DEFAULT '',meta TEXT NOT NULL DEFAULT '{}',verified INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,last_access INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS content_providers(
        content_hash TEXT NOT NULL,node_id TEXT NOT NULL,last_seen INTEGER NOT NULL,score REAL NOT NULL DEFAULT 0.5,PRIMARY KEY(content_hash,node_id)
      );
      CREATE INDEX IF NOT EXISTS idx_content_providers_hash ON content_providers(content_hash,score,last_seen);
      CREATE TABLE IF NOT EXISTS adapter_federated_votes(
        round_id TEXT NOT NULL,node_id TEXT NOT NULL,adapter_id TEXT NOT NULL,score REAL NOT NULL,proof TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(round_id,node_id,adapter_id)
      );
      CREATE TABLE IF NOT EXISTS consensus_checkpoints(
        height INTEGER PRIMARY KEY,block_hash TEXT NOT NULL,state_root TEXT NOT NULL,file TEXT NOT NULL DEFAULT '',proof TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL
      );
    `);
    safe(this.db,"ALTER TABLE peers ADD COLUMN dial_url TEXT NOT NULL DEFAULT ''");
    safe(this.db,"ALTER TABLE peers ADD COLUMN listen_port INTEGER NOT NULL DEFAULT 0");
    safe(this.db,"ALTER TABLE peers ADD COLUMN relay_capable INTEGER NOT NULL DEFAULT 0");
  }
  close(){try{this.db.close();}catch{}}
  hasPeer(nodeId){return !!this.db.prepare('SELECT 1 x FROM peers WHERE node_id=?').get(nodeId);}
  purgeForeignPeers(networkId){const r=this.db.prepare("DELETE FROM peers WHERE network_id<>'' AND network_id<>?").run(String(networkId||''));return Number(r.changes||0);}
  upsertPeer(p,{dialUrl=''}={}){
    if(!p?.nodeId||!p.publicKey)return;
    const s=this.db.prepare(`INSERT INTO peers(node_id,url,dial_url,relay_url,public_key,capabilities,hardware,model,provider,protocol_version,listen_port,relay_capable,reward_address,network_id,descriptor_signature,issued_at,admission,trust,latency_ms,last_seen,failures)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
      ON CONFLICT(node_id) DO UPDATE SET url=excluded.url,
      dial_url=CASE WHEN excluded.dial_url<>'' THEN excluded.dial_url ELSE peers.dial_url END,
      relay_url=excluded.relay_url,public_key=excluded.public_key,
      capabilities=excluded.capabilities,hardware=excluded.hardware,model=excluded.model,provider=excluded.provider,
      protocol_version=excluded.protocol_version,listen_port=excluded.listen_port,relay_capable=excluded.relay_capable,reward_address=excluded.reward_address,network_id=excluded.network_id,descriptor_signature=excluded.descriptor_signature,issued_at=excluded.issued_at,admission=excluded.admission,last_seen=excluded.last_seen`);
    s.run(p.nodeId,p.url||'',dialUrl||p.dialUrl||'',p.relayUrl||'',p.publicKey,JSON.stringify(p.capabilities||[]),JSON.stringify(p.hardware||{}),p.model||'',p.provider||'',p.protocolVersion||'',Number(p.listenPort)||0,p.relayCapable?1:0,p.rewardAddress||'',p.networkId||'',p.descriptorSignature||'',Number(p.issuedAt)||0,JSON.stringify(p.admission||{}),p.trust??0.15,p.latencyMs??9999,Date.now());
  }
  setPeerDialUrl(nodeId,dialUrl){if(nodeId&&dialUrl)this.db.prepare('UPDATE peers SET dial_url=?,last_seen=? WHERE node_id=?').run(String(dialUrl).replace(/\/$/,''),Date.now(),nodeId);}
  peers(){return this.db.prepare('SELECT * FROM peers ORDER BY last_seen DESC').all().map(r=>({nodeId:r.node_id,url:r.url,dialUrl:r.dial_url||'',relayUrl:r.relay_url||'',publicKey:r.public_key,capabilities:JSON.parse(r.capabilities),hardware:JSON.parse(r.hardware),model:r.model,provider:r.provider||'',protocolVersion:r.protocol_version||'',listenPort:Number(r.listen_port)||0,relayCapable:!!r.relay_capable,rewardAddress:r.reward_address||'',networkId:r.network_id||'',descriptorSignature:r.descriptor_signature||'',issuedAt:Number(r.issued_at)||0,admission:JSON.parse(r.admission||'{}'),trust:r.trust,latencyMs:r.latency_ms,lastSeen:r.last_seen,failures:r.failures}));}
  setPeerMetrics(nodeId,latencyMs,success=true){if(success)this.db.prepare('UPDATE peers SET latency_ms=?,last_seen=?,failures=MAX(failures-1,0),trust=MIN(trust+0.01,0.99) WHERE node_id=?').run(latencyMs,Date.now(),nodeId);else this.db.prepare('UPDATE peers SET failures=failures+1,trust=MAX(trust-0.03,0.01) WHERE node_id=?').run(nodeId);}
  penalizePeer(nodeId,amount=.15){this.db.prepare('UPDATE peers SET failures=failures+1,trust=MAX(trust-?,0.001) WHERE node_id=?').run(Number(amount),nodeId);}
  addTask(t){this.db.prepare('INSERT OR REPLACE INTO tasks(task_id,prompt,answer,route,created_at) VALUES(?,?,?,?,?)').run(t.taskId,t.prompt,t.answer||'',JSON.stringify(t.route||[]),Date.now());}
  addReceipt(r){this.db.prepare('INSERT OR IGNORE INTO receipts(receipt_id,task_id,worker_id,origin_id,score,nrn,payload,created_at) VALUES(?,?,?,?,?,?,?,?)').run(r.claimId||r.receiptId,r.taskId,r.workerId,r.originId,r.score,Number(r.grossNrn??r.nrn??0),JSON.stringify(r),r.createdAt||Date.now());}
  receipts(limit=100){return this.db.prepare('SELECT payload FROM receipts ORDER BY created_at DESC LIMIT ?').all(limit).map(r=>JSON.parse(r.payload));}
  ensureGenesis(g){const existing=this.db.prepare('SELECT payload FROM ledger_blocks WHERE block_index=0').get();if(existing){const old=JSON.parse(existing.payload);if(old.networkId!==g.networkId||old.hash!==g.hash)throw new Error(`ledger genesis mismatch: database=${old.networkId}, runtime=${g.networkId}`);return;}this.db.prepare('INSERT INTO ledger_blocks(block_index,block_hash,prev_hash,payload,minted_nrn,minted_atomic,created_at) VALUES(?,?,?,?,?,?,?)').run(0,g.hash,g.prevHash,JSON.stringify(g),0,'0',0);}
  addBlock(b){
    this.db.prepare('INSERT OR IGNORE INTO ledger_blocks(block_index,block_hash,prev_hash,payload,minted_nrn,minted_atomic,created_at) VALUES(?,?,?,?,?,?,?)').run(b.index,b.hash,b.prevHash,JSON.stringify(b),Number(b.mintedNRN||0),String(b.mintedAtomic||'0'),b.createdAt);
    for(const r of b.receipts||[])this.addReceipt(r);for(const tx of b.transactions||[])this.deleteMempool(tx.txId);for(const s of b.slashings||[])this.db.prepare('UPDATE slash_evidence SET consumed=1 WHERE evidence_id=?').run(s.evidenceId);for(const a of b.evolutionAnchors||[])this.markEvolutionAnchorAnchored(a.anchorId,b.index);
  }
  hasBlock(hash){return !!this.db.prepare('SELECT 1 x FROM ledger_blocks WHERE block_hash=?').get(hash);}
  ledgerHead(){const r=this.db.prepare('SELECT payload FROM ledger_blocks ORDER BY block_index DESC LIMIT 1').get();return JSON.parse(r.payload);}
  blocksFrom(index=0,limit=100){return this.db.prepare('SELECT payload FROM ledger_blocks WHERE block_index>=? ORDER BY block_index ASC LIMIT ?').all(index,limit).map(r=>JSON.parse(r.payload));}

  blockAtIndex(index){const r=this.db.prepare('SELECT payload FROM ledger_blocks WHERE block_index=?').get(Number(index));return r?JSON.parse(r.payload):null;}
  blockByHash(hash){const r=this.db.prepare('SELECT payload FROM ledger_blocks WHERE block_hash=?').get(String(hash));return r?JSON.parse(r.payload):null;}
  allBlocks(){return this.db.prepare('SELECT payload FROM ledger_blocks ORDER BY block_index ASC').all().map(r=>JSON.parse(r.payload));}
  totalSupplyAtomic(){return this.allBlocks().reduce((s,b)=>s+BigInt(b.mintedAtomic||0),0n);}
  totalSupply(){return Number(formatNRN(this.totalSupplyAtomic()));}
  chainState(untilHeight=Infinity){
    const balances=new Map(),nonces=new Map(),txIds=new Set(),bonds=new Map(),pendingUnbonds=[];
    const delay=Math.max(0,Number(this.config?.unbondDelayBlocks)||0);
    const add=(addr,delta)=>{if(!addr)return;balances.set(addr,(balances.get(addr)||0n)+BigInt(delta));};
    const release=(height)=>{for(let i=pendingUnbonds.length-1;i>=0;i--){const u=pendingUnbonds[i];if(u.releaseHeight<=height){add(u.address,u.atomic);pendingUnbonds.splice(i,1);}}};
    for(const b of this.allBlocks()){if(Number(b.index)>Number(untilHeight))break;release(Number(b.index));
      for(const r of b.receipts||[])for(const a of r.allocations||[])add(a.address||a.nodeId,allocationAtomic(a));
      for(const tx of b.transactions||[]){
        const fee=BigInt(tx.feeAtomic||0);const amount=BigInt(tx.amountAtomic||0);
        if(tx.type==='transfer'){add(tx.from,-amount-fee);add(tx.to,amount);}
        else if(tx.type==='bond'){
          add(tx.from,-amount-fee);const old=bonds.get(tx.validatorNodeId);
          if(old){old.atomic+=amount;old.rewardAddress=tx.rewardAddress;old.publicKey=tx.validatorPublicKey;}
          else bonds.set(tx.validatorNodeId,{nodeId:tx.validatorNodeId,address:tx.from,publicKey:tx.validatorPublicKey,rewardAddress:tx.rewardAddress,atomic:amount,jailUntilHeight:0,slashedAtomic:0n});
        }else if(tx.type==='unbond'){
          const old=bonds.get(tx.validatorNodeId);if(old){old.atomic-=amount;if(old.atomic<0n)old.atomic=0n;}add(tx.from,-fee);pendingUnbonds.push({address:tx.from,atomic:amount,releaseHeight:Number(b.index)+delay,validatorNodeId:tx.validatorNodeId});
        }
        if(fee>0n&&b.proposerRewardAddress)add(b.proposerRewardAddress,fee);nonces.set(tx.from,Math.max(nonces.get(tx.from)||0,Number(tx.nonce)||0));txIds.add(tx.txId);
      }
      for(const s of b.slashings||[]){const bond=bonds.get(s.validatorId);if(!bond)continue;const penalty=BigInt(s.penaltyAtomic||0);bond.atomic=bond.atomic>penalty?bond.atomic-penalty:0n;bond.slashedAtomic=(bond.slashedAtomic||0n)+penalty;bond.jailUntilHeight=Math.max(bond.jailUntilHeight||0,Number(s.jailUntilHeight)||0);}
    }
    const effectiveEnd=Number.isFinite(Number(untilHeight))?Number(untilHeight):Number(this.ledgerHead().index);release(effectiveEnd);return {balances,nonces,txIds,bonds,pendingUnbonds};
  }
  balances(limit=100){const {balances}=this.chainState();return [...balances.entries()].map(([address,atomic])=>({address,atomic:atomic.toString(),nrn:formatNRN(atomic)})).sort((a,b)=>BigInt(b.atomic)>BigInt(a.atomic)?1:-1).slice(0,limit);}
  balanceAtomic(address){return this.chainState().balances.get(address)||0n;}
  balance(address){return formatNRN(this.balanceAtomic(address));}
  confirmedNonce(address){return this.chainState().nonces.get(address)||0;}
  nextNonce(address){let n=this.confirmedNonce(address);for(const tx of this.mempool(10000))if(tx.from===address)n=Math.max(n,Number(tx.nonce)||0);return n+1;}
  isConfirmedTx(txId){return this.chainState().txIds.has(txId);}
  hasMempool(txId){return !!this.db.prepare('SELECT 1 x FROM mempool WHERE tx_id=?').get(txId);}
  addMempool(tx){if(this.isConfirmedTx(tx.txId))return false;const r=this.db.prepare('INSERT OR IGNORE INTO mempool(tx_id,payload,received_at) VALUES(?,?,?)').run(tx.txId,JSON.stringify(tx),Date.now());return Number(r.changes||0)>0;}
  pendingOutgoingAtomic(address){return this.mempool(10000).filter(tx=>tx.from===address&&tx.type!=='unbond').reduce((s,tx)=>s+BigInt(tx.amountAtomic||0)+BigInt(tx.feeAtomic||0),0n);}
  availableBalanceAtomic(address){return this.balanceAtomic(address)-this.pendingOutgoingAtomic(address);}
  deleteMempool(txId){this.db.prepare('DELETE FROM mempool WHERE tx_id=?').run(txId);}
  mempool(limit=100){return this.db.prepare('SELECT payload FROM mempool ORDER BY received_at ASC LIMIT ?').all(limit).map(r=>JSON.parse(r.payload));}
  transactions(address,limit=100){const out=[];const head=Number(this.ledgerHead().index);for(const b of this.allBlocks())for(const tx of b.transactions||[])if(!address||tx.from===address||tx.to===address)out.push({...tx,status:'confirmed',blockIndex:b.index,confirmations:head-Number(b.index)+1,feeRecipient:b.proposerRewardAddress||''});for(const tx of this.mempool(10000))if(!address||tx.from===address||tx.to===address)out.push({...tx,status:'pending',blockIndex:null,confirmations:0});return out.sort((a,b)=>Number(b.createdAt)-Number(a.createdAt)).slice(0,limit);}
  bondForNode(nodeId){const x=this.chainState().bonds.get(nodeId);return x?{...x,atomic:x.atomic.toString(),slashedAtomic:(x.slashedAtomic||0n).toString(),nrn:formatNRN(x.atomic)}:null;}
  validatorSet(minStakeAtomic=0n,height=Number(this.ledgerHead().index)){
    return [...this.chainState(height).bonds.values()].filter(x=>x.atomic>=BigInt(minStakeAtomic)&&(x.jailUntilHeight||0)<=height).map(x=>({...x,atomic:x.atomic.toString(),nrn:formatNRN(x.atomic)}));
  }
  recordValidatorVote(vote){
    try{
      const p=vote?.payload;if(!Identity.verifyEnvelope(vote,Infinity)||p?.type!=='block-vote'||vote.nodeId!==p.validatorId||!p.validatorId||!Number.isInteger(Number(p.height))||!Number.isInteger(Number(p.round))||!p.blockHash)return null;
      const voteId=crypto.createHash('sha256').update(canonical(vote)).digest('hex');this.db.prepare('INSERT OR IGNORE INTO validator_votes(vote_id,validator_id,height,round,block_hash,payload,created_at) VALUES(?,?,?,?,?,?,?)').run(voteId,p.validatorId,Number(p.height),Number(p.round),p.blockHash,JSON.stringify(vote),Date.now());
      const other=this.db.prepare('SELECT payload FROM validator_votes WHERE validator_id=? AND height=? AND round=? AND block_hash<>? ORDER BY created_at ASC LIMIT 1').get(p.validatorId,Number(p.height),Number(p.round),p.blockHash);
      if(!other)return null;const a=JSON.parse(other.payload),pair=[a,vote].sort((x,y)=>String(x.payload.blockHash).localeCompare(String(y.payload.blockHash)));const evidenceId=crypto.createHash('sha256').update(`${p.validatorId}:${Number(p.height)}:${Number(p.round)}`).digest('hex');const ev={version:1,evidenceId,validatorId:p.validatorId,height:Number(p.height),round:Number(p.round),voteA:pair[0],voteB:pair[1],createdAt:Date.now()};this.db.prepare('INSERT OR IGNORE INTO slash_evidence(evidence_id,validator_id,height,round,payload,created_at) VALUES(?,?,?,?,?,?)').run(evidenceId,p.validatorId,Number(p.height),Number(p.round),JSON.stringify(ev),Date.now());return ev;
    }catch{return null;}
  }
  pendingSlashings(limit=20){return this.db.prepare('SELECT payload FROM slash_evidence WHERE consumed=0 ORDER BY created_at ASC LIMIT ?').all(limit).map(r=>JSON.parse(r.payload));}

  upsertEvolutionGenome(g){
    this.db.prepare(`INSERT INTO evolution_genomes(genome_id,parent_id,generation,author_node_id,status,policy,benchmark_score,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(genome_id) DO UPDATE SET status=excluded.status,policy=excluded.policy,benchmark_score=excluded.benchmark_score,updated_at=excluded.updated_at`).run(
      g.genomeId,g.parentId||'',Number(g.generation)||0,g.authorNodeId||'',g.status||'candidate',JSON.stringify(g.policy||{}),Number(g.benchmarkScore)||0,Number.isFinite(Number(g.createdAt))?Number(g.createdAt):Date.now(),Date.now());
    return this.evolutionGenome(g.genomeId);
  }
  evolutionGenome(id){const r=this.db.prepare('SELECT * FROM evolution_genomes WHERE genome_id=?').get(id);return r?{version:1,genomeId:r.genome_id,parentId:r.parent_id,generation:Number(r.generation),authorNodeId:r.author_node_id,status:r.status,policy:JSON.parse(r.policy),benchmarkScore:Number(r.benchmark_score),createdAt:Number(r.created_at),updatedAt:Number(r.updated_at)}:null;}
  evolutionGenomes(limit=100){return this.db.prepare('SELECT * FROM evolution_genomes ORDER BY generation DESC,updated_at DESC LIMIT ?').all(limit).map(r=>({version:1,genomeId:r.genome_id,parentId:r.parent_id,generation:Number(r.generation),authorNodeId:r.author_node_id,status:r.status,policy:JSON.parse(r.policy),benchmarkScore:Number(r.benchmark_score),createdAt:Number(r.created_at),updatedAt:Number(r.updated_at)}));}
  evolutionChampion(){const r=this.db.prepare("SELECT genome_id FROM evolution_genomes WHERE status='champion' ORDER BY updated_at DESC LIMIT 1").get();return r?this.evolutionGenome(r.genome_id):null;}
  evolutionCanary(){const r=this.db.prepare("SELECT genome_id FROM evolution_genomes WHERE status='canary' ORDER BY updated_at DESC LIMIT 1").get();return r?this.evolutionGenome(r.genome_id):null;}
  setEvolutionStatus(id,status){this.db.prepare('UPDATE evolution_genomes SET status=?,updated_at=? WHERE genome_id=?').run(status,Date.now(),id);}
  clearOtherEvolutionStatus(status,exceptId,replacement='candidate'){this.db.prepare('UPDATE evolution_genomes SET status=?,updated_at=? WHERE status=? AND genome_id<>?').run(replacement,Date.now(),status,exceptId);}
  addEvolutionObservation(o){this.db.prepare(`INSERT INTO evolution_observations(task_id,genome_id,success,latency_ms,output_chars,worker_count,heuristic_score,user_score,created_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET genome_id=excluded.genome_id,success=excluded.success,latency_ms=excluded.latency_ms,output_chars=excluded.output_chars,worker_count=excluded.worker_count,heuristic_score=excluded.heuristic_score,user_score=COALESCE(excluded.user_score,evolution_observations.user_score),created_at=excluded.created_at`).run(
      o.taskId,o.genomeId,o.success?1:0,Number(o.latencyMs)||0,Number(o.outputChars)||0,Number(o.workerCount)||0,Number(o.heuristicScore)||0,o.userScore==null?null:Number(o.userScore),Date.now());}

  setEvolutionFeedback(taskId,score){const r=this.db.prepare('SELECT heuristic_score FROM evolution_observations WHERE task_id=?').get(taskId);if(!r)return false;const blended=.3*Number(r.heuristic_score)+.7*Math.max(0,Math.min(1,(Number(score)+1)/2));this.db.prepare('UPDATE evolution_observations SET user_score=?,heuristic_score=? WHERE task_id=?').run(Number(score),blended,taskId);return true;}
  evolutionObservations(genomeId,limit=100){return this.db.prepare('SELECT * FROM evolution_observations WHERE genome_id=? ORDER BY created_at DESC LIMIT ?').all(genomeId,limit).map(r=>({taskId:r.task_id,genomeId:r.genome_id,success:!!r.success,latencyMs:Number(r.latency_ms),outputChars:Number(r.output_chars),workerCount:Number(r.worker_count),heuristicScore:Number(r.heuristic_score),userScore:r.user_score==null?null:Number(r.user_score),createdAt:Number(r.created_at)}));}
  evolutionStats(genomeId,limit=100){const xs=this.evolutionObservations(genomeId,limit);const n=xs.length;if(!n)return {samples:0,fitness:0,successRate:0,errorRate:0,avgLatencyMs:0,avgWorkers:0,userRated:0};const sum=k=>xs.reduce((s,x)=>s+Number(x[k]||0),0);const success=xs.filter(x=>x.success).length;return {samples:n,fitness:sum('heuristicScore')/n,successRate:success/n,errorRate:1-success/n,avgLatencyMs:sum('latencyMs')/n,avgWorkers:sum('workerCount')/n,userRated:xs.filter(x=>x.userScore!==null).length};}
  addEvolutionEvent(type,genomeId='',payload={}){this.db.prepare('INSERT INTO evolution_events(type,genome_id,payload,created_at) VALUES(?,?,?,?)').run(type,genomeId||'',JSON.stringify(payload||{}),Date.now());}
  evolutionEvents(limit=50){return this.db.prepare('SELECT * FROM evolution_events ORDER BY event_id DESC LIMIT ?').all(limit).map(r=>({id:Number(r.event_id),type:r.type,genomeId:r.genome_id,payload:JSON.parse(r.payload||'{}'),createdAt:Number(r.created_at)}));}
  lastEvolutionObservationAt(){const r=this.db.prepare('SELECT MAX(created_at) t FROM evolution_observations').get();return Number(r?.t)||0;}
  upsertCollectiveTournament(t){this.db.prepare(`INSERT INTO collective_tournaments(tournament_id,epoch,seed,status,candidates,winner_id,created_at,closes_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(tournament_id) DO UPDATE SET status=excluded.status,candidates=excluded.candidates,winner_id=excluded.winner_id,closes_at=excluded.closes_at,updated_at=excluded.updated_at`).run(t.tournamentId,Number(t.epoch)||0,t.seed||'',t.status||'open',JSON.stringify(t.candidates||[]),t.winnerId||'',Number(t.createdAt)||Date.now(),Number(t.closesAt)||Date.now(),Date.now());return this.collectiveTournament(t.tournamentId);}
  collectiveTournament(id){const r=this.db.prepare('SELECT * FROM collective_tournaments WHERE tournament_id=?').get(id);return r?{tournamentId:r.tournament_id,epoch:Number(r.epoch),seed:r.seed,status:r.status,candidates:JSON.parse(r.candidates||'[]'),winnerId:r.winner_id,createdAt:Number(r.created_at),closesAt:Number(r.closes_at),updatedAt:Number(r.updated_at)}:null;}
  collectiveTournaments(limit=20){return this.db.prepare('SELECT * FROM collective_tournaments ORDER BY epoch DESC,updated_at DESC LIMIT ?').all(limit).map(r=>({tournamentId:r.tournament_id,epoch:Number(r.epoch),seed:r.seed,status:r.status,candidates:JSON.parse(r.candidates||'[]'),winnerId:r.winner_id,createdAt:Number(r.created_at),closesAt:Number(r.closes_at),updatedAt:Number(r.updated_at)}));}
  addCollectiveVote(v){this.db.prepare(`INSERT INTO collective_votes(tournament_id,node_id,genome_id,score,weight,proof,created_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(tournament_id,node_id) DO UPDATE SET genome_id=excluded.genome_id,score=excluded.score,weight=excluded.weight,proof=excluded.proof,created_at=excluded.created_at`).run(v.tournamentId,v.nodeId,v.genomeId,Number(v.score)||0,Number(v.weight)||1,JSON.stringify(v.proof||{}),Number(v.createdAt)||Date.now());return true;}
  collectiveVotes(tournamentId){return this.db.prepare('SELECT * FROM collective_votes WHERE tournament_id=? ORDER BY node_id ASC').all(tournamentId).map(r=>({tournamentId:r.tournament_id,nodeId:r.node_id,genomeId:r.genome_id,score:Number(r.score),weight:Number(r.weight),proof:JSON.parse(r.proof||'{}'),createdAt:Number(r.created_at)}));}
  setCollectiveLineage(genomeId,{parents=[],speciesId='',tournamentId=''}){this.db.prepare(`INSERT INTO collective_lineage(genome_id,parents,species_id,tournament_id,created_at) VALUES(?,?,?,?,?) ON CONFLICT(genome_id) DO UPDATE SET parents=excluded.parents,species_id=excluded.species_id,tournament_id=excluded.tournament_id`).run(genomeId,JSON.stringify(parents||[]),speciesId||'',tournamentId||'',Date.now());}
  collectiveLineage(genomeId){const r=this.db.prepare('SELECT * FROM collective_lineage WHERE genome_id=?').get(genomeId);return r?{genomeId:r.genome_id,parents:JSON.parse(r.parents||'[]'),speciesId:r.species_id,tournamentId:r.tournament_id,createdAt:Number(r.created_at)}:null;}
  upsertKnowledgeArtifact(a){this.db.prepare(`INSERT INTO knowledge_artifacts(artifact_id,author_node_id,type,domain,quality,payload,proof,status,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(artifact_id) DO UPDATE SET quality=MAX(knowledge_artifacts.quality,excluded.quality),status=excluded.status`).run(a.artifactId,a.authorNodeId,a.type||'distillation',a.domain||'general',Number(a.quality)||0,JSON.stringify(a.payload||{}),JSON.stringify(a.proof||{}),a.status||'active',Number(a.createdAt)||Date.now());return this.knowledgeArtifact(a.artifactId);}
  knowledgeArtifact(id){const r=this.db.prepare('SELECT * FROM knowledge_artifacts WHERE artifact_id=?').get(id);return r?{artifactId:r.artifact_id,authorNodeId:r.author_node_id,type:r.type,domain:r.domain,quality:Number(r.quality),payload:JSON.parse(r.payload),proof:JSON.parse(r.proof),status:r.status,createdAt:Number(r.created_at)}:null;}
  knowledgeArtifacts(limit=100){return this.db.prepare("SELECT * FROM knowledge_artifacts WHERE status='active' ORDER BY quality DESC,created_at DESC LIMIT ?").all(limit).map(r=>({artifactId:r.artifact_id,authorNodeId:r.author_node_id,type:r.type,domain:r.domain,quality:Number(r.quality),payload:JSON.parse(r.payload),proof:JSON.parse(r.proof),status:r.status,createdAt:Number(r.created_at)}));}
  addFederatedUpdate(u){this.db.prepare(`INSERT INTO federated_updates(round_id,node_id,vector,weight,proof,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(round_id,node_id) DO UPDATE SET vector=excluded.vector,weight=excluded.weight,proof=excluded.proof,created_at=excluded.created_at`).run(u.roundId,u.nodeId,JSON.stringify(u.vector||[]),Number(u.weight)||1,JSON.stringify(u.proof||{}),Number(u.createdAt)||Date.now());}
  federatedUpdates(roundId){return this.db.prepare('SELECT * FROM federated_updates WHERE round_id=? ORDER BY node_id').all(roundId).map(r=>({roundId:r.round_id,nodeId:r.node_id,vector:JSON.parse(r.vector),weight:Number(r.weight),proof:JSON.parse(r.proof),createdAt:Number(r.created_at)}));}
  upsertFederatedRound(r){this.db.prepare(`INSERT INTO federated_rounds(round_id,status,aggregate_vector,participants,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(round_id) DO UPDATE SET status=excluded.status,aggregate_vector=excluded.aggregate_vector,participants=excluded.participants,updated_at=excluded.updated_at`).run(r.roundId,r.status||'open',JSON.stringify(r.aggregateVector||[]),Number(r.participants)||0,Number(r.createdAt)||Date.now(),Date.now());}
  federatedRounds(limit=20){return this.db.prepare('SELECT * FROM federated_rounds ORDER BY created_at DESC LIMIT ?').all(limit).map(r=>({roundId:r.round_id,status:r.status,aggregateVector:JSON.parse(r.aggregate_vector),participants:Number(r.participants),createdAt:Number(r.created_at),updatedAt:Number(r.updated_at)}));}
  upsertEvolutionAnchor(a){this.db.prepare(`INSERT INTO evolution_anchors(anchor_id,tournament_id,winner_id,tally_hash,consensus_hash,committee,threshold,votes,status,block_index,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(anchor_id) DO UPDATE SET votes=excluded.votes,status=excluded.status,block_index=excluded.block_index`).run(a.anchorId,a.tournamentId,a.winnerId,a.tallyHash,a.consensusHash,JSON.stringify(a.committee||[]),Number(a.threshold)||0,JSON.stringify(a.votes||[]),a.status||'pending',Number(a.blockIndex)||0,Number(a.createdAt)||Date.now());return this.evolutionAnchor(a.anchorId);}
  evolutionAnchor(id){const r=this.db.prepare('SELECT * FROM evolution_anchors WHERE anchor_id=?').get(id);return r?{anchorId:r.anchor_id,tournamentId:r.tournament_id,winnerId:r.winner_id,tallyHash:r.tally_hash,consensusHash:r.consensus_hash,committee:JSON.parse(r.committee),threshold:Number(r.threshold),votes:JSON.parse(r.votes),status:r.status,blockIndex:Number(r.block_index),createdAt:Number(r.created_at)}:null;}
  pendingEvolutionAnchors(limit=20){return this.db.prepare("SELECT * FROM evolution_anchors WHERE status='certified' ORDER BY created_at LIMIT ?").all(limit).map(r=>({anchorId:r.anchor_id,tournamentId:r.tournament_id,winnerId:r.winner_id,tallyHash:r.tally_hash,consensusHash:r.consensus_hash,committee:JSON.parse(r.committee),threshold:Number(r.threshold),votes:JSON.parse(r.votes),status:r.status,blockIndex:Number(r.block_index),createdAt:Number(r.created_at)}));}
  evolutionAnchors(limit=50){return this.db.prepare('SELECT * FROM evolution_anchors ORDER BY created_at DESC LIMIT ?').all(limit).map(r=>({anchorId:r.anchor_id,tournamentId:r.tournament_id,winnerId:r.winner_id,tallyHash:r.tally_hash,consensusHash:r.consensus_hash,committee:JSON.parse(r.committee),threshold:Number(r.threshold),votes:JSON.parse(r.votes),status:r.status,blockIndex:Number(r.block_index),createdAt:Number(r.created_at)}));}
  markEvolutionAnchorAnchored(id,blockIndex){this.db.prepare("UPDATE evolution_anchors SET status='anchored',block_index=? WHERE anchor_id=?").run(Number(blockIndex),id);}
  upsertTrainingRun(r){this.db.prepare(`INSERT INTO training_runs(run_id,node_id,base_model,mode,status,dataset_hash,artifact_count,adapter_id,metrics,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET status=excluded.status,adapter_id=excluded.adapter_id,metrics=excluded.metrics,error=excluded.error,updated_at=excluded.updated_at`).run(r.runId,r.nodeId||'',r.baseModel||'',r.mode||'',r.status||'queued',r.datasetHash||'',Number(r.artifactCount)||0,r.adapterId||'',JSON.stringify(r.metrics||{}),r.error||'',Number(r.createdAt)||Date.now(),Date.now());return this.trainingRun(r.runId);}
  trainingRun(id){const r=this.db.prepare('SELECT * FROM training_runs WHERE run_id=?').get(id);return r?{runId:r.run_id,nodeId:r.node_id,baseModel:r.base_model,mode:r.mode,status:r.status,datasetHash:r.dataset_hash,artifactCount:Number(r.artifact_count),adapterId:r.adapter_id,metrics:JSON.parse(r.metrics||'{}'),error:r.error,createdAt:Number(r.created_at),updatedAt:Number(r.updated_at)}:null;}
  trainingRuns(limit=20){return this.db.prepare('SELECT * FROM training_runs ORDER BY created_at DESC LIMIT ?').all(limit).map(r=>({runId:r.run_id,nodeId:r.node_id,baseModel:r.base_model,mode:r.mode,status:r.status,datasetHash:r.dataset_hash,artifactCount:Number(r.artifact_count),adapterId:r.adapter_id,metrics:JSON.parse(r.metrics||'{}'),error:r.error,createdAt:Number(r.created_at),updatedAt:Number(r.updated_at)}));}
  upsertModelAdapter(a){this.db.prepare(`INSERT INTO model_adapters(adapter_id,author_node_id,base_model,domain,manifest,proof,status,benchmark_score,local_path,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(adapter_id) DO UPDATE SET status=excluded.status,benchmark_score=MAX(model_adapters.benchmark_score,excluded.benchmark_score),local_path=CASE WHEN excluded.local_path<>'' THEN excluded.local_path ELSE model_adapters.local_path END`).run(a.adapterId,a.authorNodeId||'',a.baseModel||'',a.domain||'general',JSON.stringify(a.manifest||{}),JSON.stringify(a.proof||{}),a.status||'candidate',Number(a.benchmarkScore)||0,a.localPath||'',Number(a.createdAt)||Date.now());return this.modelAdapter(a.adapterId);}
  modelAdapter(id){const r=this.db.prepare('SELECT * FROM model_adapters WHERE adapter_id=?').get(id);return r?{adapterId:r.adapter_id,authorNodeId:r.author_node_id,baseModel:r.base_model,domain:r.domain,manifest:JSON.parse(r.manifest||'{}'),proof:JSON.parse(r.proof||'{}'),status:r.status,benchmarkScore:Number(r.benchmark_score),localPath:r.local_path,createdAt:Number(r.created_at)}:null;}
  modelAdapters(limit=50){return this.db.prepare('SELECT * FROM model_adapters ORDER BY benchmark_score DESC,created_at DESC LIMIT ?').all(limit).map(r=>({adapterId:r.adapter_id,authorNodeId:r.author_node_id,baseModel:r.base_model,domain:r.domain,manifest:JSON.parse(r.manifest||'{}'),proof:JSON.parse(r.proof||'{}'),status:r.status,benchmarkScore:Number(r.benchmark_score),localPath:r.local_path,createdAt:Number(r.created_at)}));}

  upsertContentObject(o){this.db.prepare(`INSERT INTO content_objects(content_hash,bytes,kind,local_path,source,meta,verified,created_at,last_access) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(content_hash) DO UPDATE SET bytes=excluded.bytes,kind=excluded.kind,local_path=CASE WHEN excluded.local_path<>'' THEN excluded.local_path ELSE content_objects.local_path END,source=CASE WHEN excluded.source<>'' THEN excluded.source ELSE content_objects.source END,meta=excluded.meta,verified=MAX(content_objects.verified,excluded.verified),last_access=excluded.last_access`).run(o.hash,Number(o.bytes)||0,o.kind||'blob',o.localPath||'',o.source||'',JSON.stringify(o.meta||{}),o.verified?1:0,Date.now(),Date.now());return this.contentObject(o.hash);}
  contentObject(hash){const r=this.db.prepare('SELECT * FROM content_objects WHERE content_hash=?').get(hash);return r?{hash:r.content_hash,bytes:Number(r.bytes),kind:r.kind,localPath:r.local_path,source:r.source,meta:JSON.parse(r.meta||'{}'),verified:!!r.verified,createdAt:Number(r.created_at),lastAccess:Number(r.last_access)}:null;}
  contentObjects(limit=100){return this.db.prepare('SELECT * FROM content_objects ORDER BY last_access DESC LIMIT ?').all(limit).map(r=>({hash:r.content_hash,bytes:Number(r.bytes),kind:r.kind,localPath:r.local_path,source:r.source,meta:JSON.parse(r.meta||'{}'),verified:!!r.verified,createdAt:Number(r.created_at),lastAccess:Number(r.last_access)}));}
  upsertContentProvider(p){this.db.prepare(`INSERT INTO content_providers(content_hash,node_id,last_seen,score) VALUES(?,?,?,?) ON CONFLICT(content_hash,node_id) DO UPDATE SET last_seen=excluded.last_seen,score=MAX(content_providers.score,excluded.score)`).run(p.hash,p.nodeId,Number(p.lastSeen)||Date.now(),Number(p.score)||0.5);}
  contentProviders(hash){return this.db.prepare('SELECT * FROM content_providers WHERE content_hash=? ORDER BY score DESC,last_seen DESC').all(hash).map(r=>({hash:r.content_hash,nodeId:r.node_id,lastSeen:Number(r.last_seen),score:Number(r.score)}));}
  contentProviderCount(){return Number(this.db.prepare('SELECT COUNT(*) n FROM content_providers').get().n);}

  addAdapterVote(v){this.db.prepare(`INSERT INTO adapter_federated_votes(round_id,node_id,adapter_id,score,proof,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(round_id,node_id,adapter_id) DO UPDATE SET score=excluded.score,proof=excluded.proof,created_at=excluded.created_at`).run(v.roundId,v.nodeId,v.adapterId,Number(v.score)||0,JSON.stringify(v.proof||{}),Number(v.createdAt)||Date.now());}
  adapterVotes(roundId,adapterId){return this.db.prepare('SELECT * FROM adapter_federated_votes WHERE round_id=? AND adapter_id=? ORDER BY node_id').all(roundId,adapterId).map(r=>({roundId:r.round_id,nodeId:r.node_id,adapterId:r.adapter_id,score:Number(r.score),proof:JSON.parse(r.proof||'{}'),createdAt:Number(r.created_at)}));}
  upsertCheckpoint(c){this.db.prepare(`INSERT INTO consensus_checkpoints(height,block_hash,state_root,file,proof,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(height) DO UPDATE SET block_hash=excluded.block_hash,state_root=excluded.state_root,file=excluded.file,proof=excluded.proof,created_at=excluded.created_at`).run(Number(c.height),c.blockHash,c.stateRoot,c.file||'',JSON.stringify(c.proof||{}),Number(c.createdAt)||Date.now());return this.checkpoint(Number(c.height));}
  checkpoint(height){const r=this.db.prepare('SELECT * FROM consensus_checkpoints WHERE height=?').get(Number(height));return r?{height:Number(r.height),blockHash:r.block_hash,stateRoot:r.state_root,file:r.file,proof:JSON.parse(r.proof||'{}'),createdAt:Number(r.created_at)}:null;}
  latestCheckpoint(){const r=this.db.prepare('SELECT * FROM consensus_checkpoints ORDER BY height DESC LIMIT 1').get();return r?{height:Number(r.height),blockHash:r.block_hash,stateRoot:r.state_root,file:r.file,proof:JSON.parse(r.proof||'{}'),createdAt:Number(r.created_at)}:null;}
  checkpoints(limit=20){return this.db.prepare('SELECT * FROM consensus_checkpoints ORDER BY height DESC LIMIT ?').all(limit).map(r=>({height:Number(r.height),blockHash:r.block_hash,stateRoot:r.state_root,file:r.file,proof:JSON.parse(r.proof||'{}'),createdAt:Number(r.created_at)}));}
  stats(){const p=Number(this.db.prepare('SELECT COUNT(*) n FROM peers').get().n);const t=Number(this.db.prepare('SELECT COUNT(*) n FROM tasks').get().n);const r=this.db.prepare('SELECT COUNT(*) n FROM receipts').get();const m=this.db.prepare('SELECT COUNT(*) n FROM mempool').get();const se=this.db.prepare('SELECT COUNT(*) n FROM slash_evidence WHERE consumed=0').get();const h=this.ledgerHead();return {peers:p,tasks:t,receipts:Number(r.n),mempool:Number(m.n),pendingSlashings:Number(se.n),validators:this.chainState().bonds.size,ledgerHeight:Number(h.index),totalSupplyNRN:formatNRN(this.totalSupplyAtomic())};}
}
