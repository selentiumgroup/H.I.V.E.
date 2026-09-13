# v0.10 Mainnet gaps

Before treating remote model adapters as production-grade shared intelligence, the project still needs:

- reproducible trainer containers and pinned CUDA/PyTorch/Transformers/PEFT hashes;
- stronger semantic benchmark suites resistant to benchmark gaming;
- malware/model-artifact scanning and safetensors-only policy for real adapters;
- strict base checkpoint digest commitments, not just model names;
- tensor-shape compatibility checks and deterministic FedAvg/FedProx for compatible adapters;
- differential privacy / clipping / secure aggregation for gradient-style updates;
- BFT anchoring of globally approved adapter generations;
- artifact availability replication and content-addressed storage;
- bandwidth accounting and NRN rewards for training/serving adapter artifacts;
- external security audit.


## Remaining after v0.11

- Replace/harden the current HTTP/relay overlay with a fully audited multiplexed transport (Noise + QUIC/TCP/libp2p-class implementation).
- Add erasure coding and large model-shard manifests for multi-GB base model distribution.
- Add disk quotas, garbage collection/pinning policy and economic storage incentives.
- External security audit of CAS/provider poisoning resistance and relay flow control.
- Stateful resumable downloads and bandwidth accounting for public mainnet economics.

## v0.12 remaining consensus work

- Full proposer/leader handoff protocol: v0.12 rotates round committee/leader metadata and retries rounds, but the origin node can still assemble the block proposal. A production BFT implementation should require the elected proposer and implement prevote/precommit/view-change messages explicitly.
- Trustless fast-sync from multi-validator checkpoint certificates / state snapshots.
- Epoch transition certificates and deterministic validator-set roots embedded in block headers.
- Longer production unbond periods measured in time/epochs, plus withdrawal cancellation semantics.
- State pruning with proof generation (Merkle/Verkle-class authenticated state rather than flat canonical SHA-256 serialization).
- External consensus/security audit and adversarial partition testing.
