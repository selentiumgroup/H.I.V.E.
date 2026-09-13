# Mainnet gaps after v0.14

v0.14 provides BFT-governed protocol activation and release commitments, but public mainnet should still require independent security review and operational ceremony.

Remaining hardening includes:
- audited reproducible container/binary builds across architectures;
- hardware-wallet/HSM validator keys;
- formal upgrade cancellation/emergency-halt governance;
- explicit governance deposit/spam economics;
- long-running partition and Byzantine-network testing;
- production QUIC/Noise/libp2p transport replacement;
- external audit of BFT, ledger, wallet, relay and fast-sync paths;
- canonical mainnet genesis ceremony and independently controlled genesis validators.

Governance intentionally does not self-download or self-execute a voted release. Operators verify the committed artifact and deploy it before activation height.

## v0.15 remaining external requirements

- Independent security audit and reproducible-build infrastructure are still external operational requirements.
- Hardware-backed validator keys/HSM integration is not implemented by this release.
- Emergency halt/cancel policy should be finalized by the launch governance constitution before public mainnet; v0.15 deliberately does not add a single-operator kill switch.
- Public genesis ceremony should be witnessed and its signed artifacts published independently by multiple operators.
