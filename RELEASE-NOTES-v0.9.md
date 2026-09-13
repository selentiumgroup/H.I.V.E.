# Neural Mesh v0.9 — Live Network Explorer & Observability

## Added

- decentralized signed telemetry snapshots;
- `/api/explorer` network aggregate and `/api/explorer/local` local snapshot;
- `/p2p/telemetry` signed P2P endpoint;
- telemetry transport through private relay nodes;
- live CPU/GPU/RAM/VRAM aggregation;
- model distribution and LLM health;
- tasks/min plus average/p50/p95 latency;
- validator, NRN ledger, federated-learning and collective-evolution counters;
- BFT evolution-anchor visibility;
- interactive in-browser peer graph and live neuron table;
- 5-second Explorer cache plus in-flight request deduplication to prevent the dashboard from becoming a polling amplifier.

## Security / privacy

Telemetry is signed end-to-end by the reporting NodeID. Explorer never trusts the relay as the telemetry author. Snapshots do not expose seed phrases, private keys, API tokens, prompts, raw knowledge artifacts or wallet secrets. Explorer data is read-only and non-consensus-critical.

## Validation

`npm run explorer-test` launches three processes including a private relay-only neuron and verifies that all three signed snapshots appear in the Explorer graph. Existing federated/BFT and NRN security regression tests remain green.
