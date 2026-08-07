---
block: privacy-ladder
description: F-1055 — three-layer privacy architecture answer for enterprise and sovereign customers
used-by: p/matteo-v2-*, privacy.html (pending Lane C)
updated: 2026-08-08
---

# Privacy Ladder (F-1055)

When users and organisations ask "where does my data go?", the answer is three layers — pick the right rung for your risk posture:

## Layer 1 — App-layer scoping (default)
Data is scoped to the organisation's tenant from the API layer. No cross-tenant access. Biometric signals (face frames, voice) are processed in-session and never stored — only the outcome token and the signed receipt are retained. The biometric ceremony is designed for zero-retention by construction.

## Layer 2 — Postgres row-level security (live, S143)
For organisations with higher data sensitivity: row-level security is enforced at the database layer (not just application logic). A misconfigured query cannot return data outside the tenant's scope. This is a live, audited control — not a roadmap item.

## Layer 3 — SOVEREIGN / dedicated tier (available by arrangement)
For critical infrastructure, defence-adjacent, and regulated operators: a dedicated deployment that never routes data outside the organisation's boundary. Air-gapped where required. No shared infrastructure. Pricing and terms on request.

## On biometric data
Biometric signals are used to prove a live human is present at the moment of the ceremony. They are not stored, enrolled, or used to build a biometric identity. The ceremony produces a signed token; the signals that produced it do not persist. This posture is architecturally enforced, not a policy promise.

## Compliance roadmap (honest)
SOC 2 Type II and GDPR Article 25 (data protection by design) are planned for Q4 2026 — not claimed today. The architecture is designed to achieve them; the audit has not been performed.
