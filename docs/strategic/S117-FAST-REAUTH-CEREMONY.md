# S117 — Fast re-auth: from tier PROBE to a REAL one-digit ceremony

**Status:** built + browse-verified (stubbed camera/face/fetch, real code paths). Leave on branch `Schemo512/fast-reauth-ceremony` for review. **Backend untouched.** Builds directly on [S117-FAST-REAUTH-BUILD.md](S117-FAST-REAUTH-BUILD.md) — that build made the fast tier *reachable as a probe*; this one makes it *actually happen*.

## The problem

The "Proportional re-auth — try it" panel on the sealed receipt PROVED the fast tier was selected but never RAN it. `viewCredentialReauth()` fired `POST /v1/auth/quick-reauth` as a **retry-safe probe with the biometric deliberately omitted** (`face_still_b64:'x'`, `spoken_audio_b64:''`). It read back `reauth_tier=fast_one_digit_bound` and wrote an AAR, but **never opened the camera or asked for the bound digit**. The user saw a *report that fast was eligible*, not the *experience* of doing a fast re-auth — so the core proportional-security differentiator (heavy ~30s tri-modal at the seal vs a light ~few-second one-digit check to view the credential) was never visible.

The backend was already live: `POST /v1/auth/quick-reauth` is a real FAST one-digit-bound ceremony (face still + ONE digit shown-and-said → server-side face-embedding match → fast-tier authorisation).

## Before → After

| | BEFORE (probe-only) | AFTER (real ceremony) |
|---|---|---|
| Camera | never opened | opens via `getUserMedia` (same constraints as vat-verify) |
| Digit | none | ONE random digit (1–5), shown + spoken |
| Biometric to backend | omitted (`face_still_b64:'x'`) | real face still (≤640 JPEG) + 128-D embedding + spoken-audio clip |
| `quick-reauth` call | tier-selection probe | **live ceremony** with `action='view_credential'` |
| Result cards | "Quick re-auth" (tier *selected*) | "Quick re-auth · done" (tier *performed*) with live `authenticated=true` |
| Camera/face/email missing | n/a | **degrades to the old probe**, labelled honestly |

The seal flow is untouched: it still delegates to the full `/auth.html` overlay (`sealReauthGate` → `voFrame`). The contrast is now real — full overlay at the seal, a compact inline one-number panel to view.

## Reuse, not reinvention

`tribunal-demo.html` has **no in-file `getUserMedia` helpers** — the seal uses an iframe to `/auth.html`. The real one-digit ceremony already exists in **`vat-verify.html`**. This build reuses that capture *approach* verbatim rather than inventing one:

- same `getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:960}},audio:true})`
- same ≤640 longest-edge still downscale + `canvas.toDataURL('image/jpeg',0.9)`
- same `window.VACFaceEmbed` 128-D descriptor (`/vac-face-embed.js`) — the real identity signal
- same `MediaRecorder` mime fallback chain + `blobToB64`
- same shared `window.FingerDetector` (`/vac-finger-detect.js`) + MediaPipe loader

Three shared `<head>` modules were added (all already have `vercel.json` rewrites; no `vercel.json` change needed): the MediaPipe `tasks-vision` loader, `/vac-face-embed.js`, `/vac-finger-detect.js`. All fail open.

It is kept deliberately **lighter** than vat-verify's full bound say+show co-occurrence gate: ONE digit, a short hold, no hard timing. The **server's face-embedding match is the real gate.**

## The finger is ADVISORY — capture is NEVER blocked

MediaPipe finger counting is unreliable (it can read 2 as 3; see `mediapipe-finger-count-aspect-sensitive`). Live testing of the heavy gate hit exactly this: a misread ("Showing 3 — need 1") left the user unable to capture because capture required `detected === N`. The MAIN flow (`auth.html`) already treats the finger as **advisory, not a gate**. This ceremony mirrors that, and goes further:

- **Capture is reachable at all times.** It is driven by an always-enabled "Capture now" button + an auto-capture countdown. Nothing waits on the finger count.
- **The readout is advisory only.** When the live count differs from the asked digit, the UI says *"exact count isn't required, capture anyway"* — it never says "wrong, blocked".
- **MediaPipe is fail-open.** If it is unavailable/failed, the line reads "advisory only, not required" and the ceremony is unaffected.
- **We submit what was detected** (`detected_fingers` = last live count, else the asked digit) as an advisory value for the server to weigh. (vat-verify itself submits the asked digit — finger is advisory server-side.)
- **A flaky finger count can never strand the user.** The "Use full verification instead" escape link (→ `/auth.html`) is always present.

