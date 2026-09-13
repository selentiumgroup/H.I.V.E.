# Neural Mesh v0.7 — Collective Evolution

## Added

- network-wide gene pool;
- persisted collective tournaments and ballots;
- deterministic species IDs and genome-distance metric;
- diversity-aware tournament selection;
- per-author candidate cap;
- validator-bond-aware, capped vote weight;
- optional unstaked testnet voting;
- signed full-ranking ballots;
- weighted Borda tally;
- deterministic winner and designated breeder;
- two-parent crossover;
- deterministic bounded mutation;
- persisted lineage and species metadata;
- deterministic offspring ID;
- collective tournament/ballot P2P and relay propagation;
- automatic collective epochs in testnet;
- Collective Evolution browser dashboard;
- `collective-test` and `collective-network-test`.

## Security properties

- remote tournament `finalized` status is never trusted;
- remote winner claims are ignored and recomputed from local signed ballots;
- transport signatures and inner author signatures are independent;
- relay cannot alter a ballot or genome author proof;
- collective evolution cannot mutate protected security/ledger/wallet/consensus modules;
- collective winner still requires local sandbox + canary before local promotion;
- author flooding and stake dominance are bounded heuristically.

## Compatibility

v0.7 retains:

- zero-touch discovery;
- private relay nodes;
- CPU/GPU inference;
- Ollama/OpenAI-compatible backends;
- native NRN wallet/transfers;
- Proof-of-Neural-Work rewards;
- validator bond/unbond;
- finality, replay protection and slashing;
- v0.6 local Evolution Engine and Digital Sleep.

## Verification

The release includes:

```bash
npm run evolution-test
npm run collective-test
npm run evolution-network-test
npm run collective-network-test
npm run smoke
npm run zero-touch-test
```

The collective network test launches three real nodes, including a relay-only private node, and verifies that all three derive the same winner from the same signed ballot set and receive the same offspring.

## Important limitation

Collective tournament results are not yet BFT-anchored into the NRN ledger. During a network partition, different ballot subsets may temporarily produce different cognitive winners. This is intentionally safe because evolution remains non-consensus-critical and cannot change ledger/security rules.
