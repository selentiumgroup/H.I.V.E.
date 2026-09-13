# Neural Mesh Protocol v0.13

## BFT block version 6

A v6 block commits to:

- `index`, `prevHash`, `round`, `epoch`
- elected `leader`
- `proposer` + proposer signature
- `committee` and quorum threshold
- `validatorSetRoot`
- `stateRoot`
- transactions, NRN receipts, slashings, evolution anchors
- `consensusCertificate.prevotes`
- `consensusCertificate.precommits`

The certificate itself is excluded from the block value hash; it proves finality of the already-hashed proposal.

## Proposal

For `(height, round, parent)` the leader is selected deterministically from the round committee. A non-leader origin forwards proposal contents to the elected leader. A v6 proposal is rejected if `proposer != leader`.

## Two-phase voting

Validators verify the proposal independently and sign an envelope:

```text
type: bft-vote
phase: prevote | precommit
height
round
blockHash
prevHash
validatorId
approved
```

Finality requires quorum valid prevotes and quorum valid precommits from the block committee.

## View change

If proposal, prevote or precommit does not reach quorum within the configured round window, the origin increments `round`. Committee seed/leader selection include the round, producing a deterministic next attempt.

## Equivocation

Conflicting BFT votes by the same validator for the same `(height, round, phase)` produce slash evidence. Legacy conflicting `block-vote` evidence remains understood for historical compatibility.

## Validator set root

`validatorSetRoot` hashes the epoch validator snapshot including NodeID and canonical stake/public metadata. Mainnet validation requires local epoch state to reproduce the root.

## Checkpoints

Checkpoint v2 commits:

- checkpoint block
- canonical serialized state
- `stateRoot`
- `validatorSetRoot`
- total supply
- validator-set snapshot
- quorum signatures

Testnet can import a correctly certified checkpoint. Mainnet additionally requires a pinned trusted validator-set root. Future releases should replace this weak-subjectivity pin with a formally specified checkpoint-certificate chain / validator transition proof.

## BFT safety hardening

For each `height/round/phase`, an honest validator persists its first signed BFT vote before returning it. A second request for the same proposal reuses the stored vote; a different `blockHash` is refused. Precommit requests carry the prevote proof and are accepted only when the validator independently verifies prevote quorum.

Finalized block gossip is transport-independent: any authenticated peer may relay a finalized block. The receiver validates the embedded proposer signature, committee, prevote/precommit certificate, `validatorSetRoot`, `stateRoot`, and parent linkage.
