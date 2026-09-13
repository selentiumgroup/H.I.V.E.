# Neural Mesh v0.12 — Mainnet Consensus Core

v0.12 hardens the canonical NRN chain without changing the existing genesis hash. Existing `data/` directories remain upgradeable.

## New consensus rules

- **Validator epochs** — the validator set for a block is derived from stake at the start of its epoch (`VALIDATOR_EPOCH_BLOCKS`). Mid-epoch stake changes do not instantly rewrite the committee.
- **Multi-round BFT rotation** — blocks can advance through rounds `0..BFT_MAX_ROUNDS-1`; committee seed and deterministic leader change with the round. The runtime retries a later round when quorum is unavailable.
- **Delayed unbonding** — an unbond removes stake from the validator immediately but the NRN remains locked for `UNBOND_DELAY_BLOCKS` finalized blocks before returning to spendable balance.
- **State roots** — every v0.12 block commits to balances, nonces, validator bonds and pending unbonds with a deterministic SHA-256 `stateRoot`.
- **Signed checkpoints** — every `SNAPSHOT_INTERVAL_BLOCKS`, a node creates a signed checkpoint under `data/snapshots/` containing height, block hash, state root, supply and validator epoch.
- **Upgrade-safe genesis** — v0.12 deliberately preserves the previous genesis block/hash; only post-upgrade blocks use block version 5.

### Consensus API

```text
GET  /api/consensus/checkpoints
POST /api/consensus/snapshot   # admin auth
```

`GET /api/status` now exposes `ledger.stateRoot`, `ledger.epoch`, `ledger.round`, `ledger.leader`, latest checkpoint, validator epoch size, delayed-unbond queue and BFT round settings.

### Defaults

```env
VALIDATOR_EPOCH_BLOCKS=100
UNBOND_DELAY_BLOCKS=10
BFT_MAX_ROUNDS=4
BFT_ROUND_TIMEOUT_MS=8000
SNAPSHOT_INTERVAL_BLOCKS=25
```

Mainnet should use a materially longer unbond delay (the code defaults to 1000 blocks when `SECURITY_MODE=mainnet`).

### Verification

```bash
npm run consensus-test
npm run smoke
```

The dedicated test verifies state-root commitment, epoch metadata, automatic checkpoints and that unbonded NRN stays locked until the configured release height.

> Current boundary: v0.12 creates and verifies signed checkpoints, but does **not** yet perform trustless state import from a checkpoint. Nodes still replay canonical blocks to rebuild local state. This remains a mainnet-hardening item rather than being presented as solved.

---

> **v0.11.2 hotfix:** benign duplicate hello/DHT discovery packets are idempotent instead of producing `invalid/replayed` stack traces. Invalid signatures and malformed packets remain rejected.

# Neural Mesh v0.11.2 — Neural Training Engine

## v0.11 — Content-Addressed Model Network

v0.11 makes trained skills durable across node failure. LoRA/model artifacts are stored in a local content-addressed store (CAS) by SHA-256 and replicated peer-to-peer. The author node is not required after replication.

Core properties:

- `sha256:<content>` identity for adapter/model artifacts
- automatic replica offers with a configurable target replication factor
- chunked P2P transfer with end-to-end SHA-256 verification
- provider records so a node can fetch a skill from any known replica
- private/relay nodes can serve and receive content
- peer quality scoring based on trust, latency and failures
- global/per-peer backpressure to stop large transfers from starving chat/consensus
- Explorer metrics for CAS objects and replica/provider records

Default target: `CONTENT_REPLICATION_FACTOR=3`.

### Content API

```text
GET  /api/content
POST /api/content/fetch
POST /p2p/content/info
POST /p2p/content/chunk
POST /p2p/content/offer
```

A training manifest now contains `contentHash`. New nodes should fetch the object by hash rather than relying on the original trainer URL.


Neural Mesh is a zero-touch decentralized AI network in which each server is a neuron. v0.11 adds parameter-level mutual learning: nodes can train LoRA adapters locally, exchange only signed adapter artifacts, independently verify them, approve them through federated adapter votes, and optionally activate verified adapters in Ollama.

## One-command inference node

```bash
npm start
```

The existing v0.9 behavior remains: hardware detection, Ollama provisioning/model selection, zero-touch peer discovery, distributed inference, NRN rewards, wallet, validators, BFT finality, Evolution/Collective Evolution, federated knowledge and Explorer.

Open:

```text
http://SERVER_IP:48686
```

## v0.11 learning pipeline

```text
Knowledge Artifacts (local only)
        ↓
quality filter
        ↓
local JSONL dataset
        ↓
Python PEFT trainer
        ↓
LoRA adapter
        ↓
SHA-256 + signed manifest
        ↓
P2P chunked transfer
        ↓
independent peer verification
        ↓
federated adapter votes
        ↓
approved adapter
        ↓
optional Ollama activation + inference health check
```

