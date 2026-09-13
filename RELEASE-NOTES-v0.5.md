# Neural Mesh v0.5 — Zero-Touch Network

## Headline
An ordinary node can join with no preconfigured Neural Mesh IP address. It knows only the network ID, discovers candidate peers through a BEP-5/Mainline-DHT rendezvous, cryptographically verifies them, and then moves onto the internal Neural DHT/gossip mesh.

## Added
- Zero-touch discovery through a self-contained BEP-5-compatible Mainline DHT client.
- Signed first-contact handshake; external rendezvous candidates are never trusted directly.
- Peer cache and LAN multicast fallbacks.
- Automatic reverse reachability probing.
- Automatic relay selection for NAT/private nodes.
- Signed descriptor fields for listen port and relay capability.
- Public-rendezvous candidate filtering against loopback, RFC1918, link-local, CGNAT and multicast ranges.
- Automatic encrypted testnet keystore secret with mode 0600 when no password is supplied.
- `./start.sh`: one-command CPU/GPU launcher; prefers Docker and automatically selects the NVIDIA overlay.
- One-command Docker stack with Ollama model pull.

## Preserved from v0.4
- Native NRN wallet and signed transfers.
- 86,000,000,000 NRN hard cap and zero premine.
- Proof-of-Neural-Work receipts and rewards.
- Validator bonds, deterministic committees, >=2/3 finality, equivocation evidence, slashing and jail.
- Replay protection, admission PoW, rate limiting, encrypted keystores and remote-admin protection.
- CPU/GPU inference via Ollama or OpenAI-compatible runtimes.

## Verified
- Zero-touch two-node discovery with zero Neural Mesh seed IPs and no `PUBLIC_URL`.
- Distributed inference across both discovered nodes.
- Three-node security regression including a private relay node.
- Reward blocks, NRN transfer, finality, replay rejection, slashing and wallet recovery.
- Clean-server startup with no manually supplied wallet password/NodeID/wallet and encrypted auto-local testnet keystores.
- Mainnet mode refuses to auto-generate the convenience local keystore secret.

## Important boundary
Zero-touch peer discovery does not eliminate the physical requirement for a live network. With zero live Neural Mesh nodes there is nothing to discover. Consensus genesis/validator policy is also a network-level release decision, not something each joining node may invent independently.
