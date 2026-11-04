# VAC owner identity: reliable biometric capture + optional real-world identity proofing

**Owner decision:** 4 November 2026. **State:** ARCHITECTURE DESIGN / no release or assurance-class upgrade authorised. **Workstream:** existing vac-web draft PR #46; VAC backend independent security review; separate Athena identity/authority bridge. **Original user requirement:** "You can't have face identification being that sensitive based on whether a hand was next to the face or not" and identity could optionally be matched to a passport, national identity card, digital ID or trusted third-party verifier.

## 0. Distinct trust questions (never collapse into one VAC 'verified' badge)

1. **Claimed identity:** name/email the user supplied; email OTP establishes mailbox control, not civil identity, biometric presence, authority or document validity.
2. **Real-world identity proofing:** evidence that the asserted named person exists and belongs to the presenter, e.g. document authentication + portrait match, chip/MRZ or signed identity assertion. A manual/automated document image comparison is NOT by itself certification, independent issuer verification or NIST IAL2/IAL3.
3. **Current authentication / continuity / liveness:** a returning user matches an existing enrolled person template under a fresh, challenge-bound ceremony; "AAL3" is existing internal product terminology and does NOT assert NIST AAL3 certification. The full face/voice/finger challenge authenticates a live subject, not a legal name.
4. **Delegated authority:** independently corroborated current organisation / role / action-class rights. A passport holder is not automatically a clinician, procurement signatory or Vault key owner.
5. **Action admission:** requirements are a conjunction, not a max or blended score: verified identity proofing class >= required IAL, current auth ceremony >= required AAL, actual role/permission for this resource, current nonrevoked user/device/tenant binding, freshness. A stronger biometric cannot repair a missing identity-proofing class, and a verified passport does not authorise actions.

**Tier vocabulary:** use separate `identity_proofing_class` (unverified/peer-vouched/self-document-presented/provider-verified/federated-verified), `authentication_assurance`, `authority_scope`, `verification_method`, `fresh_until`, `issuer/trust_framework` and `evidence_digest`. Vouching is corroboration and does not magically confer certified identity proofing. Map these internally defined classes to NIST IAL only after evidence of actual standard-compliant processes. No "passport VERIFIED" unless independent document and holder verification completed.

## 1. Observed owner VAC failure: acquisition is too brittle

- FULL `vac-reauth-ceremony.js:onRecordingComplete()` samples a 128-D face identity descriptor from up to three frames only after the LAST gesture. Earlier `beginRecording()` already captures a bound face still around 800ms after recording starts for Didit passive liveness. That was not used as the main identity vector.
- Earlier video preview freeze may have forced repeated copies of a bad frame; #46 fixed preview state. #46 also fixed misleading endless Processing spinner and now differentiates no_face / multiple_faces / model timeout / engine error. These are **presentation/timing mitigations**, not high-assurance end-to-end redesign. Real iPad acceptance not verified.
- `vac-face-embed.js` currently uses an unverified face-api.js 128-D model (1.7.15). Its current 0.5 identity-distance threshold and anti-spoof ROC were **not validated on real genuine/impostor iPad captures**, per `vac-protocol/docs/debug/D-CONTINUITY-ROOTCAUSE.md`.
- Critical historical risk: a prior full ceremony could overwrite an enrolled person's stored template based only on their email claim, so backend must ensure identity continuity **before** minting VAT and before overwriting any face reference, never rely on frontend-only checks.

## 2. Redesign the full ceremony as independent *evidence acquisition* over one session

**Identity window**: during the continuous challenge-bound full recording, provide a calm face-visible preflight and gather a bounded set of genuinely distinct short-lived identity candidate frames (several times during the opening greeting, not the final finger pose). Report quality separately (exactly one face, model available, image not blurred/occluded, sufficient information). Capture is not a pass/fail identity verdict. No requirement to hold fingers away from face throughout the ceremony.

**Action/gesture window**: user can naturally show and speak requested digits; independently assess hand+voice+content challenge. No last-frame identity requirement. Preserve the same continuous recording/nonce and enforce no replay/cross-person mixing.

**Final authority gate**: independently confirm that the chosen face identity evidence is from the SAME live subject as the face(s) seen through the recording and bound to the fresh challenge, *not merely an arbitrary client-supplied embedding*. Validate quality and the server's stored template match. Missing or mismatching evidence always denies. Identity-mismatch vs image-unavailable vs engine-unavailable must be distinct.

