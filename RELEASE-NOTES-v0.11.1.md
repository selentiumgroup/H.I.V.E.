# Neural Mesh v0.11.1 — Idempotent P2P Replay Hotfix

Fixes benign duplicate delivery being treated as a fatal P2P error.

## Fixed

- duplicate `/p2p/hello` requests are now idempotent and return `duplicate: true`
- duplicate `/p2p/dht/find-node` requests are now idempotent
- duplicate `/p2p/dht/announce` requests are now idempotent
- duplicate reachability probes and pings no longer produce fatal replay errors
- malformed signatures, wrong network IDs, invalid descriptors, and stale/invalid envelopes remain rejected

This extends the duplicate-safe behavior previously used for gossip to service-discovery traffic, where retries and multi-path delivery are normal.

## Verification

- `node scripts/replay-idempotency-test.mjs` → `IDEMPOTENT REPLAY V0.11.1 OK`
- `npm run smoke` → security regression passes including NRN rewards, finality, slashing, wallet recovery and private relay operation.
