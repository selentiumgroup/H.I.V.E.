# Neural Mesh v0.14 — Mainnet Packaging & Governance

v0.14 adds BFT-governed protocol upgrades and reproducible network manifests on top of the v0.13 full BFT state machine.

## New
- signed protocol-upgrade proposals;
- validator governance votes and >=2/3 certificates;
- scheduled activation heights;
- release SHA-256 commitments;
- minimum-compatible-version gates;
- v7 blocks after protocol activation with `protocolVersion`, `governanceRoot`, and a self-contained governance certificate;
- dynamic peer compatibility filtering after activation;
- governance propagation over direct P2P and relay;
- deterministic `network-manifest.json` generation containing network ID, genesis hash, consensus/security parameters, and manifest hash;
- governance status/API endpoints;
- old v0.13-compatible v6 blocks remain in use before activation.

## Upgrade safety
A scheduled upgrade does not alter consensus immediately. Before `activationHeight`, v0.13 and v0.14 nodes can continue to share v6 blocks. At activation, v0.14 emits v7 blocks containing the BFT governance certificate. Nodes below `minCompatibleVersion` must reject the new block format instead of silently following an incompatible chain.

## API
- `GET /api/governance`
- `POST /api/governance/propose`
- `POST /api/governance/vote`
- `POST /p2p/governance`

## Tests
`npm run governance-test` validates proposal signatures, validator voting, quorum scheduling, activation version selection, and deterministic governance roots.
