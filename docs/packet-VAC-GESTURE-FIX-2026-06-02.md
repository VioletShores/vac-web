# Packet — VAC Gesture Auth Fix (self-host MediaPipe + orientation-invariant finger detection) — PLAN

**Created:** S101, 2 June 2026 (drafted by chat-Claude). **Status:** PLAN — gate-check (/codex) then dispatch.
**Repo:** `VioletShores/vac-web` (NOT athena). **Owner of EXECUTE:** Claude Code on Mini, fresh session.
**Debt:** D-VAC-GESTURE-MEDIAPIPE 🔴 — S101 DECISION LOCKED (Rob) = **fix-gesture-first, no fallback. Must work PERFECTLY before anything ships to Sam.**
**Wave role:** 6th Wave-1 lane and the **critical-path lane** — it is the sole precondition for F-521 (Wave 2), the only feature that hands Sam a usable product. Runs parallel to the 5 foundation lanes (≤ Conductor 6-8, L-665, at ceiling — watch merge throughput L-718).

## Why this packet (and why it's genuinely new work)

Cross-ref L-721 (self-host MediaPipe) + F-330 (speed). Ground-truth verified S101 against `auth.html` on `main` (HEAD `f053259`) and all three gesture branches — NOT trusted from the debt narrative (L-510):
- **No branch fixes this.** `fix/finger-gesture-realtime-detection` (18 Apr, 0 ahead/22 behind — stale, y-axis check still at L721). `rescue/…-mini-15mar` (25 Apr, 1 ahead/24 behind — mostly behind). `tirana-w3-5-finger-gesture-refactor` (28 May, 0 ahead/6 behind — y-axis check still at L802, and behind main). The live logic on main is unfixed.

## Two defects (not one) — both must be fixed for "perfectly"

**Defect A — CDN fragility (L-721).** `auth.html:270` imports MediaPipe from `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs`; WASM from `cdn.jsdelivr.net/.../wasm` (~L770); model `.task` asset from `storage.googleapis.com/mediapipe-models/...` (~L776). Three external dependencies on the auth critical path; any CSP/network/CDN hiccup drops the user to timer-fallback. 8 CDN-based fixes already failed — **NO CDN fix #9.**

**Defect B — orientation-fragile finger math (the actual "face-on only" root cause).** `auth.html` `_countFingers()` (lines ~801–807):
```js
if (landmarks[4].y  < landmarks[3].y)  count++; // thumb
if (landmarks[8].y  < landmarks[6].y)  count++; // index
if (landmarks[12].y < landmarks[10].y) count++; // middle
if (landmarks[16].y < landmarks[14].y) count++; // ring
if (landmarks[20].y < landmarks[18].y) count++; // pinky
```
Pure tip-y < PIP-y. Assumes fingers point UP in frame. Breaks the instant the hand rotates, tilts, or points toward the camera. The user-facing tip ("Show each digit with your fingers near your face… hold, change, hold") is the workaround papering over it. This is the orientation root cause named in the debt.

## North Star

Sam (and any user, any hand orientation, any reasonable device) completes VAC gesture/liveness auth reliably on the first honest attempt — with MediaPipe served from our own origin (no third-party CDN on the auth path) and finger-extension detection that is invariant to hand orientation. Honest posture preserved: this is liveness auth, not Posture C.

## PLAN — ASCII state-space (L-499 Rule 1)

