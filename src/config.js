import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

function loadDotEnv(file='.env') {
  try {
    const text=fs.readFileSync(file,'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line=raw.trim(); if(!line || line.startsWith('#')) continue;
      const i=line.indexOf('='); if(i<1) continue;
      const k=line.slice(0,i).trim(); let v=line.slice(i+1).trim();
      if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
      if(process.env[k]===undefined) process.env[k]=v;
    }
  } catch {}
}
loadDotEnv();

function bool(v,d=false){ if(v==null)return d; return ['1','true','yes','on'].includes(String(v).toLowerCase()); }
function int(v,d){ const n=Number.parseInt(v??'',10); return Number.isFinite(n)?n:d; }
function num(v,d){ const n=Number(v); return Number.isFinite(n)?n:d; }
function list(v=''){ return String(v).split(',').map(x=>x.trim().replace(/\/$/,'')).filter(Boolean); }
function localIPv4(){ for(const xs of Object.values(os.networkInterfaces())) for(const x of xs??[]) if(x.family==='IPv4'&&!x.internal)return x.address; return '127.0.0.1'; }
function ensureLocalSecret(dataDir){
  fs.mkdirSync(dataDir,{recursive:true});const f=path.join(dataDir,'.local-keystore-secret');
  try{const x=fs.readFileSync(f,'utf8').trim();if(x.length>=32)return x;}catch{}
  const x=crypto.randomBytes(32).toString('base64url');fs.writeFileSync(f,x+'\n',{mode:0o600});return x;
}

