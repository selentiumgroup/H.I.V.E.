# Neural Mesh v0.8

## Federated Learning + BFT-Anchored Collective Intelligence

- Signed Knowledge Artifacts propagate verified final-answer knowledge between neural nodes.
- Shared artifacts are used as retrieval context on later tasks; no raw private dataset or hidden chain-of-thought is exported.
- Signed federated cognitive-policy updates are aggregated by deterministic time rounds.
- Federated aggregate can produce a normal Evolution candidate, still constrained by Constitution/sandbox/canary rules.
- Collective tournament results now produce Evolution Anchor proposals.
- Evolution Anchor validator committee is selected deterministically from the NRN ledger state.
- >= ledger quorum signatures produce a BFT certificate.
- Certified anchors are included in finalized NRN blocks and persisted as canonical evolution history.
- Remote validators independently recompute tournament tally/ballot commitments before signing.
- Private relay nodes can receive knowledge artifacts, federated updates and evolution-anchor validation requests.
- Existing CPU fast-chat, zero-touch discovery, wallet, NRN rewards, stake/slashing and finality remain intact.

### Scope note
v0.8 federates Neural Mesh cognitive-policy parameters and distilled knowledge. It does not silently fine-tune or overwrite the underlying Qwen/Ollama model weights. A future adapter trainer can publish LoRA adapter manifests through the same signed artifact layer without changing the trust model.
