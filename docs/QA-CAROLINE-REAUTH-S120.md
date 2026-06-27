# QA — Caroline VAC Re-auth Workflows (S120 unify-vat-verify)

**Branch under test:** `Schemo512/s120-unify-vat-verify` (HEAD `79ee148`)
**QA branch:** `qa/caroline-reauth-s120`
**Date:** 2026-06-27
**Method:** code root-cause + live backend probes + `/browse` against the live public verifier.
**Scope:** diagnosis only — NO fixes applied. Rob live-tested and found A/B/C below.

> TL;DR: S120 unified `vat-verify` + `tribunal` view-credential onto `VACReauth.run({mode:'fast'})`
> (`vac-reauth-ceremony.js`). The fast path inherited the FULL ceremony's greeting/intro/countdown
> flow and only branched in 3 narrow spots — so it still shows the greeting (Bug B), and when the
> backend denies the fast verify (no enrolled face embedding) the tribunal degrade path prints a
> message that says the camera never ran even though it did (Bug A). The 3rd surface — the public
> token verifier on `vacprotocol.org` — was never migrated and still runs its own bespoke ceremony (Bug C).

---

## Workflow consistency map (which surface uses what)

| Surface | File | Re-auth engine | Greeting in fast? | Status |
|---|---|---|---|---|
| 1. Tribunal "Re-authorise" / "View the sealed credential" | `tribunal-demo.html` (mount `#vacReauthMount`) | **`VACReauth.run`** fast (`vac-reauth-ceremony.js`) | **YES (bug)** | Migrated S120 Lane 3 |
| 2. `vat-verify` "Quick re-verify to reveal" | `vat-verify.html` (`openReauth()` → `#vacReauthMount`) | **`VACReauth.run`** fast | **YES (bug)** | Migrated S120 Lane 2 |
| 3. Public token verifier `vacprotocol.org/vat/verify/{jti}` | **backend repo** (`vac-protocol`, NOT vac-web) | **bespoke** `openReauth()` / `EP_CHALLENGE`+`EP_FACE_REAUTH` | NO (already correct) | **NOT migrated** |

Live confirmation of surface 3 (via `/browse` against `https://vacprotocol.org/vat/verify/vat_root_c1e665235203`):
```
typeof VACReauth                                   → "undefined"
script[src*="vac-reauth-ceremony"] present         → false
typeof openReauth (bespoke)                        → "function"
UI: large "95.0%" trust ring + "Quick re-verify to reveal"  (old two-circles)
```

Irony worth flagging: surface 3 (the *old* one) already has the UX Rob wants for fast — bound single
digit, no greeting. The two *newly-unified* surfaces (1 & 2) regressed to the full-ceremony greeting.

Note: tribunal's "↗ Verify this token independently" link (`tribunal-demo.html:1287`, URL built at
`:833` / `:959`) points to `https://vacprotocol.org/vat/verify/{jti}` — a **different deployment**
(the vac-protocol backend), which is why surface 3 is out of this repo's reach.

---

## Live backend shapes (used by the fast path)

```
GET /v1/auth/face-reauth-challenge?email=caroline@example.com   → 200
  {"email":"caroline@example.com","fingers":1,"instruction":"Hold up one finger",
   "spoken_digit":1,"say_and_show":true,"bound_instruction":"Hold up one finger and say \"one\"..."}
  → NOTE: no `phrase`, no `challenge_id`. Just {fingers:N, ...}.

POST /v1/auth/quick-reauth  {email, action, detected_fingers, spoken_audio_b64:"", face_still_b64:"x"}  → 404
  {"detail":{"error":"no_face_reference","message":"No face reference on file. Full biometric
   verification required.","authenticated":false,"require_full_auth":true}}
```

The `{fingers:1}` shape is handled fine (normalized to `digits:[1]`). The problem is the **verify**
step: with no enrolled face embedding/reference, fast verify can never return `authenticated:true`.

---

## Bug A — CAMERA NEVER ADVANCES / "live capture did not run on this device"

**Rob's report:** after the mic/gesture pre-flight, it never transitions to a camera capture stage —
bounces back to the "Re-authorise" button; result shows *"live capture did not run on this device —
showing the probe."*

### What actually happens (the camera DID run — it was denied)

