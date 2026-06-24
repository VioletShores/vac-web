# S117 — Re-auth unify: collapse THREE re-auth implementations into ONE

**Goal:** auth.html had the ONLY working "show-and-say N digits while the face is verified"
ceremony. vat-verify.html and tribunal-demo.html each carried a separate, BROKEN re-implementation.
This work extracts auth.html's ceremony into one shared module (`vac-reauth-ceremony.js`) and points
all three pages at it.

Branch: `Schemo512/reauth-unify` (do NOT merge — staged for human live-test between steps).

> Note: the named build spec `athena/docs/strategic/S117-REAUTH-UNIFY-BUILDSPEC.md` was not present
> in the repo at build time; this followed the detailed inline task spec. If the buildspec lands,
> reconcile STEP 2/3 below against it.

---

## STEP 1 — DONE (this commit). Extract + point auth.html at the module.

**What shipped:**
- **New `vac-reauth-ceremony.js`** — `window.VACReauth.run({...})`. Contains auth.html's ceremony
  **verbatim**: same `/v1/vat/auth/challenge` + `/v1/vat/auth/verify` endpoints, same 12-frame
  finger stability, same co-occurrence voice gate (VAD + gesture within `DIGIT_COOCCUR_MS`), same
  face-embedding + bound-still + audio capture, same AV pre-flight, same timer fallback, same
  retry/no-mic recovery, same modality-result UI. The ceremony's DOM (steps 1-3 + the upfront
  explainer) and the page CSS are carried in the module and rendered into the host's `mount`.
- **auth.html refactored to CALL it.** Removed the inline ceremony (DOM + ~2500 lines JS) and added
  `startReauthCeremony()`, which calls `VACReauth.run(...)`. The page keeps STEP 0 (identity + OTP)
  and STEP 4 (success / vouch / trust graph / share) and its own `goToStep`, `showSuccess`,
  `reauthReload`, `maybeResumeReauth`. The ceremony renders into `<div id="vacReauthMount">`.
- vercel.json: added the no-cache header entry for `/vac-reauth-ceremony.js` (matches the other
  `/vac-*.js` modules).

**The module API (the contract STEP 2/3 consume):**
```js
VACReauth.run({
  name, email, org, role,        // identity (was auth.html's form-reading userData())
  riskLevel,                     // 'low' | 'medium' | 'critical' → server picks num_digits
  mount,                         // element (or id string) the ceremony renders into
  context,                       // 'register' | 'view' | 'seal' (telemetry/labelling)
  auto,                          // true = resume/service-error silent auto-proceed (opens camera itself)
  retryAttempts,                 // seed the retry budget on a resumed retry
  onStep(n),                     // ceremony moved to its step n (1 camera, 2 record, 3 verify) — host mirrors its dots
  onComplete(authResult),        // SUCCESS — the live /verify result; host shows its success surface
  onFallback(reason),            // degrade hook (reserved; not yet emitted by the moved code)
  onReauthReload(opts),          // retry / no-mic recovery → host's restart primitive
  onBack(),                      // step-1 back button → host returns to its pre-ceremony screen
});
```
- The module renders the ceremony into `mount`, hides it on success/cancel, and calls back.
- `riskLevel` is wired straight into the challenge POST body (`risk_level`). For auth.html it stays
  `'medium'` (unchanged from the inline flow).
- The module exposes its inline-onclick handlers on `window` (requestCamera, retryAVSetup,
  toggleModalities, toggleModRow, toggleUnderHood, dismissChallengeIntro, retryVerification,
  setFingerFallback, _dismissNoMic) so the moved DOM's `onclick="..."` attributes still resolve.
- `?qa=1` overlay: the module adopts `window.QA` (exposed by auth.html) at run() time; no-op shim on
  hosts without it.

**Verification (browse-tested headless, camera-free — `node --check` on both files passes):**
- Page loads with **no console errors** (the MediaPipe WebGL warning is the expected headless
  GPU-absent timer fallback — same as before).
- `startReauthCeremony()` renders the full ceremony DOM (step1/2/3 + challengeIntro + digitStrip +
  vacGuided) into the mount; CSS renders identically (screenshot matched the prior camera step).
- Enabling the camera fires the challenge POST with `{"name":"...","risk_level":"medium"}` — the
  `riskLevel` parameterisation is live.
- Success handoff: `onComplete(passingResult)` → `showSuccess()` → STEP 4 active, name + AUTHENTICATED
  badge render.
- Cancel handoff: `VACReauth.cancel()` → STEP 0 active, mount hidden.

**NOTE FOR THE HUMAN GATE:** auth.html now calls the shared module; behaviour preserved — **needs a
live human test before step 2** (a real camera/mic exercises the one thing headless can't: the live
finger + voice + face capture during recording). Do not wire vat-verify / tribunal until auth.html
is confirmed working on a real device.

---

## STEP 2 — TODO (after the human live-test). Point vat-verify.html at the module.

vat-verify.html currently has its own (broken) one-digit re-auth gate before it reveals the verified
token. Replace it:

