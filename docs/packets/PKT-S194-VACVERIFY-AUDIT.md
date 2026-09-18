# PKT-S194-VACVERIFY-AUDIT — research packet

Lane: `task-s194-vacverify-audit` (audit-only, no production code changes). Companion deliverable:
[docs/VACVERIFY-AUDIT-S194.md](../VACVERIFY-AUDIT-S194.md).

## 1. Internal exists-audit (what primitives already exist)

Read/grepped in full: `vac-auth.js` (1466 lines), `vac-verify.js` (539 lines),
`vac-reauth-ceremony.js` (9039 lines), `auth.html` (1865 lines), `finger-test.html`,
`face-embed-test.html`, `reauth-count-test.html`, `HANDOFF.md`. Repository-wide read-only grep used
to enumerate callers (discovery only, per dispatch — no edits outside the writable set).

| Primitive | File:line | Role |
|---|---|---|
| `window.VACReauth.run(opts)` | `vac-reauth-ceremony.js:16` (JSDoc), export tail `~8864` | THE shared ceremony: face+voice+gesture+digits, `MODE_CONFIG.full`/`.fast` (`vac-reauth-ceremony.js:124-160`) selects endpoints/capture kind per call site, not an if/else fork |
| `reauthPolicyRequired()` | `vac-reauth-ceremony.js:424` | Single source for "what modalities does the current challenge require" — reads `challengeData.reauth_modality_policy.required`, a server (COPS/PID) output |
| `reauthPolicyDropsVoicePhrase()` | `vac-reauth-ceremony.js:410` | Policy-driven phase composition; defaults to `true` (keep phrase) when policy absent — explicit regression guard, `vac-reauth-ceremony.js:405-409` |
| `window.FingerDetector` | `vac-finger-detect.js` (extracted `e6fc7d5`, "single source of truth") | Real-time MediaPipe hand-gesture math; shared by `vac-reauth-ceremony.js` (both tiers), `finger-test.html`, `reauth-count-test.html` |
| `window.VacFaceEmbed` | `vac-face-embed.js` | face-api.js 128-D embedding; shared by `vac-auth.js` (`_ensureFaceEmbed`, line 898) and `face-embed-test.html` |
| `vac-auth.js` quick-reauth | `vac-auth.js:918` `_renderQuickReauthScreen`, `:986` `_handleReauthCapture` | A SEPARATE, bespoke re-auth ceremony — single JPEG frame + static "hold up N fingers" copy, verified server-side only (`POST /v1/auth/face-reauth`). **Does not call `window.FingerDetector` or `VACReauth.run`** — confirmed by `grep -n FingerDetector vac-auth.js` returning zero hits. This is the primary duplicate identified (see VD-01 in the audit doc). |
| `vac-auth.js` first/full auth | `vac-auth.js:672` `_renderFaceScreen` | NOT a third copy — redirects to `/auth?mode=copilot`, i.e. defers to the shared primitive via `auth.html` |
| `VACVerify` widget | `vac-verify.js` | Third-party embed SDK (`assuranceLevel: 'L1'/'L2'/'L3'`, `vac-verify.js:40`) — a DIFFERENT product (external sites embed this to call the VAC API directly); not wired to `vac-reauth-ceremony.js` at all. Out of the unification question because it targets external integrators, not vac-web's own ceremony pages, but its `assuranceLevel`/`modalities` config duplicates the same three-axis idea (level × modalities) as COPS/PID — flagged for awareness, not as a VD.

Also found repo-wide (read-only discovery, not in the writable file list, cited for completeness):
- `dashboard.html:171-360` (`showQuickReauth`/`startQuickReauth`/`captureAndVerify`/`manualFingerFallback`) — a THIRD independent re-auth implementation, hitting `/v1/session/quick-challenge`, `/v1/session/quick-verify-image`, `/v1/session/quick-verify` (distinct endpoint family from both `VACReauth.run`'s fast tier and `vac-auth.js`'s `/v1/auth/face-reauth`). Predates the reauth-unify effort (`git log --follow -S startQuickReauth` → `2377f91`, pre-S117) and was never migrated.
- `athena-regatta-club-copilot.html:970-1000` (`faceVerify`) — client-only `setTimeout` theater with no server call at all, branded "VAC Protocol biometric verification" — not a verification primitive, a fabricated result.

