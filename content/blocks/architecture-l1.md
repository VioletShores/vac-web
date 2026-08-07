---
block: architecture-l1
description: Architecture L1 — honest-status 6-step flow (what exists today)
used-by: p/matteo-v2-*, architecture.html
updated: 2026-08-08
---

# Architecture — L1: The Flow (Honest Status)

Status labels: **BUILT · LIVE** = in production, adversarially reviewed. **BUILT · MERGING** = complete, in the gating process. **PLANNED** = designed, not yet built.

## 1. Verified human root — BUILT · LIVE
A live, consistent human is proven by several signals bound together in a single act: face liveness, certified passive liveness, a spoken-and-shown challenge, and gesture. Binding in one act resists deepfakes and injected media; a single-detector check does not.

*Live: face liveness · certified passive liveness · face-embedding re-auth · consolidated verify.*

## 2. A real human — not (yet) a legal identity — BUILT · LIVE
The biometric proves a real, same, live human. It does not prove a legal identity on its own. Legal-identity binding is a pluggable higher tier: biometric → SSO / OIDC → government ID → KYC provider. The tier is selected per use case.

## 3. Assurance proportional to the action — BUILT · LIVE
The system reads the action and its context, assesses the risk, and decides how much proof to require — continuously. This is the differentiator: the level is an output of a risk controller (CoPS/PID), not a fixed if-then rule.

*Live: risk engine (assess → risk level → required modalities), quick re-auth endpoint.*

## 4. The action is gated — and the decision is audited — BUILT · LIVE
A sensitive action is refused unless a fresh, sufficiently-strong, owner-bound re-auth is proven. Every action and every refusal is written to an immutable Action Attestation Record: what was attempted, by whose authority, at what assurance level, with what result. The denials are logged as well as the approvals.

## 5. Bounded agent delegation — BUILT · MERGING
An agent can act for a human, but its authority is derived from and bounded by that verified human — scope, expiry, and revocation signed into the chain. Revoke the human; every downstream agent stops.

## 6. Signed, independently-verifiable receipts — BUILT · LIVE
Each authority decision is a genuinely signed token (Ed25519) that anyone can verify against the backend. No trust in the operator required — the chain of who-authorised-what is auditable end to end.