The `{fingers:1}` challenge loads fine, so `goToChallenge` does NOT bail. The full sequence runs:
`goToChallenge → showChallengeIntro → startCountdown → beginStillCapture` grabs ONE still + one finger
reading instantly (no visible "recording" stage in still mode), then POSTs to `/v1/auth/quick-reauth`.
The backend returns `no_face_reference` / (for Rob's enrolled-but-no-embedding account) `embedding_required`,
i.e. `authenticated:false`. That routes to the host fallback, and the tribunal degrade path then prints
copy claiming the capture never ran.

### Root cause (two layers)

1. **Misleading degrade copy (the user-visible bug).**
   - `vac-reauth-ceremony.js:2417` — fast verdict is fail-closed: `_ok = authResult.authenticated===true || authResult.authorized===true`. A `no_face_reference`/`embedding_required` 2xx-or-4xx → `_ok=false`.
   - `vac-reauth-ceremony.js:2421` — `_ok=false` → `CTX.onFallback(new Error('fast reauth denied'))`.
   - `tribunal-demo.html:1478-1484` — `onFallback` → `reauthDegrade('fast_denied')`.
   - `tribunal-demo.html:1422-1429` — `reauthDegrade` re-runs `probeReauthTier()`.
   - `tribunal-demo.html:1413` — when the probe sees `embedding_required`, it returns `{state:'fast', ..., inferred:true}`.
   - `tribunal-demo.html:1547-1548` — `tier.inferred` branch renders the note:
     *"The live capture did not run on this device — showing the probe."*
     **This is false.** The live capture DID run; the server denied it for a missing face reference.
     The copy conflates "live denial after capture" with "no-camera probe."

2. **The fast tier structurally cannot pass without an enrolled face embedding (the underlying cause).**
   - `vac-reauth-ceremony.js:68-80` (`MODE_CONFIG.fast.verify`) POSTs the still + finger count to `/v1/auth/quick-reauth`. With no enrolled reference, that endpoint returns `no_face_reference`/`embedding_required` every time (confirmed live: 404 above). So for Caroline/Rob's account every fast re-auth denies and degrades — there is no success path. The frontend treats this as a generic fallback rather than surfacing "no enrolled face → full verification needed."

Relevant non-bailing flow for reference (so we know the camera path is reached, not skipped):
- `vac-reauth-ceremony.js:251-268` fetch + normalize `{fingers:N}` → `challengeData.digits=[N]`.
- `vac-reauth-ceremony.js:715-726` `challengeIncomplete()` — still branch (`:720-722`) passes because `fingers` is numeric, so `goToChallenge` (`:734`) does NOT bail.
- `vac-reauth-ceremony.js:905` `startCountdown` → `beginStillCapture()`.
- `vac-reauth-ceremony.js:2359-2389` `beginStillCapture` grabs still, stops camera, `goToStep(3)`, `runFastVerification`.

### Fix approach (do not implement yet)
- **(must)** `tribunal-demo.html:1540-1552` — split the `inferred` note from the live-denied case. When `tier.ceremony`/`fast_denied` (camera DID run) and the server returned `embedding_required`/`no_face_reference`, say so honestly ("we captured a frame but you have no enrolled face reference yet — use full verification"), and stop the camera path from masquerading as a "no-camera probe."
- **(should)** Gate fast eligibility on an enrolled embedding: probe `embedding_required` BEFORE launching the camera ceremony (or have `runFastVerification`/host map `no_face_reference`/`embedding_required` to a distinct "enroll/full-auth" outcome) so the user isn't sent through a camera ceremony that cannot pass. `tribunal-demo.html:1401-1418` (`probeReauthTier`) already distinguishes `no_template` vs `inferred` — reuse that distinction on the pre-ceremony gate.
- **(consider)** In still mode, give a short visible "capturing…" beat before `goToStep(3)` so the instant grab doesn't read as "nothing happened."

---

## Bug B — GREETING SHOWN IN FAST MODE (should skip to the single bound digit)

**Rob's report:** fast mode still shows the greeting screen ("Say: hello…"). Fast (still-capture,
one bound digit) should skip the greeting entirely — just show + say the single digit in front of the
face, like the (old) public verifier.

### Root cause
The `capture.kind==='still'` branch exists in **only 3 narrow spots** (`:266` challenge-normalize,
`:720` incomplete-check, `:905` capture-vs-record). The greeting/intro flow was never branched, so
fast inherits the full ceremony's greeting verbatim:

