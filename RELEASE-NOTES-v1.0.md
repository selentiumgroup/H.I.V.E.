# Neural Mesh v1.0 — Mainnet Release Freeze

v1.0 is the first feature-frozen release line. It does **not** introduce a new consensus algorithm beyond protocol 0.16.0. The software release version is 1.0.0 while the consensus protocol remains 0.16.0 until a BFT-governed protocol upgrade is explicitly activated.

## Release guarantees

- No generated wallet, NodeID, seed, `.local-keystore-secret`, `.env`, private key, or runtime database is shipped in the release archive.
- Mainnet startup remains gated by `npm run mainnet-preflight` and explicit operator secrets.
- The 86,000,000,000 NRN constitutional cap is unchanged.
- Full BFT, validator epochs, delayed unbonding, state roots, certified checkpoints, governance and constitutional emergency controls are unchanged from the frozen protocol core.
- v1.0 adds release-validation tooling only: secret scanning, reproducible file manifest, load test and chaos/adversarial regression harness.

## New operator commands

```bash
npm run release-audit
npm run release-freeze
npm run load-test
npm run chaos-test
npm run verify-v1
```

## Security statement

Passing the bundled test suite is **not** a substitute for an independent security/cryptographic audit. Public mainnet with economically valuable NRN should not be launched before an external review, multi-region adversarial testnet and witnessed final genesis ceremony.
