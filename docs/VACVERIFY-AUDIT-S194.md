# VACVerify Primitive Audit — S194

Audit-only lane (`task-s194-vacverify-audit`). No production code was changed. Research and the
market/standards survey live in
[docs/packets/PKT-S194-VACVERIFY-AUDIT.md](packets/PKT-S194-VACVERIFY-AUDIT.md); read that first for
the "why" behind the adopt/extend/build call and the standards line in §6 below.

**Question asked (Rob, 18 Sep 2026):** is the code structured so ONE primitive, driven by COPS/PID
attributes, serves every assurance level with one UI/codebase — or did a fix for one modality (hand
gesture) land for some entry points and not others?

**Answer, in one line:** the primitive (`VACReauth.run` in `vac-reauth-ceremony.js`, backed by the
shared `window.FingerDetector` / `window.VacFaceEmbed` modules) is real, is architecturally sound, and
does correctly propagate policy-driven modality selection to every caller that uses it — **but three
call sites bypass it entirely**, and one of those three is exactly the hand-gesture case Rob described:
a real, dated, two-commit gesture-threshold fix (F-766/F-766b, 13 Jul 2026) landed only in the shared
module and never reached the bespoke re-auth path used by every "copilot" app (`vac-auth.js`'s own
quick-reauth).

The athena buildspec (`S117-VACVERIFY-PRIMITIVE-BUILDSPEC.md`) was unreachable (404; see packet §6) —
this audit is built from `vac-reauth-ceremony.js`'s own extensive in-code documentation of the COPS/PID
design (it independently states the same intent: "`profile` is the COPS/PID policy actuator",
`vac-reauth-ceremony.js:18`; "PHASE COMPOSITION IS A COPS/PID OUTPUT, not a local flag",
`vac-reauth-ceremony.js:395`), commit history, and `HANDOFF.md`.

---

## 1. Entry-point → code-path map