- `vac-reauth-ceremony.js:748-762` — `goToChallenge` **unconditionally** sets `#challengeText` to
  `Say: "<greetPart>" … then show each number as you say it` (`:761`). No `still` skip.
  (For tribunal, `name:''` is passed, so `greetPart` falls back to `I am , authorising VAC Protocol` —
  an empty-name greeting, doubly wrong.)
- `vac-reauth-ceremony.js:828-847` — `showChallengeIntro` previews the greeting (`:843-844`,
  `challengeIntroGreeting`) and the digit. Always runs in fast (`:821` calls it).
- `vac-reauth-ceremony.js:875-908` — `startCountdown` runs the full "Get ready…" countdown before
  `beginStillCapture`.

Confirmed by static scan: no `capture.kind==='still'` / greeting-skip anywhere between `goToChallenge`
(`:729`) and `startCountdown` (`:908`).

### Fix approach (do not implement yet)
- In `goToChallenge` (`:748-762`): when `modeConfig().capture.kind==='still'`, set `#challengeText`
  to the single bound digit prompt only (use the live challenge's `bound_instruction` /
  `spoken_digit` — "Show & say **1**"), and DO NOT render the "Say: <greeting>" line.
- In `showChallengeIntro` (`:828-847`): in still mode, skip the greeting preview (`:843-844`) — show
  just the one digit, or skip the intro overlay entirely and go straight to a short countdown.
- Keep the change mode-gated so FULL mode (auth.html regression guard) is byte-unchanged.
- This fix lands once in `vac-reauth-ceremony.js` and corrects BOTH migrated surfaces (1 & 2) together.

---

## Bug C — THIRD SURFACE (public verifier) NOT MIGRATED

**Confirmed:** the public token-verifier at `vacprotocol.org/vat/verify/{jti}` does **not** use
`VACReauth.run`. It runs a **bespoke** ceremony (`openReauth()`, `EP_CHALLENGE='/v1/auth/face-reauth-challenge'`,
`EP_FACE_REAUTH='/v1/auth/face-reauth'`) and renders the old two-circles trust-ring UI.

- Live probe: `typeof VACReauth === "undefined"`, no `vac-reauth-ceremony.js` script tag,
  `typeof openReauth === "function"`. Screenshot: `/tmp/qa-surface3-verifier.png` (95.0% trust ring +
  "Quick re-verify to reveal").
- **The file is NOT in this repo.** `grep` for `"Verified Authority Chain"` / `EP_FACE_REAUTH` across
  `vac-web` returns nothing. It is served by the **vac-protocol backend repo** (per repo memory:
  Railway deploys `/vac-backend`, serves `vacprotocol.org`). `vac-web`'s own `verify.html` is a
  *different* surface (secure-video email/OTP flow) and is unrelated.

### Fix approach (do not implement yet)
- Migration is a **backend-repo (vac-protocol) change**, not a vac-web change: include
  `vac-reauth-ceremony.js` (+ `vac-finger-detect.js`) on the verifier template and replace the bespoke
  `openReauth()` with `VACReauth.run({mode:'fast', ...})`, same as `vat-verify.html:1069-1100`.
- BLOCKER / sequencing: do Bug B first. Migrating surface 3 onto the unified engine *before* the
  greeting-skip fix would regress surface 3's currently-correct no-greeting fast UX. Migrate only after
  `vac-reauth-ceremony.js` skips the greeting for `still`.
- Alternative: if surface 3 should stay bespoke for now, document it as intentionally un-unified so it
  isn't mistaken for an oversight.

---

## Evidence index
- `/tmp/qa-surface3-verifier.png` — live public verifier (old two-circles UI).
- Live curl: `face-reauth-challenge` → `{fingers:1,...}`; `quick-reauth` → 404 `no_face_reference`.
- Static: `capture.kind==='still'` appears only at `vac-reauth-ceremony.js:266, 720, 905`.

## Suggested fix order
1. **Bug B** in `vac-reauth-ceremony.js` (fixes greeting on surfaces 1 & 2 at once).
2. **Bug A** in `tribunal-demo.html` (honest degrade copy + pre-ceremony embedding gate) — and
   confirm whether the test identity has an enrolled embedding at all (the real blocker for a passing fast verify).
3. **Bug C** in the vac-protocol backend repo (migrate verifier), only AFTER Bug B.
