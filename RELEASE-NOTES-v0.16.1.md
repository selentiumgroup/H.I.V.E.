# Neural Mesh v0.16.1 — Keystore Migration Hotfix

This hotfix does not change the consensus protocol. It remains protocol `0.16.0` and can be deployed without a governance activation.

## Fixed

- Encrypted `identity-v2.json` and `wallet-v2.json` can now migrate across password-source changes without changing NodeID or NRN address.
- When the current password fails, the runtime may try only explicit/local legacy sources: `LEGACY_NODE_KEY_PASSWORD`, `LEGACY_WALLET_PASSWORD`, and the existing `data/.local-keystore-secret`.
- Successful legacy decryption re-encrypts the keystore under the current configured password and creates a timestamped `.pre-migration-*.bak` backup.
- If encrypted keystores already exist but `.local-keystore-secret` is missing, the runtime no longer generates a new unrelated secret and then reports a misleading corruption error.
- Startup errors now explain how to recover the old secret/password and explicitly warn not to delete encrypted keystore files.

## Safe upgrade

Keep the entire `data/` directory, including hidden files. In particular, preserve `data/.local-keystore-secret` when it exists.

If the old local secret is gone but you know the old password, start once with `LEGACY_NODE_KEY_PASSWORD` and/or `LEGACY_WALLET_PASSWORD`. After migration these legacy variables can be removed.
