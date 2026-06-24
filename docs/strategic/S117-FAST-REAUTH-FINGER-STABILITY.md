# S117 — Fast re-auth finger-count stability (show 2, read 2)

## Symptom
In the **fast one-digit re-auth** ceremony, holding up **2 fingers showed "3"** (and other
wrong counts). The number jumped around frame-to-frame. The full `vac-auth` flow (`auth.html`)
reads the same fingers **reliably** — show 2, it reads 2.

## Root cause
MediaPipe's per-frame finger count naturally **flickers**: a steady "2" hand reads
`2, 2, 3, 2, 2, 2, …` across individual frames. The fast re-auth was trusting the **raw
per-frame** output with no (or weak) smoothing:

- **`tribunal-demo.html` `cerAdvisoryTick`** committed `FingerDetector.detect()`'s value to the
  displayed readout **every single frame** (`if(typeof det==='number'&&det>=0) CER.lastDetected=det;`).
  One bad frame → wrong number on screen.
- **`vat-verify.html`** smoothed, but too weakly: `GESTURE_STABLE_FRAMES=8`, `MIN_DWELL_MS=450`.

`auth.html` is reliable because it **only trusts a count after it has held steady for 12
consecutive frames (~0.6s) AND ~700ms wall-clock** — a deliberate hold, not a flicker. A single
bad frame can never register because the count must survive 12 frames first.

The shared detector `vac-finger-detect.js` is **correct and was not touched** — the fix is purely
how each page *consumes and displays* the count.

## The reference mechanism (auth.html — replicated verbatim)
```
auth.html:2338  const STABLE_FRAMES_NEEDED = 12;  // ~0.6s at ~20fps — a deliberate hold, not a flicker
auth.html:2339  const MIN_DIGIT_DWELL_MS = 700;   // ~0.7s wall-clock dwell, frame-rate independent
auth.html:2787-2798  if (detected > 0) { if (detected === stableCount) stableFrames++;
                     else { stableCount = detected; stableFrames = 1; digitStartTime = now; } }
auth.html:2848-2855  else { stableCount = 0; stableFrames = 0; }   // hand dropped → reset hold
auth.html:2871  _liveGestureOk = detected>0 && stableFrames>=STABLE_FRAMES_NEEDED
                              && digitStartTime>0 && (now-digitStartTime)>=MIN_DIGIT_DWELL_MS
```
A count is only **trusted/acted on** once `stableFrames >= 12` **and** the dwell `>= 700ms`.

## Fix

### `tribunal-demo.html` — port the 12-frame hold into the displayed readout
**Before** (raw per-frame commit — one stray frame shows the wrong number):
```js
function cerAdvisoryTick(){
  ...
  if(typeof det==='number'&&det>=0) CER.lastDetected=det;   // RAW — commits EVERY frame
  ...
}
```
**After** (commit only a steadily-held count — auth.html's exact mechanism):
```js
const CER_STABLE_FRAMES_NEEDED=12;  // auth.html:2338
const CER_MIN_DWELL_MS=700;         // auth.html:2339
function cerAdvisoryTick(){
  ...
  if(typeof det==='number'&&det>0){
    if(det===CER.stableCount){ CER.stableFrames++; }
    else { CER.stableCount=det; CER.stableFrames=1; CER.dwellStart=performance.now(); }
    const heldOk=(CER.stableFrames>=CER_STABLE_FRAMES_NEEDED && CER.dwellStart>0 && (performance.now()-CER.dwellStart)>=CER_MIN_DWELL_MS);
    if(heldOk) CER.lastDetected=CER.stableCount;   // commit ONLY a steadily-held count to the DISPLAY
  } else {
    CER.stableCount=0; CER.stableFrames=0;   // hand dropped — reset; last committed count stays shown
  }
  ...
}
```
Lines changed:
- `tribunal-demo.html:1422` — added `stableCount:0,stableFrames:0,dwellStart:0` to the `CER` init.
- `tribunal-demo.html:1473-1474` — new constants `CER_STABLE_FRAMES_NEEDED=12` / `CER_MIN_DWELL_MS=700`.
- `tribunal-demo.html:1477-1502` — `cerAdvisoryTick` now accumulates a stable-count buffer and commits
  to `CER.lastDetected` (the on-screen "Fingers seen: N" readout) only after the 12-frame + 700ms hold.

### `vat-verify.html` — match auth.html's constants exactly
- `vat-verify.html:1051` — `GESTURE_STABLE_FRAMES` **8 → 12** (auth.html `STABLE_FRAMES_NEEDED`).
- `vat-verify.html:1052` — `MIN_DWELL_MS` **450 → 700** (auth.html `MIN_DIGIT_DWELL_MS`).

### Not changed
- `vac-finger-detect.js` — the shared detector is correct; the fix is per-page consumption only.
- The rest of the merged fast-reauth ceremony is intact: real biometric capture, the face-embedding
  POST, the always-enabled "Capture now" button, the auto-capture countdown, and the single-digit line.
  The advisory finger readout still never gates capture — it's just **steady and correct** now. Because
  the value submitted to the server (`CER.lastDetected`) is now the *committed* count, the advisory
  signal sent on capture is also stabilised.

## Verification (browse test — drove the REAL `cerAdvisoryTick`)
Loaded `tribunal-demo.html` and drove the actual `cerAdvisoryTick` function with a deterministic fake
clock (60ms/frame) and a stubbed `FingerDetector.detect()` returning a flickering sequence
(`2,2,3,2,2,2 …` then a genuine held 2, a stray 3, a held 4, a stray 5). Result:

| Metric | NEW (12-frame hold) | OLD (raw per-frame) |
|---|---|---|
| Held **2** committed/shown | **2** (at frame 20) | 2 |
| Held **4** committed/shown | **4** (at frame 43) | 4 |
| Ever displayed a stray **3** | **false** ✅ | **true** ❌ |
| Ever displayed a stray **5** | **false** ✅ | **true** ❌ |

`PASS: true` — the displayed count is **stable and correct**; a single flicker frame never registers,
exactly matching `auth.html`. The old raw logic *would* have shown the wrong 3 and 5 (the reported bug).

## Result
Holding up 2 fingers in the fast re-auth now reliably shows **2**, identical behaviour to `auth.html`'s
full verification.
