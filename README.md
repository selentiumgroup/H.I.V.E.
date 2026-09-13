# Neural Mesh v0.13 — BFT State Machine

Neural Mesh is a decentralized AI network where each server acts as an autonomous neural node. v0.13 focuses on canonical NRN-chain consensus and checkpoint recovery while retaining the inference, zero-touch discovery, NRN wallet, evolution, federated learning, LoRA training, content-addressed skill network and Explorer from previous releases.

## Start

```bash
npm start
```

The normal inference node remains zero-touch. On testnet it can auto-provision the local LLM runtime as in previous releases.

## v0.13 consensus path

```text
transaction / rewards
        |
        v
height H, round R
        |
        v
ELECTED PROPOSER
        |
        v
PROPOSAL (v6 block)
        |
        v
PREVOTE >= 2/3
        |
        v
PRECOMMIT >= 2/3
        |
        v
FINAL BLOCK
        |
        +--> stateRoot
        +--> validatorSetRoot
        +--> prevote certificate
        +--> precommit certificate
```

If the elected proposer cannot produce a block, the node advances the round and deterministically selects the next leader. A four-validator committee therefore continues when one round-0 leader is offline, provided the remaining committee can still satisfy quorum.

## Validator-set commitment

Every new block commits a deterministic `validatorSetRoot`. The validator set is epoch-based and derived from the canonical state at the epoch boundary. Existing delayed-unbonding and slashing state are included in `stateRoot`.

## Checkpoint fast-sync

A checkpoint contains:

- finalized block and hash;
- state root;
- validator-set root;
- total NRN supply;
- balances and nonces;
- validator bonds/jail/slashing state;
- pending unbonds;
- confirmed transaction IDs;
- validator quorum certificate.

Manual checkpoint:

```bash
curl -X POST http://127.0.0.1:48686/api/consensus/snapshot \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'content-type: application/json' \
  -d '{}'
```

Fast-sync from a known peer:

```bash
curl -X POST http://127.0.0.1:48686/api/consensus/fast-sync \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"nodeId":"<peer-node-id>"}'
```

For `SECURITY_MODE=mainnet`, checkpoint import requires:

```env
TRUSTED_CHECKPOINT_VALIDATOR_ROOT=<64-hex-root>
```

This is deliberate: a self-contained checkpoint whose signer set is supplied by the checkpoint itself is not trustless.

## Important settings

```env
FULL_BFT_ENABLED=true
VALIDATOR_COUNT=4
VALIDATOR_QUORUM=3
VALIDATOR_EPOCH_BLOCKS=100
BFT_MAX_ROUNDS=4
BFT_ROUND_TIMEOUT_MS=8000
BFT_PREVOTE_TIMEOUT_MS=4000
BFT_PRECOMMIT_TIMEOUT_MS=4000
LEDGER_SYNC_INTERVAL_MS=5000
CHECKPOINT_QUORUM_ENABLED=true
```

## Tests

Core v0.13 test:

```bash
npm run bft-test
```

It starts four validators, finalizes a two-phase BFT block, kills the next elected proposer, verifies view-change/finalization by the remaining three validators, creates a certified checkpoint, and starts a fresh fifth node from that checkpoint.

Extended verification:

```bash
npm run verify-v13
```

## Test result used for this release

```text
FULL BFT V0.13 OK
height: 2
viewChangeRound: 1
prevotes: 4
precommits: 4
checkpoint fast-sync: OK
stateRoot match: OK
```

## Existing subsystems retained

- CPU/GPU adaptive Ollama inference
- zero-touch peer discovery
- NRN native wallet and ledger
- validator staking/unbonding/slashing
- knowledge transfer and federated policy learning
- collective evolution and BFT evolution anchors
- LoRA training engine
- content-addressed adapter/model network
- signed network telemetry and Explorer

## Security boundary

v0.13 is appropriate for an adversarial testnet. Although it now uses elected proposers, prevote/precommit certificates and view-change, it is not presented as audited production BFT. Full lock/POL semantics across arbitrary asynchronous competing rounds, formal verification, transport hardening and external audit remain before a public-value mainnet.
