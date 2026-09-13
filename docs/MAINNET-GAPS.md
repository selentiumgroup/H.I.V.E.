# Neural Mesh v0.13 — Remaining Mainnet Gaps

v0.13 substantially strengthens finality but is still an adversarial-testnet release.

Remaining work before a public-value mainnet:

1. **Lock/POL semantics** — full Tendermint/HotStuff-equivalent rules for locked values, valid-round proofs and safe unlocking across arbitrary asynchronous competing rounds.
2. **Formal safety/liveness analysis** — current implementation is tested, not formally verified.
3. **Checkpoint trust model** — current mainnet fast-sync deliberately requires a pinned trusted `validatorSetRoot`. A production design should specify verifiable validator-transition/checkpoint chains and weak-subjectivity rules.
4. **Authenticated state tree** — stateRoot is deterministic SHA-256 over canonical state, not yet a Merkle/Verkle tree with compact inclusion proofs.
5. **State snapshot chunk proofs** — current checkpoint state is a signed canonical bundle; large-state production sync needs content-addressed chunks and per-chunk authenticated proofs.
6. **Production transport** — signed HTTP/relay overlay remains; Noise/QUIC/libp2p-class transport hardening is not complete.
7. **Validator lifecycle governance** — epoch transitions need audited join/exit limits, key rotation and emergency governance.
8. **HSM/hardware-wallet validator keys**.
9. **Reproducible builds and external security audit**.
10. **Load/adversarial testing** at hundreds/thousands of validators and high packet loss/partition rates.
