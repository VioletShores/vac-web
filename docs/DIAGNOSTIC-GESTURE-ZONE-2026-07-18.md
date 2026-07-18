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
