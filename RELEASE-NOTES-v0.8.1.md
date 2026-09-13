# Neural Mesh v0.8.1 — Gossip Replay Fix

This patch separates duplicate gossip from invalid gossip.

- Replayed gossip packets are treated as harmless duplicates and return `{ ok: true, duplicate: true }`.
- Invalid signatures, bad timestamps, wrong NodeIDs and wrong network IDs are still rejected.
- ReplayGuard now exposes a three-state inspection result: valid / duplicate / invalid.
- Added a regression test for duplicate gossip plus forged gossip.
- Security smoke remains green.
