# DIAGNOSTIC — D-GESTURE-ZONE-CONTRADICTS-COACHING
Date: 2026-07-18  
Branch: task-s139-gesture-zone-unify  
Datum: Rob 3-screenshot runtime observation

## Observed behaviour
- Gesture acceptance (`.hand-in-zone` CSS glow) fires **only** when hand is far back / small near frame edge  
- "Move your hand closer" coaching fires at the same time as acceptance is ON  
- Moving the hand **slightly closer** (closer to the camera) turns the acceptance glow **OFF**  
- Result: acceptance zone is functionally **inverted** from what users expect at a natural phone/laptop distance

## Three independent consumers — current thresholds

### Consumer 1: Gesture acceptance gate
**File:** `vac-reauth-ceremony.js`  
**Function:** `_handNearFaceZone(lm)` — L495-501  
**Constants:** `_CHEEK_ZONE_RX = 0.15, _CHEEK_ZONE_RY = 0.19` (L488)  
**Zone centres:** `cx = 0.18` (left cheek) or `cx = 0.82` (right cheek), `cy = 0.48`  
**Gate logic:** wrist landmark (index 0) must be inside either cheek oval **AND** ≥3 of 5 fingertips  
(indices 4, 8, 12, 16, 20) must also be inside either cheek oval  
**Drives:** `.hand-in-zone` CSS class on camera box (L693, L2364); `_confident` glow in `_drawFingerTargetGuide` (L815)

### Consumer 2a: "Move closer" coaching — challenge step
**File:** `vac-reauth-ceremony.js`  
**Function:** `CaptureFeedback.checkHandFraming` — L1229-1257  
**Threshold:** `tooSmall = ((maxX-minX) < 0.28 && (maxY-minY) < 0.28)` (L1245)  
**Independence:** computed from bounding box of 21 landmarks — **no zone membership test**  
**Coaching fired:** `'Move your hand closer'` (L1249)

### Consumer 2b: "Move closer" coaching — pre-flight (runAVFrame)
**File:** `vac-reauth-ceremony.js`  
**Function:** `runAVFrame` — L700-712  
**Threshold:** `tooSmall = ((maxX-minX) < 0.28 && (maxY-minY) < 0.28)` (L704)  
**Independence:** same bounding-box check, independent of zone  
**Coaching fired:** `'Move your hand closer — fill the oval with your hand'` (L712)  
**Note:** the "oval" referred to is now a cheek oval, not the old centre oval — copy was never updated

### Consumer 3: Canvas overlay guide
**File:** `vac-reauth-ceremony.js`  
**Functions:**  
- `_drawFingerTargetGuide` (L822): `_radX = 0.10, _radY = 0.14` → draws two cheek ovals  
- `_avDrawHand` inline IIFE (L926): hardcoded `0.10*w, 0.14*h` → same two cheek ovals  
**Comment at L913:** "Same geometry as _drawFingerTargetGuide (cx 0.18/0.82, cy 0.48, radX 0.10, radY 0.14)"  
**Independence:** draw radii (0.10, 0.14) are **different** from acceptance radii (0.15, 0.19)  
**Glow driver:** uses `_handNearFaceZone` (Consumer 1) ← consistent with acceptance, but acceptance zone is larger than the drawn oval

### Dead code note
`_HAND_ZONE_RX = 0.32, _HAND_ZONE_RY = 0.40` and `_ptInHandZone` (L481-484) are never called.  
The comment block at L473-476 ("ZONE: a central ellipse centered at (0.5,0.5)...") is stale — it  
describes the OLD centre-oval system. The active system uses cheek ovals. The CSS `.hand-zone` div  
(64%×80% centre oval) remains for Lane B full-auth wide-hand-zone UI but is **not** what the  
cheek-oval acceptance gate tests.

## Root cause: inversion

