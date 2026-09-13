# Neural Mesh v0.15 — Mainnet Ceremony & Operator Tooling

- Signed validator manifests generated locally from each validator NodeID.
- Multi-operator genesis ceremony verifies every validator signature and produces deterministic validator root + ceremony hash.
- Release verification CLI checks SHA-256 before rollout.
- Reproducible network manifest remains the canonical network configuration commitment.
- Mainnet preflight rejects unsafe operator configuration (implicit keys, auto bootstrap validators, untrusted fast-sync, short/missing API token).
- Production systemd unit and Docker Compose profile included.
- Existing v0.14 BFT-governed protocol upgrade path remains unchanged and compatible.

## Operator commands

```bash
npm run validator-manifest -- validator.json
npm run genesis-ceremony -- --out genesis-ceremony.json validator-*.json
npm run verify-release -- neural-mesh-v0.15.zip <sha256>
npm run mainnet-preflight
npm run operator-test
```

Private validator keys never leave their node during ceremony; only signed public manifests are collected.
