---
block: architecture-l2
description: Architecture L2 — component internals placeholder (Lane D)
used-by: architecture.html
status: LANE-D-PENDING
updated: 2026-08-08
---

# Architecture — L2: Component Block Diagram (Lane D)

*This block is a forward pointer. The full L2 visual block diagram will be built in Lane D from the hub regeneration (ROBS-HUB S156).*

## What the L2 diagram will show

- **Biometric engine** — face liveness, deepfake scan, passive liveness (iBeta certified component), embedding re-auth, gesture recognition (MediaPipe); the cross-modal binding layer
- **Authority chain** — verified human root → VAC token mint → bounded delegation envelope → agent scope/expiry/revocation; Ed25519 signing
- **Risk controller** — CoPS/PID risk assessment, assurance level selection, recency/trust weighting, feedback loop
- **Action gate + audit layer** — AAR (Action Attestation Record) write; both allow and deny records; Ed25519-verifiable; vat-verify endpoint
- **SignalRank routing** — per-domain model calibration from known-answer challenges; routing weight from measured evidence; drift visible
- **API layer** — REST API (vac-system-production.up.railway.app); VACVerify.js drop-in widget; pluggable biometric provider envelope
- **Integration points** — SSO / OIDC ingress; pluggable government-ID tier (PIV/CAC, RealMe, myGovID); pluggable KYC providers

## Source for Lane D
Rob's Hub next-level block diagram (S156 regeneration) is the source artefact. Lane D: promote hub L2 → architecture.html as the visual second tier, keeping the L1 six-step flow as the first tier.
