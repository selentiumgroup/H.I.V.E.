# Neural Mesh Protocol v0.14

## Governance objects
A protocol-upgrade proposal commits to `networkId`, `targetVersion`, `minCompatibleVersion`, `releaseHash`, `activationHeight`, change metadata, author NodeID and signature. The proposal ID is a SHA-256 commitment to the immutable proposal body.

Validators in the activation-height validator snapshot sign `governance-vote` envelopes. A proposal becomes scheduled after the normal >=2/3 threshold is reached.

## Activation
Before activation the network continues with v6 BFT blocks. At/after activation the elected proposer creates v7 blocks containing:
- `protocolVersion`;
- `minCompatibleVersion`;
- `governanceRoot`;
- `governanceCertificate`.

The certificate contains the signed proposal, committee, threshold and validator votes. A node independently verifies it before accepting a v7 block. The governance root commits to the ordered set of activated upgrades.

## Compatibility
Peer discovery accepts protocol versions >= the currently activated minimum. The consensus layer independently checks its local software version against the activated minimum before accepting v7 blocks.

## Release commitment
`releaseHash` is intended to be the SHA-256 of the exact release artifact approved by validators. Governance does not auto-download or execute code.

## Network manifest
`scripts/network-manifest.mjs` deterministically derives a manifest from consensus/security configuration and the existing genesis block. It does not contain timestamps, so identical configuration yields the same manifest hash.

## v0.15 Operator Ceremony

Validator onboarding is offline-first. Each validator signs a public manifest with its existing NodeID key. The ceremony verifies each signed manifest and computes a deterministic validator root over `(nodeId, commitment)` pairs. The ceremony never receives validator private keys.

Release artifacts are referenced by SHA-256. Operators should verify the exact archive before governance voting or deployment. Production launch should pass `mainnet-preflight` before the service is enabled.

# v0.16 Constitutional governance

Neural Mesh v0.16 adds a non-custodial BFT constitutional layer. Constitutional actions are not administrator commands. They are signed proposals whose committee is snapshotted from the validator set and whose threshold is `floor(2n/3)+1`.

Supported actions:

- `emergency-halt`: pause creation/finalization of application blocks.
- `emergency-resume`: resume after a halt with a new independent certificate.
- `cancel-upgrade`: cancel a scheduled protocol upgrade before activation.
- `validator-recovery`: authorize a new public validator identity after a lost identity. It never recovers a private key.

Constitutional invariants include the 86B NRN cap, the BFT quorum rule, prohibition of network private-key recovery, and prohibition of single-operator emergency control.

Constitution action/vote/certificate objects carry end-to-end NodeID signatures and may be relayed without trusting the relay.