At **far distance** (hand small, bbox < 0.28×0.28):
- 21 landmarks are compressed/clustered → wrist at `cx≈0.19`, fingertips all within ±0.05 → fit inside tight oval (rx=0.15, ry=0.19) → `_handNearFaceZone = true` → **acceptance ON**
- `(maxX-minX) < 0.28` → `tooSmall = true` → "Move your hand closer" coaching fires
- **Contradiction:** acceptance glow + "move closer" prompt fire simultaneously

At **normal/close distance** (hand fills frame naturally, spread fingers beside cheek):
- Fingertips spread ≥0.20 from cheek centre in normalized coords → exit the tight rx=0.15 oval → `inside < 3` → `_handNearFaceZone = false` → **acceptance OFF**
- `(maxX-minX) ≥ 0.28` → `tooSmall = false` → coaching clears
- **Contradiction resolved but inverted:** hand is in correct position but acceptance is OFF

**Conclusion:** `_CHEEK_ZONE_RX = 0.15, _CHEEK_ZONE_RY = 0.19` is too small for spread fingers at normal camera distance. The min-size gate (tooSmall < 0.28) acts like a MAX-size gate for acceptance — the two thresholds are inversely correlated.

## Fix plan (Step 2 / Step 3 — separate commit)

### L-2299 unified `GESTURE_ZONE_SPEC`
Replace the three independent constant sets with one exported spec object:

```js
const GESTURE_ZONE_SPEC = Object.freeze({
  ovals: [
    { cx: 0.18, cy: 0.48, side: 'left'  },
    { cx: 0.82, cy: 0.48, side: 'right' },
  ],
  rx: 0.20,          // was acceptance 0.15 / draw 0.10 — unified + widened for normal distance
  ry: 0.26,          // was acceptance 0.19 / draw 0.14 — unified + widened
  minTipsInside: 3,  // unchanged
});
```

**Acceptance** (`_ptInCheekZone`, `_handNearFaceZone`): read `GESTURE_ZONE_SPEC.rx/ry`  
**Canvas overlay** (`_drawFingerTargetGuide`, `_avDrawHand` IIFE): read `GESTURE_ZONE_SPEC.rx/ry` → drawn oval = acceptance zone, no more mismatch  
**Coaching** (`checkHandFraming`, `runAVFrame`): replace `tooSmall` coaching with zone-aware coaching — fires only when `_handNearFaceZone` returns false, and advice is directionally correct ("Hold your hand beside your cheek" not "move closer")

### Safety
- `_handNearFaceZone` is marked advisory-only (L468-470); returns `false` only for coaching — never gates verdict
- Zero changes to verdict logic, server paths, or advance conditions
- `_handInTickZone` (pre-flight Hand✓ tick) is kept as-is (separate concern)

---

# APPENDIX — D-VAD-DOUBLETAP-2026-07-19
Date: 2026-07-19  
Branch: task-s139-vad-doubletap  
Datum: Rob live-device report — 1 tap now rejected by the 180ms sustain gate; 2 quick taps PASS

## Observed behaviour
- Single desk-tap: correctly rejected (drops back to silence before 180ms elapses)
- Two quick taps ~100–150ms apart: PASS the sustain gate despite being non-voice

## Hypothesis verification

### H1 — AnalyserNode smoothingTimeConstant (CONFIRMED)

**Location:** `vac-reauth-ceremony.js` L4767–4768  
```js
audioAnalyser = audioContext.createAnalyser();
audioAnalyser.fftSize = 256;
// smoothingTimeConstant NOT set → browser default = 0.8
```
`getByteFrequencyData()` returns an exponentially smoothed magnitude spectrum:
`out[k] = 0.8 × prev[k] + 0.2 × current[k]`

