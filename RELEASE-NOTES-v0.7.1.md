# Neural Mesh v0.7.1 — Hardware-Aware Bootstrap

v0.7.1 is an operational release focused on the "run the server and it works" experience.

## Automatic model selection

`./start.sh` now detects:

- CPU core count;
- total system RAM;
- NVIDIA GPU count;
- total NVIDIA VRAM.

The default `balanced` policy selects one of:

- `qwen3:0.6b`
- `qwen3:1.7b`
- `qwen3:4b`
- `qwen3:8b`
- `qwen3:14b`
- `qwen3:30b`

`MODEL_PROFILE=fast` chooses one tier smaller where possible. `MODEL_PROFILE=quality` chooses one tier larger and still performs a load/inference smoke test.

## Automatic provisioning

On the canonical Linux path the launcher:

1. detects hardware;
2. uses Docker if available;
3. optionally installs Docker when no runtime exists;
4. if an NVIDIA driver exists but Docker GPU access is missing, optionally installs/configures NVIDIA Container Toolkit;
5. starts Ollama;
6. pulls the selected model if it is missing;
7. runs a real smoke inference;
8. falls back to smaller models on failure;
9. starts the Neural Mesh node only after the LLM is usable.

Native Node.js mode can automatically install/start Ollama on Linux as well.

## Better health reporting

`/api/status` now reports the auto-selection profile and `LLM.health()` verifies that the configured model exists in Ollama. This prevents the old state where Ollama itself was online but requests failed later with `404 model not found`.

## Runtime record

The launcher writes `.runtime.env` containing the selected model and detected hardware profile. It contains no wallet/private-key material.
