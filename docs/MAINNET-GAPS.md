# Neural Mesh v1.0 — External launch gates

The v1.0 software feature set is frozen. The remaining mainnet requirements are external validation and operator process, not new protocol features.

Required before economically valuable public mainnet:

- independent cryptographic/security audit of BFT, wallet/keystore, ledger/state transition, governance, fast-sync, relay/P2P and training/content paths;
- remediation and re-audit of material findings;
- multi-region adversarial/partition/Byzantine testnet;
- sustained load and resource-exhaustion testing on intended validator hardware;
- witnessed final genesis ceremony using independent validator operators;
- immutable publication of genesis ceremony, validator root, network manifest, release archive SHA-256 and releaseRoot;
- hardware-backed/HSM validator key policy for material stake;
- operator disaster-recovery, emergency halt/resume and identity-rotation rehearsal;
- final trusted checkpoint/root distribution policy.

The current transport is a hardened signed HTTP/relay overlay with DHT/rendezvous, scoring and backpressure; it is not represented as an independently audited QUIC/Noise/libp2p transport.

No independent audit is bundled or implied by the v1.0 version number.