**Recovery**: when face collection has insufficient frames, offer a clear, separate face recapture with minimum user effort **only after a securely designed server-bound continuation/nonce**, otherwise start a new full ceremony. Never silently reuse an older successful frame or lower the match threshold. Never mint Vault AAL3 grant before an accepted, fully linked final server verdict.

**Privacy**: ephemeral video/canvas frames and embeddings destroyed on completion/failure; no raw passport scans/face images/model vectors in logs, GitHub CI artifacts, chats, or enduring localStorage. Server retains only policy-minimum identity references/provenance, with consent, access controls, deletion/revocation; document evidence may require legally mandated retention—explicit exception must be documented and user-visible.

**Tests required before release**: real iPad Safari hand-near-face / hand leaves frame / sunglasses / lighting / camera cold start / 1→2 faces / timeout / concurrent tab / slow model load / paused or ended video / same user / different person / video splice / replay / cross-session rebind. Synthetic DOM tests are useful but NOT evidence of real false-reject or false-accept rates. Validate actual biometric match distribution in a consented and appropriately protected pilot; target measured false rejection while bounding impostor acceptance, demographics and device variance. Independent authentication security review mandatory.

## 3. Optional document/passport assurance (separate project layer, no P0 gating)

**Product decision:** architect first-class optional identity-proofing plugin now; **do not force passport upload as a condition for Anthropic key repair, normal guest document review or everyday WhatsApp onboarding**. An enterprise can choose to require stronger identity proof for specific roles/actions. A person can be authenticated through VAC and still have *identity_proofing_class=unverified*.

Canonical components Athena/VAC must own:
- Risk/policy requirements and types; user consent and channel-independent capture initiation; session/nonce binding; evidence integrity receipts; secure provider callback and verified result normalization; assurance mapping; freshness/expiry/revocation; cross-tenant isolation; audit and user appeal/recovery; delegation and action admission.
- Adapter interface for third-party document validation and portrait verification, national identity cards, electronic passport NFC/chip where permitted, government digital identities, OpenID verified-claims federation. Prefer reputable accredited providers as the issuer/document trust oracle. Do not claim an optical document photo check proves the issuing authority's authenticity.
- Provider-neutral `IdentityEvidenceReceipt` with `subject_ref` (pseudonymous), `claim_scope`, `issuer`, `trust_framework`, `method`, `verified_at`, `expires_at`, `revocation_state`, `evidence_digest`, `session_binding`, `provider_receipt_ref`, `scope` and `reason` (no scans/face vectors in general-purpose receipts).
- Known identity vs current actor binding and lawful account recovery after document loss or changed appearance. Do not overwrite an enrolled biometric without verifying existing owner using safe recovery.

**Standard references:** NIST SP 800-63A-4 (July 2025), identity proofing levels and evidence validation, https://pages.nist.gov/800-63-4/sp800-63a.html ; OpenID Connect for Identity Assurance 1.0 and verified_claims, https://openid.net/specs/openid-connect-4-identity-assurance-1_0-final.html ; published VAC #9 Document Binding claim set in `VioletShores/athena/docs/patents/VAC9-DOCBIND-EXAMINER-VERDICT-S197.md`. Patent filing/claim review ≠ implemented identity-proofing product.

## 4. Implementation and release gates — start in existing PR, no risky shortcut

A. Build a no-provider/no-identity-data contract and failing-first regression cases for "identity acquired before gestures, no last-frame dependence" and for "identity proofing != active auth != authority"; **do not deploy** these before independent review of session binding and threat model.
B. Phase 1: implement bounded early-frame candidate acquisition and exact same-clip binding with explicit browser lifetime, camera quality, client/server fail-close and replay tests; compare with final-frame-only code under synthetic occlusions. No threshold adjustment.
C. Phase 2: end-to-end supervised iPad biometric usability, distinct fail/recover paths, and security red team (including imposter continuity). Require formal reviewed policy before production and owner re-entry.
D. Phase 3: separate provider-neutral real-world identity-proofing adapter and simulated callbacks, with no provider key or personal identity document in source. Choose third-party integration and actual verification only after procurement/data processing/security review.
E. Post-acceptance: secure full Vault store, verify new current-generation Anthropic heartbeat is ALIVE. Do not block the unrelated native Flux project or L0 engineering on optional passport proofing.

**Owner approvals outstanding:** none of this grants merge, deploy, VAC flag change, biometric database migration, production document scan, external verifier contact, or relaxation of AAL3 gates.