At 60 Hz rAF cadence (~16.7 ms/frame) a single tap lasting ~40 ms energizes the spectrum at frames F0–F2. After the tap ends, the smoothed value decays as `0.8^n × peak`. After 100 ms (≈6 frames) the residual is `0.8^6 ≈ 0.26 × peak`. If the original tap pushed spectral RMS to ~0.3, the residual after 100 ms is ~0.078 — right at the threshold. A SECOND tap at that moment re-energizes the envelope before the residual decays below `vadSpeechThreshold` (0.14), so the smoothed value stays above threshold **continuously for > 180 ms** without the inter-tap dip ever registering. `_preOnsetStart` is therefore never reset between taps, and the sustain window accumulates across both events.

**Fix:** Set `audioAnalyser.smoothingTimeConstant = 0.15` at creation. At 60 Hz, 100 ms inter-tap gap = ~6 frames; residual = `0.15^1 × 0.2 + …` collapses to < 0.05 × peak within 2 frames (~33 ms). The dip between taps now reaches silence/neither, resetting `_preOnsetStart` and restarting the sustain clock.

**Impact on other audioAnalyser consumers:**
- `updateLevels()` (bar display): visual bars will be slightly more responsive — no functional change
- Greeting phrase gate: more responsive to genuine silence gaps — beneficial
- `_makeQuickReauthVoiceGate` fast path: shares the same analyser; also benefits

### H2 — Voice-band spectral check too permissive (CONFIRMED)

**Location:** `vac-reauth-ceremony.js` L2136–2144 (full path), L3170–3177 (fast path)  
**Current check:** 0–3.5 kHz energy ≥ 20% of total (`VAD_VOICE_BAND_FRAC = 0.20`)

At `fftSize=256, sampleRate=48 kHz`, each bin = 187.5 Hz. The 0–3.5 kHz range covers bins 0–18 (19 bins) out of 128 total = **14.8% of bins**. For a broadband transient (flat spectrum), 0–3.5 kHz fraction ≈ 14.8% < 20% → correctly rejected. **However, a desk-tap thump concentrates energy in sub-200 Hz LF**, which IS within the 0–3.5 kHz window. A thump with dominant energy in bins 0–1 still passes the 20% threshold because the LF peak inflates the voice-band sum.

**Fix:** Narrow to **300–3500 Hz mid-band** (bins `⌈300/187.5⌉ = 2` through `⌊3500/187.5⌋ = 18`, i.e. 17 bins = 13.3% of total). Desk-tap LF thump energy sits in bins 0–1, which are **excluded** from the mid-band window. For a tap with most energy at 0–200 Hz, the mid-band fraction is ≈ 3–8% << 35%. A voiced digit concentrates energy in 300–3 000 Hz (formants F1/F2), clearing 35% easily.

Raise threshold to **0.35**: `0.35 >> 13.3%` (flat broadband baseline) so any non-voice signal fails.

Add **mid-window re-check** at ~50% of the sustain window: the second tap in a double-tap sequence arrives mid-window and shifts spectral energy to LF-broadband. A re-check at 125 ms catches this even if the onset frame was borderline.

## Fix plan

| Fix | Constant / code | Old | New |
|-----|----------------|-----|-----|
| F1 | `audioAnalyser.smoothingTimeConstant` | 0.8 (default) | 0.15 |
| F2 | `VAD_ONSET_SUSTAIN_MS` | 180 | 250 (= floor of voiced digit "one/uno") |
| F2 | `FAST_VAD_ONSET_SUSTAIN_MS` | 180 | 250 |
| F3 | `VAD_VOICE_BAND_FRAC` | 0.20 | 0.35 |
| F3 | `FAST_VAD_VOICE_BAND_FRAC` | 0.20 | 0.35 |
| F3 | Spectral band (full + fast) | 0–3.5 kHz | 300–3500 Hz (mid-band) |
| F3 | Mid-window re-check | none | at 50% of sustain window |
| F4 | Debug readout | `rejTap:N` | `rejTap:N(spec\|sust)` |

**All changes touch the VAD gate region only. No verdict, server, or advance logic touched.**
