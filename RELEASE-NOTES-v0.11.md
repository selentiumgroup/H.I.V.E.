# Neural Mesh v0.11 — Content-Addressed Model Network

## Added

- SHA-256 content-addressed storage for LoRA/model artifacts.
- Replication target and provider registry.
- Chunked P2P object transfer with full-object integrity verification.
- Automatic content offers and replica acquisition.
- Recovery of a skill from a replica after the original author disappears.
- Per-peer and global P2P backpressure.
- Peer quality ranking for content retrieval and broadcasts.
- `/api/content` and P2P content endpoints.
- Explorer CAS/replica telemetry.

## Compatibility

- NRN ledger, wallets, validator finality, slashing, BFT evolution anchors, zero-touch discovery and v0.10 training semantics are retained.
- Existing adapters without `contentHash` still use the legacy adapter-chunk path.

## Security

- Content is accepted only when its SHA-256 matches the signed manifest/hash request.
- CAS does not alter consensus state.
- Large transfers are bounded by `CONTENT_MAX_OBJECT_BYTES` and backpressure limits.

## Known boundary

The network transport is still the hardened signed HTTP/relay overlay. v0.11 improves durability, peer scoring and flow control, but does not yet claim a complete QUIC/libp2p production transport.
