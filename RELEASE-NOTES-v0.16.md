# Neural Mesh v0.16 — Mainnet Constitution & Emergency Governance

v0.16 is the final pre-mainnet protocol feature release.

## Constitution

The network now has a BFT-governed constitutional layer. No single operator has an emergency key.

Immutable constitutional invariants:

- NRN hard cap: 86,000,000,000 NRN.
- BFT threshold floor: `floor(2n/3)+1`.
- Private validator keys are never recoverable by the network.
- No single-operator emergency halt/resume authority.

## Emergency actions

Supported signed constitutional actions:

- `emergency-halt`
- `emergency-resume`
- `cancel-upgrade`
- `validator-recovery`

Every action snapshots a validator committee and threshold when created. It becomes effective only after the required independent validator signatures are collected.

A halt prevents creation/finalization of new application blocks. Resume requires a separate BFT certificate.

## Upgrade cancellation

A scheduled protocol upgrade can be cancelled before activation only by a constitutional BFT certificate. Cancelled upgrades are removed from the active governance root/version calculation.

## Multi-party validator recovery

Recovery never reconstructs or exports a lost private key. Validators can only authorize a new public validator identity to replace a lost identity after the configured recovery delay. The recovery authorization is independently signed and retained as audit evidence.

## P2P

Constitution actions, votes and finalized certificates propagate through direct P2P and relay paths with end-to-end author signatures.

## Operator API

- `GET /api/constitution`
- `POST /api/constitution/propose`
- `POST /api/constitution/vote`
- `POST /p2p/constitution`

## Mainnet preflight

`CONSTITUTION_ENABLED=true` is now mandatory for a mainnet preflight pass.

## Testing

`npm run constitution-test`

covers:

- below-quorum halt rejection;
- 3/4 emergency halt;
- BFT resume;
- BFT cancellation of a scheduled upgrade;
- multi-party validator recovery authorization;
- permanent prohibition on private-key recovery.

After v0.16 the intended path is audit/chaos/load testing, genesis freeze and v1.0. No new consensus features should be added between v0.16 and v1.0.
