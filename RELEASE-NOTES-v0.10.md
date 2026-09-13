# Neural Mesh v0.10 — Neural Training Engine

v0.10 adds parameter-level learning without moving raw user data between nodes.

## New

- Python/PyTorch/Transformers/PEFT trainer sidecar.
- Local LoRA training from high-quality signed Knowledge Artifacts.
- No raw training dataset leaves the node.
- Signed adapter manifests with base-model, dataset hash, metrics, byte size and SHA-256.
- Adapter bundles can be fetched peer-to-peer (direct or relay), hash-verified and stored locally.
- Independent peer benchmark before an imported adapter becomes verified.
- Federated adapter voting/approval rounds.
- Optional Ollama activation using an `ADAPTER` Modelfile, followed by a real inference health check.
- Trainer is optional: inference-only CPU nodes keep working when PEFT dependencies are absent.
- `TRAINING_MODE=auto` refuses to fake real training if Transformers/PEFT are unavailable.
- `TRAINING_MODE=mock` exists only for tests/development.
- Training history and adapter registry persist in SQLite.

## Security model

The trainer does not receive wallet keys, node private keys, API tokens or ledger write access. Adapter manifests are signed by the NodeID key only after training completes. Imported bundles must match the signed SHA-256 and size commitment before they can be benchmarked or activated.

## API

- `GET /api/training`
- `POST /api/training/run`
- `POST /api/training/fetch`
- `POST /api/training/vote`
- `POST /api/training/activate`

## Install real trainer

```bash
python3 -m venv .trainer-venv
.trainer-venv/bin/pip install -r trainer/requirements.txt
TRAINING_PYTHON=.trainer-venv/bin/python npm start
```

GPU/CUDA support depends on the PyTorch wheel installed for the host.