```
                       auth.html load
                            |
              ┌─────────────┴─────────────┐
      [A] MediaPipe assets            [B] per-frame detect loop
      from OWN origin (vac-web)        results.landmarks[0] (21 pts)
      /vendor/mediapipe/                     |
        ├ vision_bundle.mjs           _fingerExtended(landmarks, i)  ← REWRITE
        ├ wasm/                         vector(MCP→PIP) vs vector(PIP→TIP)
        └ hand_landmarker.task          angle / dot-product, NOT tip.y<pip.y
              |                                |
      load OK? ──no──> HARD ERROR        orientation-invariant count 0..5
      (no silent CDN                           |
       fallback masking)                 sequence match → advance
              |                                |
              └────────────┬───────────────────┘
                           v
                   liveness PASS  (server Gemini cross-check unchanged)
                           |
                  Sam's door opens → F-521 wizard
```
Decision branches: asset-load failure must surface as an explicit retryable error (not silently degrade to timer mode and let a broken state look like success). Error paths: missing hand (-1, unchanged), slow frames (existing WARMUP/SLOW_FRAME fallback retained as PERF guard only, not as a correctness crutch).

## Implementation scope (EXECUTE — spec)

1. **Self-host the three assets** under `vac-web/vendor/mediapipe/` (bundle.mjs + wasm/ + hand_landmarker.task). Update the three load sites in `auth.html` (L270 import, ~L770 wasm FilesetResolver, ~L776 modelAssetPath) to same-origin relative paths. Add to `vercel.json` so they're served with correct MIME (`.mjs`, `.wasm`, `.task`) + long cache. Verify CSP allows `'self'` for these and drops the cdn.jsdelivr.net allowance.
2. **Rewrite `_countFingers` → orientation-invariant.** Per finger, compare the MCP→PIP vector against the PIP→TIP vector (dot-product / angle), or measure tip-distance-from-wrist vs PIP-distance-from-wrist — both orientation-free. Thumb handled separately (abduction, not flexion). Keep the 21-point input contract identical so the rest of the loop is untouched.
3. **Asset-load failure = explicit error, not silent timer-fallback-as-success.** Timer fallback stays ONLY as a perf guard for genuinely slow devices, clearly logged, never masking a correctness failure.
4. F-330 speed pass folded in (self-hosting already removes the 15s CDN wait budget).

## Gates (L-499 Rule 2) — run /codex on Mini before EXECUTE

- Probe 1: confirm orientation-invariant math against landmark fixtures at ≥4 hand orientations (upright, rotated 90°, tilted toward camera, angled) — counts correct at all.
- Probe 2: confirm same-origin asset load works with cdn.jsdelivr.net BLOCKED (simulate CSP/network denial) — no fallback-masking.
- Probe 3: no regression on the existing missing-hand (-1) and slow-frame perf paths.
- Probe 4 (multi-LLM critique): does self-hosting + vector-math introduce any new false-PASS surface (liveness spoofing)? L-255 guard — don't let consensus = correctness; anchor on the orientation fixtures as ground truth.

## VERIFY (real, not grep)

Live test on ≥2 physical devices + ≥4 hand orientations each; the auth flow must PASS honestly and FAIL a deliberately-wrong sequence. "On main" ≠ done (bootloader standard). Write the VERIFY result back into this packet + EXECUTION-DEBT (L-2041 — dispatched gate needs write-back).

## Branch hygiene

Supersede the three stale gesture branches: harvest anything useful from `tirana-w3-5` (most recent), then close all three to avoid future phantom-branch confusion (L-505).

## Soul-review / honesty note

Liveness/gesture auth is a real VAC capability; do not let the fix language drift toward implying biometric certainty it doesn't have. No Posture C claims. Adaptive/progressive auth (NIST-APPLICATION-V3) remains a roadmap option but is NOT this packet — Rob chose fix-first, single modality, done properly.

## Cross-ref

D-VAC-GESTURE-MEDIAPIPE (the debt, decision recorded), L-721 (self-host), F-330 (speed), F-521 (the dependent — auth = Sam's door), VPA-013 (Sign in with VAC), L-505 (branch landscape), L-510 (verify vs narrative), L-255 (consensus≠correctness), L-2041 (write-back).

## Wave placement

Wave 1, parallel lane (6th), city-worktree. Critical path: must LAND before Wave 2 F-521 can hand Sam anything. Dispatch first, watch closest.