1. **Delete vat-verify's inline re-auth gate** (its own `getUserMedia`/capture/quick-reauth code and
   the gate UI) — it is superseded by the module.
2. **Call `VACReauth.run({ ..., riskLevel: 'low', mount: <gate container>, context: 'view', ... })`**
   at the point where the page currently gates on its old re-auth. `low` = the light tier (server
   returns the fewest digits, typically 1).
3. **`onComplete(authResult)`** → continue to the existing "show the verified token" step (replace
   whatever the old gate's success branch did). **`onReauthReload`** → re-invoke `VACReauth.run(...)`
   in place (vat-verify is NOT auth.html — there is no full-page-reload + resume-blob restart here;
   the host handler should just re-run the ceremony, not `location.reload()`).
4. **`onBack` / `onFallback`** → vat-verify's "can't verify" dead-end copy (keep it escapable).
5. CSS: see the **CSS scoping** note below — verify the module's injected styles don't clash with
   vat-verify's own `.header` / `.btn-primary` / `.step-section` rules.

## STEP 3 — TODO (after the human live-test). Point tribunal-demo.html at the module.

tribunal-demo.html has TWO re-auth surfaces with different tiers, plus a broken step-up:

1. **"View the sealed credential" (light tier):** `VACReauth.run({ ..., riskLevel: 'low',
   context: 'view', mount: <view container>, ... })`. **Delete the inline quick-reauth ceremony**
   (`viewCredentialReauth` / `startFastCeremony` / `cerCapture` / the `cer*` helpers and the
   `/v1/auth/quick-reauth` probe path — see S117-FAST-REAUTH-CEREMONY.md for the inventory). It is
   superseded by the module's `low` tier.
2. **The seal (heavy tier):** the seal currently delegates to `/auth.html` via an iframe
   (`sealReauthGate` → `voFrame`). Re-point it to `VACReauth.run({ ..., riskLevel: 'critical',
   context: 'seal', ... })` so the seal runs the SAME module at the full tier — one implementation,
   two risk levels (light to view, critical to seal). (If keeping the iframe short-term is easier,
   that's fine, but the inline `cer*` ceremony in #1 must still be deleted.)
3. **Fix the `repeated_failures_2` step-up.** Today a couple of failures on the LIGHT (view) tier can
   silently escalate BOTH cards to the full tier. Required behaviour:
   - the **light tier stays retryable** on its own terms — repeated light failures re-offer the light
     ceremony (via `onReauthReload` → re-run `VACReauth.run` at `riskLevel:'low'`), they do NOT jump
     the user to critical;
   - a step-up to critical, if it happens, is **explicit and scoped to the action that needs it**
     (the seal), and must **never silently escalate both the view card and the seal card to full**.
   - Use `onReauthReload(opts)` as the retry seam and keep the tier in the host (don't let the module
     decide escalation).
4. **`onComplete`** for view → reveal the sealed credential; for seal → fire the existing sealing
   action (the `vac-auth-success` postMessage path / `/v1/vat/authorize`). Preserve the S116
   seal-fires-gate security (the session_token only goes same-origin).

---

## Cross-cutting notes for STEP 2/3

- **CSS scoping (important).** STEP 1 keeps it simple: the module injects a verbatim copy of
  auth.html's full `<style>` (id `vac-reauth-styles`), UNSCOPED. In auth.html that's a harmless
  duplicate of styles already present, so rendering is identical. In vat-verify / tribunal the module
  will inject `.header`, `.btn-primary`, `.step-section`, `:root` vars, etc. that may **collide with
  those pages' own rules.** Before wiring each page: either (a) scope the module's CSS under a
  `.vac-reauth-root` wrapper on the mount, or (b) confirm the injected rules are compatible with the
  host. Do NOT skip this — a silent `.btn-primary` override is a visual regression.
- **`onReauthReload` is host-specific.** auth.html = full page reload + `vac_reauth` resume blob
  (correct-by-construction fresh start). vat-verify / tribunal have no such reload path — their
  `onReauthReload` should re-invoke `VACReauth.run(...)` in place. This is also the seam for the
  tribunal light-tier retry (#3 above).
- **The finger is advisory; capture is never blocked** — preserved in the module verbatim (the gate
  never requires `detected === N`; see `mediapipe-finger-count-aspect-sensitive`). Don't re-introduce
  a finger gate in the consumers.
- **Honesty contracts carried over:** advisory modalities (Finger Gesture, Duress) stay muted under
  "Advisory signals"; VERIFIED is display-only and follows the server verdict; "Continue Anyway"
  routes a partial result through the host's success surface without emitting verified side-effects.
- The big contiguous JS (camera → AV → challenge → recording → detection loop → greeting → verify)
  was moved verbatim; only the seams changed: `userData()` → module identity, `goToStep(2/3)` →
  module step nav, `showSuccess()` → `onComplete`, `reauthReload(...)` → `onReauthReload`,
  `risk_level:'medium'` → `riskLevel`.
