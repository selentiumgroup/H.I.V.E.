# Neural Mesh v0.6 — Evolution Engine

## Added

- immutable Evolution Constitution and constitution hash;
- bounded JSON genome format;
- routing-policy evolution;
- capability-keyword evolution;
- expert/critic/synthesis prompt-suffix evolution;
- allowlisted model competition through `EVOLUTION_MODEL_POOL`;
- deterministic sandbox benchmark;
- deterministic task-ID canary split;
- telemetry and fitness scoring;
- optional human feedback;
- automatic promote/reject/rollback;
- idle digital-sleep proposal cycle;
- LLM-generated policy proposals with deterministic fallback;
- signed P2P genome propagation with end-to-end author proof across relays;
- local re-benchmark of remote candidates;
- worker-side learning from remote distributed tasks;
- Evolution dashboard and API.

## Preserved

- v0.5 zero-touch Mainline-DHT rendezvous;
- internal Neural DHT/gossip and relay fallback;
- CPU/GPU inference;
- encrypted NRN wallet and NodeID;
- native NRN transfer/mempool;
- validator stake/finality/slashing;
- 86B NRN hard cap and zero premine.

## Safety boundary

Evolution does not execute arbitrary generated code and cannot mutate the security kernel, wallet, ledger, validator rules, consensus, reward cap or keystore. Mainnet automatic evolution is disabled by default.

## Verification

The release includes:

```text
npm run evolution-test
npm run evolution-network-test
npm run smoke
npm run zero-touch-test
npm run verify
```