Browse-verified: with the asked digit `N=2` and MediaPipe forced to report `3`, the advisory line showed *"Fingers seen: 3 · advisory — exact count isn't required, capture anyway"* and the capture still fired (POST sent, `detected_fingers:3`, result "Quick re-auth · done").

## Exact functions changed (`tribunal-demo.html`)

- **`<head>`** — added the MediaPipe module loader + `<script src="/vac-face-embed.js">` + `<script src="/vac-finger-detect.js">`.
- **CSS** — added `.cer-*` rules for the inline ceremony (compact mirrored video, REC dot, big digit, advisory line, countdown, capture row, escape link, status). Lighter footprint than the full overlay.
- **`renderReauthDemo()`** — warms `VACFaceEmbed` + `FingerDetector` (fail-open) when the sealed panel renders, so the live ceremony feels instant.
- **`viewCredentialReauth()`** — rewritten as an **orchestrator**: no email → degrade `no_session`; no camera support → degrade `camera_unavailable`; otherwise run the real ceremony.
- **`authorizeViewCredential()`** *(factored out, unchanged contract)* — the authoritative `POST /v1/vat/authorize` `action=view_credential` (writes the AAR; a LOW action does not re-gate to full).
- **`probeReauthTier()`** *(factored out)* — the old retry-safe tier probe, now the **degrade-only** fallback.
- **`reauthDegrade(why)`** *(new)* — probe + authorise + render with an honest reason label.
- **`startFastCeremony(email)`** *(new)* — face-ref-status fail-safe → open camera → render stage → MediaRecorder → advisory loop → countdown.
- **`cerAdvisoryTick()` / `cerArmCountdown()` / `cerRenderStage()` / `cerSetStatus()` / `cerBlobToB64()` / `cerTeardown()`** *(new)* — the ceremony UI + advisory readout + capture pacing + resource teardown (wired into `#reset` and `pagehide`).
- **`cerCapture(email)`** *(new)* — still + embedding (single-face UX retry, capped) + audio → `POST /v1/auth/quick-reauth` with the REAL payload (`action='view_credential'`, `challenge_fingers`, advisory `detected_fingers`, `face_embedding`, `face_still_b64`, `spoken_audio_b64`, …). Honest no-match retries (≤2), then degrade.
- **`renderReauthResult(authz,tier)`** — extended for the live-ceremony case ("· done", `quick-reauth authenticated=true`, advisory finger, AAR, `reauth_tier`) and for honest degrade/failed labels.

## Honest degrade matrix (browse-verified)

| Condition | Camera opened? | Card | Copy |
|---|---|---|---|
| Live ceremony OK | yes | "Quick re-auth · done" | live `authenticated=true`, AAR, `reauth_tier` |
| No camera / mic | attempted | "Quick re-auth · eligible (probe)" | "No camera here … showing the server's tier-selection probe instead … on a device with a camera, this button runs the real one-number ceremony." |
| No enrolled face | **no** (fail-safe) | "Quick check unavailable" | "No enrolled face template … the quick face check can't run. The authorisation result below is still live and server-attested." |
| No session / email | **no** | "Quick check unavailable" | "No verified session/email on this seal …" |
| Server no-match | yes | "Not confirmed" | "ran live, but the server did not confirm a match … not faking a pass." |

Nothing is fabricated client-side; every shown value is read from a live response, and the live ceremony only ever shows "done" when the backend returns `authenticated`.

## What a headless browse can / can't prove

A real biometric needs a live camera, so the headless verification stubbed `getUserMedia` (canvas `captureStream`), `VACFaceEmbed`, and `fetch`. It confirmed: the ceremony UI renders (video, REC, one digit, advisory line, escape link, status); the camera-open is wired with the exact constraints; the one-digit prompt appears; the `quick-reauth` POST fires with a REAL payload (`action='view_credential'`, real `face_still_b64` len 2152 — not `'x'`, real audio, 128-D embedding); the advisory finger never blocks capture; and all degrade paths render honestly. A real face match against a live camera is the one thing only a real device can exercise.
