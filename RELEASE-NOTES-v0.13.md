# Neural Mesh v0.13 — BFT State Machine

v0.13 upgrades the NRN chain from single-phase block voting to a leader-driven two-phase BFT state machine while preserving the existing genesis and data directory.

## Added

- Elected proposer per `height/round`.
- Proposal forwarding: a non-leader origin asks the elected leader to construct/sign the proposal.
- `prevote -> precommit -> finalize` certificates for v6 blocks.
- Deterministic view-change by incrementing the round and rotating the leader.
- `validatorSetRoot` committed into every v6 block.
- Persistent phase votes and BFT equivocation evidence.
- Catch-up before voting when a validator is missing the parent block.
- Periodic multi-peer ledger synchronization.
- Certified checkpoints with validator quorum signatures.
- Checkpoint state bundles containing balances, nonces, bonds, pending unbonds and transaction IDs.
- Testnet checkpoint fast-sync and mainnet trusted-root gating.
- Fast-sync state base in SQLite so post-checkpoint blocks can be applied without genesis replay.

## Hardening added during v0.13 validation

- Honest validators persist a same-slot vote lock and refuse to sign a different `blockHash` for the same `height/round/phase`.
- `precommit` requires a verifiable prevote quorum proof for the same proposal.
- An elected proposer that is behind the requesting origin first catches up finalized blocks before answering the proposal request.
- Finalized blocks may be relayed by any authenticated peer; proposer authenticity is verified from the block's own signature and BFT certificate rather than transport sender identity.
- Finalized block propagation retries transient failures before relying on periodic ledger catch-up.

## Compatibility

- Genesis block/hash is unchanged.
- Existing v5 blocks remain importable/verifiable.
- New blocks are version 6 when `FULL_BFT_ENABLED=true`.
- Existing NodeID, NRN wallet, CAS, adapters and evolution state can remain in `data/`.

## Security boundary

v0.13 implements elected-proposer, prevote/precommit and view-change and has been tested under leader failure. It does **not** yet implement full Tendermint-style lock/POL unlock semantics for arbitrary asynchronous competing rounds. Treat it as an adversarial-testnet BFT state machine, not an audited production-finality implementation.

Mainnet checkpoint fast-sync also requires `TRUSTED_CHECKPOINT_VALIDATOR_ROOT`; the software intentionally refuses to treat an arbitrary self-contained validator set as a trustless checkpoint root.