Raw training datasets are never sent to other neurons. Node private keys, NRN wallet keys and API tokens are never passed to the trainer process.

## Install real PEFT training support

Training is optional. A node without the Python ML stack remains a fully functional inference/validator/relay neuron.

Recommended:

```bash
python3 -m venv .trainer-venv
.trainer-venv/bin/pip install -r trainer/requirements.txt
```

Then start with:

```bash
TRAINING_PYTHON=.trainer-venv/bin/python npm start
```

Check trainer readiness:

```bash
.trainer-venv/bin/python trainer/trainer.py --check
```

A successful GPU setup returns roughly:

```json
{"ready":true,"torch":true,"transformers":true,"peft":true,"cuda":true}
```

`TRAINING_MODE=auto` performs real PEFT training only when dependencies are present. It does **not** silently fake training. `TRAINING_MODE=mock` is intended only for tests/development.

## Start a training run

A minimum number of high-quality Knowledge Artifacts must already exist (default: 12).

```bash
curl -X POST http://127.0.0.1:48686/api/training/run \
  -H 'Content-Type: application/json' \
  -d '{}'
```

For remote admin add:

```text
Authorization: Bearer <API_TOKEN>
```

Status:

```bash
curl http://127.0.0.1:48686/api/training
```

## Adapter exchange

A remote adapter is not trusted because its author says it is good.

1. The author signs a manifest committing to base model, dataset hash, metrics, size and bundle SHA-256.
2. Peers receive only the manifest first.
3. The adapter bundle is downloaded in ~256 KiB chunks (works through relay and avoids huge JSON bodies).
4. The reconstructed bundle must match the signed SHA-256.
5. The receiving node performs a local structural/benchmark gate.
6. Nodes can sign adapter votes.
7. Only adapters meeting the configured federated threshold become `federated-approved`.
8. Activation is explicit and followed by a real LLM inference health check.

## API

```text
GET  /api/training
POST /api/training/run
POST /api/training/fetch
POST /api/training/vote
POST /api/training/activate
```

P2P:

```text
POST /p2p/training/adapter/manifest
POST /p2p/training/adapter/info
POST /p2p/training/adapter/chunk
POST /p2p/training/adapter/vote
```

## Configuration

```env
TRAINING_ENABLED=true
TRAINING_AUTO=false
TRAINING_MODE=auto
TRAINING_PYTHON=.trainer-venv/bin/python
TRAINING_MIN_ARTIFACTS=12
TRAINING_MAX_ARTIFACTS=128
TRAINING_MIN_QUALITY=0.80
TRAINING_BASE_MODEL=Qwen/Qwen3-1.7B
TRAINING_OLLAMA_BASE_MODEL=qwen3:1.7b
TRAINING_EPOCHS=1
TRAINING_BATCH_SIZE=1
TRAINING_LEARNING_RATE=0.0002
TRAINING_LORA_RANK=8
TRAINING_LORA_ALPHA=16
TRAINING_SHARE_ADAPTERS=true
TRAINING_IMPORT_ADAPTERS=true
TRAINING_MAX_ADAPTER_BYTES=268435456
TRAINING_BENCHMARK_MIN_SCORE=0.70
```

`TRAINING_AUTO` defaults off because real fine-tuning is materially heavier than inference. Enable it only on nodes intended to train.

## CPU/GPU behavior

- CPU-only nodes can run Neural Mesh normally and participate in knowledge/adaptor verification.
- Real PEFT training on CPU is supported by the trainer stack but can be very slow; keep `TRAINING_AUTO=false` unless intended.
- GPU nodes use the PyTorch/CUDA installation available in the trainer environment.
- Inference model selection remains independent of the training base model.

## Tests

Training layer:

```bash
npm run training-test
```

Core regression:

```bash
npm run explorer-test
npm run learning-bft-test
npm run smoke
```

The training test uses `TRAINING_MODE=mock` to exercise adapter creation, signing, transfer verification and federated votes without requiring a multi-gigabyte ML environment.

## Security boundary

The evolvable/training layer cannot directly mutate:

- NodeID/private key
- NRN wallet/private key
- ledger rules
- validator quorum/finality
- NRN max supply
- slashing rules
- admin authorization

Adapters are model artifacts, not executable Node.js plugins.

## Current limitation

v0.11 performs real local LoRA/PEFT training when the optional Python stack is installed, but it does not yet mathematically aggregate arbitrary LoRA tensors from different base checkpoints. Federated approval selects and distributes compatible adapters; tensor-level FedAvg requires strict base-model/version/shape compatibility and is a future hardening step.


## v0.11.2 foreign-network isolation

Packets from other `NETWORK_ID` values are silently classified as foreign and ignored. On startup, cached peers belonging to another network are purged automatically, which is especially useful when preserving `data/` across testnet upgrades.
