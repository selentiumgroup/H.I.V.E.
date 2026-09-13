# Neural Mesh v0.7.3 — Ollama Thinking Fix

- Fixes false `model returned no content` failures with Qwen3.
- Runtime smoke test now sends top-level `think:false` to Ollama `/api/chat`.
- Smoke output budget increased from 8 to 32 tokens.
- Normal Ollama inference defaults to `LLM_THINK=false` for reliable final-content responses.
- If `LLM_THINK=true` and Ollama returns thinking without final content, Neural Mesh retries once with thinking disabled.
- Reasoning traces are never substituted for final answer content.
- Improved diagnostics include `done_reason`, `eval_count`, and whether a thinking-only response was observed.
