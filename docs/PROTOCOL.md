# Neural Mesh Protocol v0.10

v0.10 retains the v0.9 P2P, NRN, BFT evolution, knowledge and telemetry protocols and adds model-adapter transfer.

## Adapter Manifest

The author signs an envelope containing `adapterId` and a deterministic manifest. The manifest commits to network ID, author NodeID, exact training base model, Ollama base model, dataset hash (not dataset contents), artifact count, bundle byte length, bundle SHA-256, training metrics and creation time.

`adapterId = SHA256(canonical(manifest-core))`.

## Chunk transfer

Large adapters are never embedded into gossip. A receiver requests `adapter/info`, then `adapter/chunk` sequentially. Default chunk size is 256 KiB. Direct peers use P2P HTTP; relay-only peers use the existing signed learning relay channel. After reassembly the receiver verifies length and SHA-256 against the signed manifest.

## Adapter votes

A peer can sign an `adapter-vote` containing round ID, NodeID, adapter ID and local score. Votes are identity-bound and replay-protected. A local adapter consensus view requires `FEDERATED_MIN_PARTICIPANTS` and a mean score >= `TRAINING_BENCHMARK_MIN_SCORE`.

## Activation

Activation is local, never forced by a remote peer. For Ollama, Neural Mesh unpacks the adapter, creates a derived model with a Modelfile `FROM` + `ADAPTER`, then performs a real inference health check. Failure restores the previous model.

## Data privacy

Raw Knowledge Artifact datasets used for fine-tuning are not exposed by the training P2P protocol. Peers see only signed manifests and adapter bytes.


## v0.11 Content-Addressed Model Network

Every binary skill object is addressed by `SHA-256(content)`. The signed adapter manifest carries `contentHash`, `bundleBytes`, model/domain metadata and author proof.

Object discovery/transfer:

1. A provider emits a signed `content-offer`.
2. Peers record `(contentHash,nodeId,lastSeen,score)`.
3. A consumer asks `/p2p/content/info` for size/chunk count.
4. It downloads chunks via `/p2p/content/chunk`.
5. The complete object is accepted only if SHA-256 equals `contentHash`.
6. The consumer becomes another provider and may re-announce the object.

Replication is eventually consistent and non-consensus-critical.

Flow control uses global and per-peer in-flight limits. Peer selection prefers higher trust, lower latency and fewer failures.

# v0.12 Consensus Extension

Post-upgrade blocks use `version: 5` and additionally commit to:

- `epoch`
- `round`
- deterministic `leader`
- `stateRoot`

`stateRoot` is SHA-256 over canonical balances, account nonces, validator bonds and pending delayed unbonds after applying the proposed block.

Validator eligibility is evaluated against the chain state immediately before the start of the block's validator epoch. Block committee selection includes `(epoch,height,round,prevHash)` in its deterministic seed, so a later BFT round rotates the selection deterministically.

Unbond transactions remove validator stake at inclusion height. The principal becomes a pending unbond and is released to the wallet only at `inclusionHeight + UNBOND_DELAY_BLOCKS`. The transaction fee is paid from liquid balance at inclusion.

Signed checkpoints contain `(networkId,height,blockHash,stateRoot,totalSupplyAtomic,validatorEpoch)` and are signed by the local NodeID. They are observability/recovery commitments; v0.12 does not treat an arbitrary single-node checkpoint as sufficient authority to skip canonical block verification.