Conclusion: the shared primitive (`VACReauth.run` + `FingerDetector` + `VacFaceEmbed`) already exists and is architecturally sound (`MODE_CONFIG` map, policy-driven phase composition) for the pages that use it. The audit doc's job is to name every entry point that does NOT use it.

## 2. Grounded external survey (≤90 days where available)

1. **ISO/IEC 30107-3:2023 — Biometric presentation attack detection, Part 3: Testing and reporting.**
   https://www.iso.org/standard/79520.html — canonical standard, accessed 2026-09-18 (no 2026-specific
   revision found; 2023 edition is current). Defines APCER/BPCER/IAPMR metrics and PAI-species testing
   methodology. The repo's own comments describe the F-1139 harness as "ISO/IEC 30107-3 aligned" — the
   harness is a source-anchored Node mirror of gate logic (see `tests/mic-voiced-run.test.js` header),
   not an accredited PAD test lab run; it does not currently report APCER/BPCER. **Adopt the vocabulary
   and the levels-1/2/3 framing for the unification slice's acceptance criteria; do not claim
   conformance without an actual PAI-species test matrix.**

2. **"AI-Powered Adaptive Authentication and Behavioral Biometrics: The Enterprise Guide 2026"** —
   Security Boulevard, 2026-03, https://securityboulevard.com/2026/03/ai-powered-adaptive-authentication-and-behavioral-biometrics-the-enterprise-guide-2026/
   (source article: guptadeepak.com, same date). Describes the current market pattern: an orchestration
   layer sits between apps and identity providers, evaluates contextual risk signals, and selects
   verification strength dynamically — i.e., exactly the COPS/PID → `reauth_modality_policy` →
   `VACReauth.run` shape this repo already has in the server contract. **What we adopt**: the framing
   that risk *level* and modality *selection* should be two separable decisions (this repo already
   separates them — `riskLevel` in, `required` modalities out — see audit doc §3). **What we reject**:
   full third-party orchestration platforms (Beyond Identity, Strata) — out of scope for a
   patent-bearing first-party ceremony; the gap here is internal wiring (one entry point not calling
   the primitive), not a missing orchestration layer.

3. **"Top Open-Source Authorization Tools for Enterprises in 2026"** —
   https://www.permit.io/blog/top-open-source-authorization-tools-for-enterprises-in-2026 (2026),
   surfacing Open Policy Agent (OPA) / OPAL as the standard OSS policy-decision layer. Cross-checked
   with a direct GitHub topic search (`face-authentication`, `biometric-authentication`,
   `face-liveness`, accessed 2026-09-18) which surfaced only single-modality components (face-only
   SDKs, liveness-only detectors) — **no OSS project found that unifies face+voice+gesture+digit
   capture under one policy-driven function**, confirming the "build" decision below for the capture
   layer. OPA/OPAL themselves are a plausible substrate for the COPS/PID *decision* layer specifically
   (see STANDARDS OPPORTUNITY in the audit doc) but were not evaluated for adoption in this lane
   (audit-only, no code changes).

4. **NIST SP 800-63B (Digital Identity Guidelines, Authentication and Lifecycle Management)** —
   canonical reference, https://pages.nist.gov/800-63-3/sp800-63b.html, accessed 2026-09-18 (search for
   a 2026-specific revision returned no dated update; treated as canonical, not current-dated). Defines
   Authenticator Assurance Levels (AAL1-3) as the standard vocabulary for "assurance level" — the repo's
   `riskLevel: 'low'/'medium'` strings are an informal two-point scale with no stated mapping to AAL.
   Flagged under STANDARDS OPPORTUNITY in the audit doc.

## 3. Adopt / extend / build decision