| Entry point (live page) | Code path | `context` / `riskLevel` / `profile` | Citation |
|---|---|---|---|
| **auth.html — full auth** (first-time identity, or seal-gate second full auth) | **PRIMITIVE** — `VACReauth.run`, `MODE_CONFIG.full` | `context:'register'`, `riskLevel:'medium'` (hardcoded literal), `profile: _sealGateProfile` — `null` normally, `{greeting:'skip'}` only when the URL carries `?greeting=skip` | `auth.html:898-909`, decision at `auth.html:891-897` (F-635) |
| **auth.html — quick re-auth** | There is **no separate "quick" branch inside auth.html** — the only fork is the `profile.greeting` axis above, still running the FULL `MODE_CONFIG`. A prior `?mode=copilot` bespoke boot path was explicitly removed (comment: "F-563 restore: mode=copilot boot path removed — normal + iframe (tribunal embed) now run the single guided flow") | n/a | `auth.html:1781-1783` |
| **vat-verify.html — credential reveal** | **PRIMITIVE** — `VACReauth.run`, `MODE_CONFIG.fast` | `context:'vat-verify-reveal'`, `riskLevel:'low'`, `profile:{mode:'fast'}` | `vat-verify.html:1409-1421` |
| **tribunal-demo.html — "tribunal seal" / view-credential** | **PRIMITIVE** — `VACReauth.run`, `MODE_CONFIG.fast` | `context:'tribunal-view-credential'`, `riskLevel:'low'`, `profile:{mode:'fast'}` | `tribunal-demo.html:1725-1733` |
| **financial-demo.html — view credential** | **PRIMITIVE**, but see **VD-02** | `context:'tribunal-view-credential'` (copy/paste — same literal as tribunal-demo.html, not relabeled), `riskLevel:'low'`, `profile:{mode:'fast'}` | `financial-demo.html:1245-1251` |
| **decision-receipt.html — "Continue to confirm your decision" live check** | **ROUTES TO auth.html** via an overlay iframe (`src='/auth.html?reauth=1'`), success returned by `postMessage('vac-auth-success')` — same FULL primitive as row 1, not a fourth implementation | `decision-receipt.html:350,357,374`; hand-back documented at `auth.html:1166-1184` (S194 F-1403, commit `9ce4968`) |
| **demos.html (index)** | Pure link index — no ceremony code | `demos.html:44-58` |
| **pharma-demo.html** | **ROUTES TO auth.html** via iframe overlay (`VERIFY_SRC='/auth.html'`), explicit comment it reuses "the same live, multi-modal biometric ceremony financial-demo and tribunal-demo run" | `pharma-demo.html:364,535,611` |
| **trusted-water-demo.html** | **ROUTES TO auth.html** via full-page navigation (`location.assign('/auth?return=/trusted-water-demo')`) — iframe avoided on purpose (F-819a, iOS/macOS blank-iframe bug) | `trusted-water-demo.html:680` |
| **clinical-demo.html / control-demo.html** | Not ceremony entry points — narrative walkthrough / API-driven approval simulation, no biometric check | n/a |
| **vac-auth.js — quick re-auth** (used by every "copilot" app that embeds `vac-auth.js`: athena-dad.html, athena-my.html, athena-hub.html, athena-shan.html, athena-derm-copilot.html, athena-regatta-club-copilot.html, grant.html) | **BESPOKE COPY — see VD-01** | No `riskLevel`/`profile`/COPS-PID concept at all — single static server-issued finger count, no policy object | `vac-auth.js:918` `_renderQuickReauthScreen`, `:986` `_handleReauthCapture` |
| **vac-auth.js — first/full auth** | Not a copy — redirects to `/auth?mode=copilot` (defers to row 1's primitive) | `vac-auth.js:699-704` |
| *(repo-wide discovery, not in the audit's writable scope, cited for completeness)* **dashboard.html — "Test Re-auth"** | **BESPOKE COPY — see VD-03a** | Own capture, own endpoint family (`/v1/session/quick-challenge`, `/v1/session/quick-verify-image`, `/v1/session/quick-verify`), no reference to `VACReauth`/`FingerDetector`/`vac-auth.js` anywhere in the file | `dashboard.html:171-360`; predates unification (`git log --follow -S startQuickReauth` → `2377f91`, pre-S117) |
| *(same caveat)* **athena-regatta-club-copilot.html — "Confirm with face ID"** | **NOT a verification at all — see VD-03b** | `getUserMedia` + `setTimeout` theater, no server call, branded "VAC Protocol biometric verification" | `athena-regatta-club-copilot.html:970-1000` |

`vac-verify.js` (the third-party embeddable `VACVerify` widget, `assuranceLevel:'L1'/'L2'/'L3'`,
`vac-verify.js:40`) is a different product for external integrators and does not call
`vac-reauth-ceremony.js`; it is out of scope for "entry points on the live pages" but is noted in the
packet as a second place the level/modality idea is expressed independently.

---

## 2. Modality fix history since S111 (commits since 2026-06-16) and which entry points received them

### Gesture (hand/finger)

| Fix | Where it landed | Entry points that got it | Entry points that did NOT |
|---|---|---|---|
| **F-766 / F-766b** (`918bf07`, `5288b2b`, both 2026-07-13): `THUMB_SPREAD_MIN` 0.62→0.50→0.42, `THUMB_BEND_MAX` 40°→45°→48° — Rob live-diagnosed a genuine open 5-finger hand reading as 4 (false-deny) | `vac-finger-detect.js:180-181,196` (module extracted at `e6fc7d5` as "single source of truth") | auth.html (full), vat-verify.html, tribunal-demo.html, financial-demo.html (all via `VACReauth.run` → shared `FingerDetector`); `finger-test.html` and `reauth-count-test.html` (both load `/vac-finger-detect.js` directly) | **`vac-auth.js`'s quick-reauth (`_renderQuickReauthScreen`/`_handleReauthCapture`, `vac-auth.js:918-1050`)** — confirmed zero references to `FingerDetector` anywhere in `vac-auth.js` (`grep -n FingerDetector vac-auth.js` → no output). It captures one raw JPEG frame and trusts server-side Gemini finger-counting exclusively. `git log --since=2026-06-16 --oneline -- vac-auth.js` shows exactly one relevant commit (`d490cc2`, face-embedding identity match) — no finger-count fix of any kind. → **VD-01** |
| Finger-count hysteresis, F-613 (`f69120b`, `f4bd043`, 2026-06-25): `HYST_CHANGE_FRAMES`/`HYST_CLEAR_FRAMES`/`HYST_SETTLE_FRAMES` | `vac-finger-detect.js:34-58` | Both `MODE_CONFIG.full` and `.fast` inside `vac-reauth-ceremony.js` call the same `FingerDetector.detect()`/`feedStable()` — confirmed shared, no divergence (`vac-reauth-ceremony.js:4749-4762` FULL loop; FAST tier's `_cooccurAdvanceDecision`, `vac-reauth-ceremony.js:5924`, explicit comment "Shared so the LIVE full path and the FAST tier define 'may advance' identically") | none found |
| `_handNearFaceZone` gesture-zone geometry | `vac-reauth-ceremony.js:1313` | Called identically from FULL detect loop (`:4762`), FAST pre-flight coaching (`:1933`), capture/evidence upload (`:5059`, `:6424`, `:6525`) — one function | none found |

**F-766/F-766b is the exact instance of the pattern Rob described.** It is also self-documented as an
open gap by its own author: the F-766 commit message states *"whether Gemini (server gate) also
under-counts — F-765 harness should own this; manual threshold reason for now."* No F-765 harness
commit exists in the repo, and no subsequent commit touches `vac-auth.js`'s finger path.

### Voice

`task-644` (`9f82e8b`, 2026-08-06) RMS-unit fix: commit message states "All three RMS sites updated
consistently: digit VAD tick, phrase VAD tick, fast/quick-reauth VAD... FAST_VAD_* constants mirrored."
Verified: `FAST_VAD_SPEECH_RMS = 0.085` (`vac-reauth-ceremony.js:5974`) carries the comment "mirrors
VAD_SPEECH_RMS_FALLBACK", and `VAD_SPEECH_RMS_FALLBACK` (`vac-reauth-ceremony.js:4091`, full path)
changed in the same commit. **No divergence** between FULL and FAST voice thresholds — this is the
positive control showing the shared-primitive discipline works when a fix touches only
`vac-reauth-ceremony.js`. It does **not** reach `vac-auth.js`'s quick-reauth or `dashboard.html`, but
neither of those paths has a voice modality at all, so there is no divergence to name (n/a, not VD).

### Face

`vac-face-embed.js` (client-side face-api.js embedding) is shared by `vac-auth.js`'s `_ensureFaceEmbed`
(`vac-auth.js:898-916`) and `face-embed-test.html:109`. `vac-reauth-ceremony.js`'s FULL/FAST tiers do
NOT use `vac-face-embed.js` at all — face liveness/identity there is judged server-side (Gemini) from
the uploaded clip/still, per `MODE_CONFIG`'s `capture.kind` (`clip` for full, `still` for fast). This is
a **structural difference, not a divergence in the audited sense**: no client-side face fix has been
made to one path and skipped in the other in the commit window — the two paths use face verification at
different layers (client embedding vs server Gemini) by design, and no evidence of a fix landing in one
without the other was found (`git log --since=2026-06-16 --oneline -- vac-face-embed.js` was checked;
its only commits are the original extraction and unrelated to the reauth-ceremony's face gate).

### Digits (bound/spoken digit)

`reauthPolicyRequired()`/`reauthPolicyDropsVoicePhrase()` (`vac-reauth-ceremony.js:410-437`) are the
single source for whether a digit is bound (shown+said) or voice-only, read identically by full, fast,
and seal-gate contexts (comment: "same code, different policy, NO fork", `vac-reauth-ceremony.js:6259`).
`digit gate: min 200 ms + content_gate_miss sensor (S173)` (`3df5967`) touches the shared digit-gate
function used by both tiers — no divergence found. `reauth-count-test.html` exercises the
`profile.num_digits` actuator end-to-end against the same `VACReauth.run` call as production
(`reauth-count-test.html:222-225`), so this modality's test bench is representative of the live path,
unlike the gesture case in `vac-auth.js`.

---

## 3. What actually selects the level today — COPS/PID vs hard-coded

Two separate axes exist in the code, and only one of them is genuinely policy-driven:

- **Which *modalities* are required** — genuinely COPS/PID-driven. `challengeData.reauth_modality_policy`
  arrives from the server in the challenge response (`vac-reauth-ceremony.js:396-430`) and
  `reauthPolicyRequired()` is the single read site every phase-composition decision defers to
  (`vac-reauth-ceremony.js:3202,3869,3904,5710,6255-6280`, all commented "F-654… COPS/PID"). Regression
  guard: absent/malformed policy defaults to the full modality set (`vac-reauth-ceremony.js:405-409`),
  so a COPS/PID outage fails toward MORE verification, not less.
- **Which *risk_level* (the COPS/PID input, not output) is sent** — **hard-coded per call site today.**
  `grep -n riskLevel` across every caller shows a string literal, not a computed value:
  `auth.html:900` → `'medium'`; `vat-verify.html:1412` → `'low'`; `tribunal-demo.html:1728` → `'low'`;
  `financial-demo.html:1248` → `'low'`; `reauth-count-test.html:223` → `'medium'`. No call site computes
  `riskLevel` from a transaction amount, decision severity, tribunal case class, or any other runtime
  signal — it is a static property of *which page you're on*, not of *what you're about to do*. → **VD-04**
  (not a bug — the code that consumes `risk_level` server-side may still vary policy by other request
  context the repo can't see — but as far as this repo's client code goes, there is no dynamic
  assurance-level selection, only a per-page constant).
- `vac-auth.js`'s quick-reauth (VD-01) has **no `risk_level`/`profile` concept whatsoever** — it isn't
  wired to COPS/PID in any form, input or output.

---

## 4. Divergences found (VD-NN)

- **VD-01 (primary — matches Rob's description exactly).** Gesture-threshold fix F-766/F-766b
  (`918bf07`, `5288b2b`, 2026-07-13, `vac-finger-detect.js:180-181`) fixed a false-deny "natural 5 reads
  as 4" bug for every entry point built on `window.FingerDetector`. `vac-auth.js`'s quick-reauth
  (`vac-auth.js:918-1050`, used by every copilot app: athena-dad/-my/-hub/-shan/-derm-copilot/-regatta-club-copilot.html,
  grant.html) shares zero code with `vac-finger-detect.js` and never received an equivalent check, a
  gap its own fixing commit flagged and left open (see §2).
- **VD-02.** `financial-demo.html:1250` passes `context:'tribunal-view-credential'` — the literal
  copied from `tribunal-demo.html:1729` rather than a `financial-`-specific label. Not a functional bug
  (the primitive doesn't branch on this string beyond telemetry/copy), but it means any
  telemetry/analytics keyed on `context` currently can't distinguish financial-demo credential views
  from tribunal-demo ones.
- **VD-03a.** `dashboard.html:171-360` is a third, independent re-auth implementation
  (`showQuickReauth`/`startQuickReauth`/`captureAndVerify`/`manualFingerFallback`) against its own
  endpoint family, predating the S117 unification effort and never migrated. Any ceremony-side fix
  (gesture, voice, digit) is structurally unreachable from this file.
- **VD-03b.** `athena-regatta-club-copilot.html:970-1000` (`faceVerify`) performs no verification at
  all — camera-permission theater with a hardcoded success after two `setTimeout`s, labeled "VAC
  Protocol biometric verification." This is not a fix-propagation gap, it's a fabricated result sharing
  the brand name; flagged because it means a "fix reaches every level" audit must also check whether an
  entry point does real verification at all.
- **VD-04.** `riskLevel` (the COPS/PID *input*) is a hard-coded per-page string literal at every current
  call site (`auth.html:900`, `vat-verify.html:1412`, `tribunal-demo.html:1728`,
  `financial-demo.html:1248`, `reauth-count-test.html:223`) — see §3. Not a "fix didn't propagate" bug
  like VD-01/03, but directly answers the audit's framing question: today no entry point actually
  *drives* its assurance level from a COPS/PID risk signal; each just declares a fixed level for its
  page.

---

## 4a. Cross-check against ISO/IEC 30107-3 vocabulary

VD-01 is, in PAD terms, a presentation-attack **false-reject** on the *bona fide* population for one PAI
species (open-hand gesture) — the standard's BPCER metric — that was corrected in the shared detector
but left unverified in a structurally separate capture path. No accredited PAD test run exists in this
repo to produce an actual BPCER/APCER number for either path (see packet §2 item 1); the F-1139 harness
is a source-anchored logic mirror, not a PAI-species test matrix.

---

## 5. Harness (F-1139) coverage matrix

Repo has **no `package.json`**; tests run directly via `node --test tests/<name>.test.js` (Node test
files) or `npx playwright test tests/<name>.pw.js` (Playwright), per the CI workflow files under
`.github/workflows/`. There is no single "run everything" command.

Entry points named in the audit's scope × modality × level, "✓" = at least one test file exercises that
cell (file names in the note below), "—" = no test found:

| Entry point | face·full | face·fast | voice·full | voice·fast | gesture·full | gesture·fast | digits·full | digits·fast |
|---|---|---|---|---|---|---|---|---|
| Full-auth ceremony (`MODE_CONFIG.full`) | ✓ | — | ✓ | — | ✓ | — | ✓ | — |
| Fast/quick-reauth ceremony (`MODE_CONFIG.fast`) | — | — | ✓ | — | ✓ | — | ✓ | — |
| Tribunal seal (tribunal-demo.html) | — | — | — | — | — | — | — | — |
| vat-verify reveal (vat-verify.html) | — | — | — | — | — | — | — | — |
| decision-receipt confirm-forwarded live check | — | — | — | — | — | — | — | — |
| **vac-auth.js bespoke quick-reauth** | — | — | — | — | — | — | — | — |

Notes:
- The populated cells are backed by shared-helper tests, not per-entry-point tests: e.g.
  `tests/zone-geometry.test.js`, `tests/ceremony-conformance.test.js`, `tests/confirmed-behaviors.test.js`
  (gesture), `tests/mic-voiced-run.test.js`, `tests/greeting-gate-margins.test.js`,
  `tests/mic-cold-start.test.js`, `tests/mic-starved-fallback.test.js`, `tests/vad-replay.test.js`,
  `tests/voice-content-gate.test.js` (voice), `tests/voice-content-gate.test.js`,
  `tests/prompt-state.test.js` (digits). They test `vac-reauth-ceremony.js`'s shared logic once, which
  is why full and fast look similarly covered for voice/gesture/digits — both tiers call the same
  functions.
- **Four of the six named entry points have zero test coverage in any modality/level**: tribunal seal's
  own gate functions (`sealReauthGate`/`authorizeSeal`/`mintMatterToken`, tribunal-demo.html ~1199-1212),
  vat-verify's `revealCredential()` (vat-verify.html:1323), decision-receipt's live-check handoff, and
  **`vac-auth.js`'s bespoke quick-reauth is untested even though it is the one entry point proven to have
  an unfixed divergence (VD-01)**. `tests/user-journey.pw.js` and `tests/ceremony-selftest.pw.js` check
  page-load/navigation/pin-parity for these pages, not the biometric gate logic inside them.
- `tests/grant-page.test.js` covers `grant.html`'s expiry/renewal narration, not `vac-auth.js`'s
  internal quick-reauth state machine that `grant.html` also loads.

---

## 6. Unification slice — smallest packet to close VD-01/02/03/04

**Scope:** route `vac-auth.js`'s quick-reauth through the same primitive everything else uses, fix the
one label typo, and make `riskLevel` an explicit (even if still simple) input rather than a silent
per-page constant. In priority order (VD-01 is the one Rob asked about and should ship alone if the
packet gets split further):

1. **VD-01 fix.** Replace `vac-auth.js`'s `_renderQuickReauthScreen`/`_handleReauthCapture`
   (`vac-auth.js:918-1050`) with a call to `VACReauth.run({..., context:'copilot-quick-reauth',
   riskLevel:'low', profile:{mode:'fast'}, mount})`, mounted into the copilot host page the same way
   `financial-demo.html`/`tribunal-demo.html` do it (modal overlay, not a page redirect — copilot apps
   need to stay on their own page). This is the change that makes any future `vac-finger-detect.js` fix
   reach every copilot app automatically.
2. **VD-02 fix.** `financial-demo.html:1250` → `context:'financial-view-credential'`.
3. **VD-03a/b.** Not a code fix in this slice — flag `dashboard.html` and
   `athena-regatta-club-copilot.html`'s `faceVerify` for a follow-up decision (retire vs migrate vs
   relabel as a demo-only mock, since VD-03b currently claims real verification it doesn't perform).
4. **VD-04.** Make `riskLevel` a required, explicit argument documented per call site as "why this page
   is low/medium" (already true in comments — `// credential-reveal = low-value action → fast tier` —
   promote that comment to the buildspec so a future page author has to make the same judgment call
   explicitly rather than copy-pasting a literal, which is exactly how VD-02 happened).

**Acceptance criteria for the slice:**
- Every page that performs biometric re-authentication anywhere in the repo calls `VACReauth.run`. A
  repo-wide grep for `getUserMedia`/finger-count/face-match logic outside `vac-reauth-ceremony.js`
  returns zero hits, except `vac-auth.js`'s `_startCamera`/`_stopCamera` (kept as camera helpers only,
  with no capture-and-verify logic of their own) and `vac-verify.js` (excluded — different product,
  third-party embed).
- `vac-auth.js` has zero lines matching `/v1/auth/face-reauth\b/` (the bespoke endpoint) after the
  change — confirms the old path is fully removed, not dual-run.
- A new test file (source-anchored, same pattern as `tests/mic-voiced-run.test.js`) asserts
  `vac-auth.js` references `VACReauth.run` and does NOT define its own finger/face capture-and-verify
  function — this is exactly the xfail test added in this lane (§7) flipped to a real pass.
- `financial-demo.html`'s `context` argument is unique per demo (no two demo pages share a literal).
- One F-1139 fixture is added per entry point currently at zero coverage (tribunal seal, vat-verify
  reveal, decision-receipt live-check, and the now-unified copilot quick-reauth) so the harness matrix
  in §5 has no all-empty row for a live entry point.

---

## 7. Tests added this lane

Per the dispatch's audit-only constraint, two source-anchored `node --test` files were added under
`tests/`, both marked `{ todo: true }` (Node's xfail-equivalent — the assertion runs and its failure is
reported without failing the suite) and named for the VD they document. Both fail today by design and
will start passing once the unification slice (§6) ships:

- `tests/vd-01-gesture-primitive-parity.test.js` — asserts `vac-auth.js` references `FingerDetector`/
  `VACReauth`. Fails today (zero references, per §2/§4).
- `tests/vd-04-risklevel-not-hardcoded.test.js` — asserts no `*.html` call site assigns `riskLevel` a
  bare string literal to `VACReauth.run`. Fails today for all five current call sites (§3/§4).

No file outside `tests/` and the two docs above was modified.

---

## 8. STANDARDS line

See packet §5 for the full reasoning. Two lines for Rob: (1) **extend** — turn the F-1139 harness's
"ISO/IEC 30107-3 aligned" description into an actual PAI-species APCER/BPCER matrix; (2) **adopt** — map
`risk_level` and `reauth_modality_policy` onto NIST 800-63B's AAL1-3 vocabulary in the buildspec. Neither
is an IETF/RFC-draft or patent-extension candidate; both are internal-standard-alignment decisions,
not protocol-interop ones.
