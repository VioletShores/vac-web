---
block: privacy-ladder
description: F-1055 — three-layer privacy architecture answer for enterprise and sovereign customers
used-by: p/matteo-v2-*, privacy.html (pending Lane C)
updated: 2026-11-23
---

# Privacy Ladder (F-1055)

When users and organisations ask "where does my data go?", the answer is three layers — pick the right rung for your risk posture:

## Layer 1 — App-layer scoping (default)
Data is scoped to the organisation's tenant from the API layer. No cross-tenant access. The recording made during the biometric ceremony (video, photo, voice) is not kept by us. It is sent to verification providers to be checked. One thing derived from it is kept so a person can be recognised next time: a face template (a set of numbers that describes the face, not a picture), alongside the outcome token and the signed receipt. No photo, no recording and no written description of the person is stored.

## Layer 2 — Postgres row-level security (live, S143)
For organisations with higher data sensitivity: row-level security is enforced at the database layer (not just application logic). A misconfigured query cannot return data outside the tenant's scope. This is a live, audited control — not a roadmap item.

## Layer 3 — SOVEREIGN / dedicated tier (available by arrangement)
For critical infrastructure, defence-adjacent, and regulated operators: a dedicated deployment that never routes data outside the organisation's boundary. Air-gapped where required. No shared infrastructure. Pricing and terms on request.

## On biometric data
Biometric signals are used to prove a live human is present at the moment of the ceremony, and that it is the same person as before. The recording itself is not kept by us. A face template (numbers, not a picture) IS kept and enrolled against the person's record; that is how the next verification recognises them. Nothing else about the face is stored: no photo, no recording, no written description. The recording is checked by outside verification providers; how long they hold it is being confirmed and is not claimed here. A person can ask for their stored template to be deleted.

## Compliance roadmap (honest)
SOC 2 Type II and GDPR Article 25 (data protection by design) are planned for Q4 2026 — not claimed today. The architecture is designed to achieve them; the audit has not been performed.
