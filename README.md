# Neural Mesh v1.0 — Mainnet Release Freeze

Neural Mesh v1.0 is the feature-frozen software release of the decentralized AI network developed through v0.1–v0.16. The software version is **1.0.0**; the frozen consensus protocol remains **0.16.0** until a BFT-governed protocol upgrade is explicitly activated.

Core capabilities include distributed LLM inference, CPU/GPU auto-provisioning, zero-touch discovery, native NRN wallet/ledger, full BFT consensus and view-change, validator staking/slashing, constitutional governance, collective evolution, federated knowledge transfer, LoRA training, content-addressed skill replication, Explorer telemetry and mainnet operator ceremony tooling.

## Start a normal/testnet node

```bash
npm start
```

The node will auto-select a local Ollama model where allowed by the selected security profile.

## Mainnet is deliberately not one-click

Public mainnet requires a witnessed genesis ceremony and explicit production secrets. Before a validator starts:

```bash
npm run release-audit
npm run release-freeze
npm run verify-v1
npm run mainnet-preflight
```

Do **not** use `network-manifest.mainnet.template.json` as a real genesis manifest. It must be replaced by the output of the real multi-party genesis ceremony.

## Release validation

```bash
npm run release-audit
npm run chaos-test
npm run load-test
npm run verify-v1
```

`release-manifest.json` commits SHA-256 for every shipped file and a deterministic `releaseRoot`.

## Important security status

v1.0 is feature-frozen, but the bundled tests are not an independent audit. Before economically valuable public mainnet launch, complete the external audit, multi-region adversarial testnet, operator recovery rehearsal and final genesis ceremony in `docs/MAINNET-LAUNCH-CHECKLIST.md`.

## Mainnet invariants

- Maximum supply: **86,000,000,000 NRN**.
- Consensus/emergency quorum: `floor(2n/3)+1`.
- No single-operator network halt/resume.
- No private-key recovery mechanism.
- Protocol upgrades require BFT governance and activation height.
- Finalized state commits `stateRoot` and `validatorSetRoot`.

See `docs/PROTOCOL.md`, `docs/MAINNET-GAPS.md`, and `RELEASE-NOTES-v1.0.md`.
