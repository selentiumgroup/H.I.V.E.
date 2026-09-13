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
