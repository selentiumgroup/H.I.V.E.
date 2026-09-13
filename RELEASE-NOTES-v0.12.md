# Neural Mesh v0.12 — Mainnet Consensus Core

## Added

- Validator epochs with epoch-start stake snapshots for committee eligibility.
- Round-aware deterministic committees and deterministic leader metadata.
- Multi-round block finalization retry (`BFT_MAX_ROUNDS`).
- Delayed validator unbonding; stake exits immediately but funds remain locked until the release height.
- Deterministic `stateRoot` in every new block (balances, nonces, bonds, pending unbonds).
- Signed on-disk checkpoints and `/api/consensus/checkpoints`.
- Manual authenticated snapshot creation endpoint.
- Consensus telemetry in `/api/status`.

## Compatibility

The v0.11.x genesis block is intentionally unchanged. Existing wallets, NodeID, ledger, CAS, adapters and training state can remain in `data/` during upgrade.

## Tests

- `CONSENSUS V0.12 OK`
- legacy security smoke passes
- content-addressed network passes
- LoRA training passes
- Explorer passes
- federated/BFT evolution passes

## Explicit limitation

Checkpoints are signed recovery/verification artifacts in v0.12. Trustless snapshot state import / fast-sync is not yet enabled.
