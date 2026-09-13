# Neural Mesh v0.16

Mainnet ceremony and operator-tooling release on top of v0.14 BFT governance, v0.13 full BFT state machine, NRN ledger, federated learning, LoRA training and content-addressed skills.

## v0.16 Mainnet Constitution

v0.16 is the final pre-mainnet protocol feature release. It adds a BFT constitutional layer with no master key: emergency halt/resume, scheduled-upgrade cancellation and public validator-identity recovery all require validator quorum certificates. The constitutional invariants permanently keep the 86B NRN cap, the >=2/3 BFT threshold, no private-key recovery, and no single-operator network halt.

Useful endpoints:

```text
GET  /api/constitution
POST /api/constitution/propose
POST /api/constitution/vote
```

Run the dedicated test with:

```bash
npm run constitution-test
```


## Normal node

```bash
npm start
```

## Validator manifest

Each validator runs this locally after creating its encrypted NodeID:

```bash
VALIDATOR_OPERATOR="operator-name" \
VALIDATOR_ENDPOINT="https://validator.example:48686" \
npm run validator-manifest -- validator.json
```

The output contains only public identity material and a NodeID signature. Private keys are never exported.

## Genesis ceremony

Collect signed validator manifests and run:

```bash
npm run genesis-ceremony -- --out genesis-ceremony.json validator-a.json validator-b.json validator-c.json validator-d.json
```

The ceremony verifies signatures, uniqueness and NETWORK_ID and emits `validatorRoot`, threshold, genesis hash and ceremony hash.

## Release verification

```bash
npm run verify-release -- neural-mesh-v0.16.zip neural-mesh-v0.16.zip.sha256
```

## Mainnet preflight

```bash
SECURITY_MODE=mainnet npm run mainnet-preflight
```

It rejects unsafe settings such as implicit wallet/node passwords, auto bootstrap validators, untrusted testnet fast-sync, auto Ollama installation and weak/missing API admin token.

## Production deployment

- `deploy/systemd/neural-mesh.service`
- `deploy/docker/docker-compose.production.yml`

Run all v0.16 operator checks:

```bash
npm run operator-test
```

See `docs/PROTOCOL.md`, `docs/MAINNET-GAPS.md`, and `RELEASE-NOTES-v0.16.md`.