**Decision: EXTEND the existing internal primitive; do not adopt an external framework.**

Reason: no external candidate (survey items 2-3) unifies capture across face/voice/gesture/digit with
a policy-driven level the way `VACReauth.run` + `MODE_CONFIG` + `reauthPolicyRequired()` already do for
the entry points that call it. The actual gap is not "we lack a primitive" — it is "three entry points
(`vac-auth.js`'s bespoke quick-reauth, `dashboard.html`'s independent re-auth, and one copy/paste
context-label bug in `financial-demo.html`) don't call the primitive that already exists." The
unification slice in the audit doc (§5) is therefore a routing fix, not a new build.

## 4. Abstraction (L-690: substrate-replaceability)

The interface application code should import — and already partially does — is:

```
VACReauth.run({ email, name, riskLevel, mount, context, profile, onComplete, onFallback, onBack, onStep, auto })
```

`vac-reauth-ceremony.js` is itself the one adapter file for the capture substrate (MediaPipe
HandLandmarker via `vac-finger-detect.js`, face-api.js via `vac-face-embed.js`, the Railway VAT API via
`MODE_CONFIG`'s `url()`/`buildBody()` functions). Swapping the hand-tracking library, the face-embedding
model, or the backend host means editing `vac-finger-detect.js`, `vac-face-embed.js`, or
`MODE_CONFIG.{full,fast}` respectively — never a caller. This already holds for auth.html, vat-verify.html,
tribunal-demo.html, financial-demo.html. It does NOT hold for `vac-auth.js`'s quick-reauth (own capture,
own endpoint, no adapter) or `dashboard.html` (same). The unification slice's job is to make those two
call the same interface instead of re-implementing the adapter.

## 5. STANDARDS OPPORTUNITY (decision for Rob)

Two independent standards questions surfaced:

- **PAD testing (ISO/IEC 30107-3):** the F-1139 harness already borrows the standard's vocabulary but
  is a source-anchored Node mirror, not an APCER/BPCER-reporting lab run. Opportunity: **extend** —
  formalize the harness's fixtures into an explicit PAI-species matrix (photo, video-replay, mask,
  deepfake) with APCER/BPCER numbers per modality, so "ISO/IEC 30107-3 aligned" becomes a testable claim
  rather than a description.
- **Assurance-level vocabulary (NIST 800-63B AAL1-3):** `riskLevel` today is an ungoverned two-value
  string (`'low'`/`'medium'`) picked per call site (see audit doc §3) with no `'high'`/AAL3 value in use
  anywhere in the repo and no code path that computes it dynamically. Opportunity: **adopt** — map the
  existing `risk_level` input and the COPS/PID-returned `reauth_modality_policy` output onto AAL1-3
  terms in the buildspec, which would also make the patent-bearing "adaptive modality" claims
  (`vac-auth.js:12`, "Patent claims: 1-15 (biometric binding), 16-38 (adaptive modality)") easier to
  defend against a recognized external yardstick. Neither is an IETF/RFC-draft candidate — both are
  internal-standard-alignment moves, not protocol-interop moves. **This is a decision for Rob, not
  auto-applied.**

## 6. Spec source note

The dispatch names `https://raw.githubusercontent.com/VioletShores/athena/main/docs/strategic/S117-VACVERIFY-PRIMITIVE-BUILDSPEC.md`
as the primitive's buildspec. Fetched via `WebFetch` (2026-09-18): **HTTP 404**. Confirmed the repo
itself is not publicly reachable either (`gh`/`curl` against `api.github.com/repos/VioletShores/athena`
→ 404; unauthenticated search → 401) — the athena repo is private or does not exist under that path from
this environment, and it is not checked out locally. Per the dispatch's fallback instruction, this audit
is built entirely from `vac-web`'s own code, comments (which independently document the COPS/PID design
intent in detail — see `vac-reauth-ceremony.js:16-19`, `:395-430`), and `HANDOFF.md`, with this fetch
failure noted rather than silently skipped.
