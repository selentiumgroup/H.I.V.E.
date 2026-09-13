# Neural Mesh v0.14 — Mainnet Packaging & Governance

v0.14 adds canonical protocol governance and reproducible network packaging to the v0.13 Full BFT State Machine while preserving NRN, wallets, zero-touch discovery, LoRA/federated learning, CAS replication, Explorer and collective evolution.

## Start
```bash
npm start
```
Existing `data/` from v0.13 can be retained. Before a governance activation, v0.14 continues producing v6 blocks compatible with v0.13.

## Protocol upgrade flow
```text
release artifact
   ↓ SHA-256
signed upgrade proposal
   ↓
validator votes
   ↓ >= 2/3
SCHEDULED
   ↓ activationHeight
v7 BFT block
   ├─ protocolVersion
   ├─ minCompatibleVersion
   ├─ governanceRoot
   └─ governanceCertificate
```
The first activated block carries the proposal and validator certificate, so a node that missed governance gossip can still verify the upgrade from the canonical block itself.

## Create an upgrade proposal
```bash
curl -X POST http://127.0.0.1:48686/api/governance/propose \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "targetVersion":"0.15.0",
    "minCompatibleVersion":"0.15.0",
    "releaseHash":"<64-char sha256>",
    "activationHeight":5000,
    "changes":{"summary":"protocol upgrade"}
  }'
```

## Vote
```bash
curl -X POST http://127.0.0.1:48686/api/governance/vote \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"proposalId":"<id>","approve":true}'
```

## Governance state
```bash
curl http://127.0.0.1:48686/api/governance
```

## Reproducible network manifest
```bash
npm run network-manifest -- network-manifest.json
```
The manifest commits to the network ID, genesis hash, BFT epoch/unbond parameters, admission/work PoW settings and governance activation delay. It includes a deterministic `manifestHash`.

## Important mainnet rule
Upgrade proposals should reference the SHA-256 of the exact released archive/binary. Mainnet validators should independently reproduce or verify that release before voting. `GOVERNANCE_AUTO_VOTE` should remain disabled on mainnet.

## Tests
```bash
npm run governance-test
npm run bft-test
npm run verify-v14
```

See `docs/PROTOCOL.md`, `docs/MAINNET-GAPS.md`, and `RELEASE-NOTES-v0.14.md`.