export function loadConfig(){
  const port=int(process.env.PORT,48686);
  const host=process.env.HOST||'0.0.0.0';
  const privateNode=bool(process.env.PRIVATE_NODE,false);
  const zeroTouchEnabled=bool(process.env.ZERO_TOUCH_ENABLED,true);
  const autoUrl=`http://${localIPv4()}:${port}`;
  let publicUrl=(process.env.PUBLIC_URL??(zeroTouchEnabled?'':(privateNode?'':autoUrl))).trim().replace(/\/$/,'');
  if(publicUrl==='auto') publicUrl=autoUrl;
  if(privateNode) publicUrl='';
  const securityMode=(process.env.SECURITY_MODE||'testnet').toLowerCase();
  const dataDir=path.resolve(process.env.DATA_DIR||'./data');
  const explicitWalletPassword=!!process.env.WALLET_PASSWORD;
  const explicitNodeKeyPassword=!!process.env.NODE_KEY_PASSWORD;
  const autoLocalSecret=bool(process.env.AUTO_LOCAL_SECRET,true);
  const generatedSecret=(securityMode!=='mainnet'&&!explicitWalletPassword&&!explicitNodeKeyPassword&&autoLocalSecret)?ensureLocalSecret(dataDir):'';
  const walletPassword=process.env.WALLET_PASSWORD||generatedSecret||'';
  const nodeKeyPassword=process.env.NODE_KEY_PASSWORD||walletPassword;
  return {
    protocolVersion:'0.12.0',
    port,host,publicUrl,privateNode,
    dataDir,
    networkId:process.env.NETWORK_ID||'neural-mesh-testnet-v7',
    zeroTouchEnabled,
    mainlineDhtEnabled:bool(process.env.MAINLINE_DHT_ENABLED,zeroTouchEnabled),
    mainlineDhtAnnounce:bool(process.env.MAINLINE_DHT_ANNOUNCE,true),
    mainlineDhtHost:process.env.MAINLINE_DHT_HOST||'0.0.0.0',
    mainlineDhtPort:int(process.env.MAINLINE_DHT_PORT,port),
    mainlineDhtBootstrap:list(process.env.MAINLINE_DHT_BOOTSTRAP||'router.bittorrent.com:6881,dht.transmissionbt.com:6881,dht.libtorrent.org:25401'),
    mainlineLookupMs:int(process.env.MAINLINE_LOOKUP_MS,120000),
    mainlineQueryTimeoutMs:int(process.env.MAINLINE_QUERY_TIMEOUT_MS,2500),
    mainlineRounds:int(process.env.MAINLINE_ROUNDS,4),
    mainlineAlpha:int(process.env.MAINLINE_ALPHA,6),
    mainlineAnnounceNodes:int(process.env.MAINLINE_ANNOUNCE_NODES,12),
    mainlineMaxCandidates:int(process.env.MAINLINE_MAX_CANDIDATES,32),
    mainlineDialLimit:int(process.env.MAINLINE_DIAL_LIMIT,12),
    mainlineAllowPrivateCandidates:bool(process.env.MAINLINE_ALLOW_PRIVATE_CANDIDATES,false),
    autoReachability:bool(process.env.AUTO_REACHABILITY,true),
    bootstrapPeers:list(process.env.BOOTSTRAP_PEERS),
    relayPeers:list(process.env.RELAY_PEERS),
    relayEnabled:bool(process.env.RELAY_ENABLED,true),
    relayPollMs:int(process.env.RELAY_POLL_MS,750),
    capabilities:list(process.env.CAPABILITIES||'general,reasoning,critic,validator'),
    maxRemoteWorkers:int(process.env.MAX_REMOTE_WORKERS,3),

    trainingEnabled:bool(process.env.TRAINING_ENABLED,true),
    trainingAuto:bool(process.env.TRAINING_AUTO,securityMode!=='mainnet'),
    trainingMode:(process.env.TRAINING_MODE||'auto').toLowerCase(),
    trainingPython:process.env.TRAINING_PYTHON||'python3',
    trainingMinArtifacts:int(process.env.TRAINING_MIN_ARTIFACTS,12),
    trainingMaxArtifacts:int(process.env.TRAINING_MAX_ARTIFACTS,128),
    trainingMinQuality:num(process.env.TRAINING_MIN_QUALITY,0.80),
    trainingIntervalMs:int(process.env.TRAINING_INTERVAL_MS,6*60*60_000),
    trainingTimeoutMs:int(process.env.TRAINING_TIMEOUT_MS,45*60_000),
    trainingAdapterDir:path.resolve(process.env.TRAINING_ADAPTER_DIR||path.join(dataDir,'adapters')),
    trainingBaseModel:process.env.TRAINING_BASE_MODEL||'Qwen/Qwen3-1.7B',
    trainingOllamaBaseModel:process.env.TRAINING_OLLAMA_BASE_MODEL||process.env.LLM_MODEL||'qwen3:1.7b',
    trainingEpochs:num(process.env.TRAINING_EPOCHS,1),
    trainingBatchSize:int(process.env.TRAINING_BATCH_SIZE,1),
    trainingLearningRate:num(process.env.TRAINING_LEARNING_RATE,2e-4),
    trainingLoraRank:int(process.env.TRAINING_LORA_RANK,8),
    trainingLoraAlpha:int(process.env.TRAINING_LORA_ALPHA,16),
    trainingShareAdapters:bool(process.env.TRAINING_SHARE_ADAPTERS,true),
    trainingImportAdapters:bool(process.env.TRAINING_IMPORT_ADAPTERS,true),
    trainingMaxAdapterBytes:int(process.env.TRAINING_MAX_ADAPTER_BYTES,256*1024*1024),
    trainingBenchmarkMinScore:num(process.env.TRAINING_BENCHMARK_MIN_SCORE,0.70),

    contentStoreEnabled:bool(process.env.CONTENT_STORE_ENABLED,true),
    contentStoreDir:path.resolve(process.env.CONTENT_STORE_DIR||path.join(dataDir,'content')),
    contentChunkBytes:int(process.env.CONTENT_CHUNK_BYTES,256*1024),
    contentMaxObjectBytes:int(process.env.CONTENT_MAX_OBJECT_BYTES,512*1024*1024),
    contentReplicationFactor:int(process.env.CONTENT_REPLICATION_FACTOR,3),
    contentReplicationIntervalMs:int(process.env.CONTENT_REPLICATION_INTERVAL_MS,120000),
    contentProviderTtlMs:int(process.env.CONTENT_PROVIDER_TTL_MS,24*60*60_000),
    p2pMaxInflight:int(process.env.P2P_MAX_INFLIGHT,8),
    p2pPeerMaxInflight:int(process.env.P2P_PEER_MAX_INFLIGHT,2),
    p2pBackpressureTimeoutMs:int(process.env.P2P_BACKPRESSURE_TIMEOUT_MS,15000),

    evolutionEnabled:bool(process.env.EVOLUTION_ENABLED,true),
    evolutionAuto:bool(process.env.EVOLUTION_AUTO,securityMode!=='mainnet'),
    evolutionLlmProposals:bool(process.env.EVOLUTION_LLM_PROPOSALS,true),
    evolutionAcceptRemote:bool(process.env.EVOLUTION_ACCEPT_REMOTE,true),
    evolutionCanaryShare:num(process.env.EVOLUTION_CANARY_SHARE,0.20),
    evolutionMinCanarySamples:int(process.env.EVOLUTION_MIN_CANARY_SAMPLES,8),
    evolutionMaxCanarySamples:int(process.env.EVOLUTION_MAX_CANARY_SAMPLES,40),
    evolutionPromotionMargin:num(process.env.EVOLUTION_PROMOTION_MARGIN,0.02),
    evolutionMaxErrorRate:num(process.env.EVOLUTION_MAX_ERROR_RATE,0.20),
    evolutionMinBenchmarkScore:num(process.env.EVOLUTION_MIN_BENCHMARK_SCORE,0.75),
    evolutionAutoTaskInterval:int(process.env.EVOLUTION_AUTO_TASK_INTERVAL,20),
    evolutionMinProposalIntervalMs:int(process.env.EVOLUTION_MIN_PROPOSAL_INTERVAL_MS,30*60_000),
    evolutionTickMs:int(process.env.EVOLUTION_TICK_MS,60_000),
    evolutionIdleMs:int(process.env.EVOLUTION_IDLE_MS,120_000),
    evolutionModelPool:list(process.env.EVOLUTION_MODEL_POOL||process.env.LLM_MODEL||'qwen3:4b'),

    collectiveEvolutionEnabled:bool(process.env.COLLECTIVE_EVOLUTION_ENABLED,true),
    collectiveEvolutionAuto:bool(process.env.COLLECTIVE_EVOLUTION_AUTO,securityMode!=='mainnet'),
    collectiveEvolutionTickMs:int(process.env.COLLECTIVE_EVOLUTION_TICK_MS,30_000),
    collectiveEvolutionEpochMs:int(process.env.COLLECTIVE_EVOLUTION_EPOCH_MS,30*60_000),
    collectiveEvolutionVotingMs:int(process.env.COLLECTIVE_EVOLUTION_VOTING_MS,5*60_000),
    collectiveEvolutionMinVoters:int(process.env.COLLECTIVE_EVOLUTION_MIN_VOTERS,securityMode==='mainnet'?4:2),
    collectiveEvolutionMaxCandidates:int(process.env.COLLECTIVE_EVOLUTION_MAX_CANDIDATES,8),
    collectiveEvolutionMaxPerAuthor:int(process.env.COLLECTIVE_EVOLUTION_MAX_PER_AUTHOR,2),
    collectiveEvolutionMaxVoteWeight:num(process.env.COLLECTIVE_EVOLUTION_MAX_VOTE_WEIGHT,3),
    collectiveEvolutionAllowUnstaked:bool(process.env.COLLECTIVE_EVOLUTION_ALLOW_UNSTAKED,securityMode!=='mainnet'),
    collectiveEvolutionSpeciesDistance:num(process.env.COLLECTIVE_EVOLUTION_SPECIES_DISTANCE,0.18),

    knowledgeTransferEnabled:bool(process.env.KNOWLEDGE_TRANSFER_ENABLED,true),
    knowledgeAutoShare:bool(process.env.KNOWLEDGE_AUTO_SHARE,true),
    knowledgeMinQuality:num(process.env.KNOWLEDGE_MIN_QUALITY,0.72),
    knowledgeMaxContext:int(process.env.KNOWLEDGE_MAX_CONTEXT,4),
    knowledgeMaxArtifacts:int(process.env.KNOWLEDGE_MAX_ARTIFACTS,5000),
    federatedLearningEnabled:bool(process.env.FEDERATED_LEARNING_ENABLED,true),
    federatedRoundMs:int(process.env.FEDERATED_ROUND_MS,10*60_000),
    federatedMinParticipants:int(process.env.FEDERATED_MIN_PARTICIPANTS,securityMode==='mainnet'?4:2),
    federatedMaxWeight:num(process.env.FEDERATED_MAX_WEIGHT,3),
    evolutionBftAnchorEnabled:bool(process.env.EVOLUTION_BFT_ANCHOR_ENABLED,true),

    discoveryEnabled:bool(process.env.DISCOVERY_ENABLED,true),
    discoveryGroup:process.env.DISCOVERY_GROUP||'239.255.86.86',
    discoveryPort:int(process.env.DISCOVERY_PORT,48685),
    dhtK:int(process.env.DHT_K,20),
    dhtAlpha:int(process.env.DHT_ALPHA,3),
    dhtRefreshMs:int(process.env.DHT_REFRESH_MS,15000),

    securityMode,
    nodeKeyPassword,walletPassword,autoLocalSecret,
    keystoreSecretSource:generatedSecret?'auto-local':(walletPassword?'environment':'none'),
    explicitWalletPassword,explicitNodeKeyPassword,
    allowInsecureKeystore:bool(process.env.ALLOW_INSECURE_KEYSTORE,!walletPassword&&securityMode!=='mainnet'),
    admissionPowBits:int(process.env.ADMISSION_POW_BITS,securityMode==='mainnet'?20:10),
    workPowBits:int(process.env.WORK_POW_BITS,securityMode==='mainnet'?18:8),
    envelopeMaxSkewMs:int(process.env.ENVELOPE_MAX_SKEW_MS,5*60_000),
    replayWindowMs:int(process.env.REPLAY_WINDOW_MS,10*60_000),
    rateLimitWindowMs:int(process.env.RATE_LIMIT_WINDOW_MS,60_000),
    rateLimitApi:int(process.env.RATE_LIMIT_API,120),
    rateLimitP2p:int(process.env.RATE_LIMIT_P2P,600),
    maxBodyBytes:int(process.env.MAX_BODY_BYTES,2_000_000),
    apiToken:process.env.API_TOKEN||'',
    apiCorsOrigin:process.env.API_CORS_ORIGIN||'',
    allowUnauthenticatedLocal:bool(process.env.ALLOW_UNAUTHENTICATED_LOCAL,true),

    validatorEnabled:bool(process.env.VALIDATOR_ENABLED,true),
    validatorCount:int(process.env.VALIDATOR_COUNT,4),
    validatorQuorum:int(process.env.VALIDATOR_QUORUM,3),
    allowSingleValidator:bool(process.env.ALLOW_SINGLE_VALIDATOR,false),
    bootstrapValidatorIds:list(process.env.BOOTSTRAP_VALIDATOR_IDS),
    autoBootstrapValidators:bool(process.env.AUTO_BOOTSTRAP_VALIDATORS,false),
    bootstrapValidatorUntilHeight:int(process.env.BOOTSTRAP_VALIDATOR_UNTIL_HEIGHT,1000),
    minValidatorStakeNRN:process.env.MIN_VALIDATOR_STAKE_NRN||'0.00100000',
    slashFraction:num(process.env.SLASH_FRACTION,0.10),
    slashJailBlocks:int(process.env.SLASH_JAIL_BLOCKS,100),
    validatorEpochBlocks:int(process.env.VALIDATOR_EPOCH_BLOCKS,100),
    unbondDelayBlocks:int(process.env.UNBOND_DELAY_BLOCKS,securityMode==='mainnet'?1000:10),
    bftMaxRounds:int(process.env.BFT_MAX_ROUNDS,4),
    bftRoundTimeoutMs:int(process.env.BFT_ROUND_TIMEOUT_MS,8000),
    snapshotIntervalBlocks:int(process.env.SNAPSHOT_INTERVAL_BLOCKS,securityMode==='mainnet'?1000:25),

    rewardPerScore:num(process.env.REWARD_PER_SCORE,0.01),
    rewardWorkerShare:num(process.env.REWARD_WORKER_SHARE,0.80),
    rewardValidatorShare:num(process.env.REWARD_VALIDATOR_SHARE,0.15),
    rewardRouterShare:num(process.env.REWARD_ROUTER_SHARE,0.05),
    rewardAddress:(process.env.REWARD_ADDRESS||'').trim(),
    txFeeNRN:process.env.TX_FEE_NRN||'0.00000100',
    maxBlockTx:int(process.env.MAX_BLOCK_TX,100),

    llmProvider:bool(process.env.MOCK_LLM,false)?'mock':(process.env.LLM_PROVIDER||'ollama'),
    llmBaseUrl:(process.env.LLM_BASE_URL||'http://127.0.0.1:11434').replace(/\/$/,''),
    llmModel:process.env.LLM_MODEL||'qwen3:4b',
    autoModel:bool(process.env.AUTO_MODEL,true),
    modelProfile:process.env.MODEL_PROFILE||'balanced',
    autoInstallOllama:bool(process.env.AUTO_INSTALL_OLLAMA,securityMode!=='mainnet'),
    autoPullModel:bool(process.env.AUTO_PULL_MODEL,true),
    modelSmokeTest:bool(process.env.MODEL_SMOKE_TEST,true),
    hardwareProfile:process.env.HARDWARE_PROFILE||'',
    detectedRamMiB:int(process.env.DETECTED_RAM_MIB,0),
    detectedCpuCores:int(process.env.DETECTED_CPU_CORES,0),
    detectedGpuCount:int(process.env.DETECTED_GPU_COUNT,0),
    detectedGpuVramMiB:int(process.env.DETECTED_GPU_VRAM_MIB,0),
    modelSelectionReason:process.env.MODEL_SELECTION_REASON||'',
    llmApiKey:process.env.LLM_API_KEY||'',
    llmTimeoutMs:int(process.env.LLM_TIMEOUT_MS,120000),
    llmThink:bool(process.env.LLM_THINK,false),
    llmNumCtx:int(process.env.LLM_NUM_CTX,2048),
    llmNumThread:int(process.env.LLM_NUM_THREAD,Math.max(1,Math.min(8,int(process.env.DETECTED_CPU_CORES,os.cpus().length||1)))),
    chatFastPath:bool(process.env.CHAT_FAST_PATH,true),
    chatWaitRewards:bool(process.env.CHAT_WAIT_REWARDS,false),
    p2pTimeoutMs:int(process.env.P2P_TIMEOUT_MS,20000),
  };
}
