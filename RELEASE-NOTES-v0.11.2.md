# Neural Mesh v0.11.2 — Foreign Network Isolation Hotfix

This hotfix makes public discovery tolerant of packets and cached peers from a different `NETWORK_ID`.

## Fixed

- Foreign `hello`, `gossip`, `ping`, reachability probes, DHT `find-node`, and DHT `announce` no longer throw noisy server exceptions.
- Validly signed packets from another Neural Mesh network are classified as `foreignNetwork` and ignored without mutating local peer/DHT state.
- Cached peers whose stored `network_id` differs from the current runtime `NETWORK_ID` are purged on startup.
- Outbound bootstrap candidates that respond as a foreign network are removed from the active seed set.
- Invalid signatures, malformed descriptors, invalid admission proofs, and actual replay/security failures remain rejected.

## Why this happens

Public rendezvous and long-lived `data/` directories can expose a node to peers from older testnets or independently deployed Neural Mesh networks. This is expected P2P behavior and is not itself an attack.
