# Neural Mesh v0.7.4 — CPU Performance & Fast Chat

- Conservative CPU model selection: ~16–24 GB RAM now defaults to `qwen3:1.7b`; `qwen3:4b` requires >=24 GB in balanced mode.
- Simple greetings and acknowledgements use a one-neuron local fast path instead of distributed fan-out + synthesis.
- Chat no longer waits for NRN reward/finality by default; reward consensus continues independently after the answer is ready. Set `CHAT_WAIT_REWARDS=true` for synchronous/test behavior.
- Ollama CPU load is capped by default with `LLM_NUM_THREAD` (up to 8) and `LLM_NUM_CTX=2048`.
- UI shows elapsed thinking time and aborts visibly after 120 seconds instead of hanging forever.
- New knobs: `CHAT_FAST_PATH`, `CHAT_WAIT_REWARDS`, `LLM_NUM_THREAD`, `LLM_NUM_CTX`.
