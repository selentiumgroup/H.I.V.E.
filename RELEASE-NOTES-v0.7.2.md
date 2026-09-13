# Neural Mesh v0.7.2 — Self-Provisioning `index.js`

`node src/index.js` is now a complete first-launch path for the local LLM runtime.

## What changed

Before constructing the node, `index.js` now:

1. detects CPU cores and RAM;
2. detects NVIDIA GPUs and total VRAM when available;
3. chooses a Qwen3 tier automatically;
4. checks whether Ollama is reachable;
5. on Linux/macOS local-runtime deployments, can install Ollama automatically when missing;
6. starts a local Ollama service when necessary;
7. checks whether the selected model is installed;
8. pulls the model automatically through the Ollama API;
9. runs a real inference smoke test;
10. falls back through smaller models until one actually runs;
11. only then boots the Neural Mesh node.

The selected runtime is recorded in `.runtime.json` without wallet or private-key material.

## Model tiers

Default `balanced` selection uses `qwen3:0.6b`, `1.7b`, `4b`, `8b`, `14b`, or `30b` depending on detected resources. `MODEL_PROFILE=fast` moves down one tier; `MODEL_PROFILE=quality` moves up one tier, then the smoke/fallback mechanism decides whether it really fits.

## Security

Automatic Ollama installation defaults on in testnet and off in `SECURITY_MODE=mainnet`, where runtime provisioning should be pinned and audited. Auto-pull of an already configured Ollama model remains separately controlled by `AUTO_PULL_MODEL`.
