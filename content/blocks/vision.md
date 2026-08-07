---
block: vision
description: Core VAC vision — the trust/authority layer for AI agents
used-by: p/matteo-v2-*, index.html, architecture.html, origin.html
updated: 2026-08-08
---

# Vision

VAC is the trust layer for AI agents: the missing stack that governs *what a verified human — or an agent acting under their authority — is allowed to do*, decides how much proof each action needs, gates the action, and writes a signed auditable record of every decision and every refusal.

Three primitives compose it:

1. **Verified human root** — a live biometric ceremony proves a real, present human before any authority is granted. Face liveness, certified passive liveness, and a cross-modal spoken-and-shown challenge bound together in a single act. Binding in one act is what resists deepfakes and injected media; a single-detector check doesn't.

2. **Assurance proportional to the action** — the system reads each action's risk and decides how much proof to require, continuously. Viewing a credential might need a fast one-digit re-auth (seconds). Releasing money or minting authority needs the full modality set. The level is an output of a risk controller, not a fixed if-then rule.

3. **Signed, independently-verifiable receipts** — every authority decision emits an Ed25519-signed token anyone can verify against the backend. The chain of who-authorised-what is auditable end to end, and every refusal is logged as well as every approval.

An agent can act *for* a human, but its authority is derived from and bounded by that verified human — scope, expiry, and revocation signed into the chain. Revoke the human; every downstream agent stops.

This is the answer to the question that agentic AI has made urgent: *which accountable human authorised this action, within what limits, at this moment?*
