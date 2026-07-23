# Gate: S144 F-755d Zone Geometry Fix

**Branch:** task-s144-f755d-fix  
**Date:** 2026-07-23  
**Status:** AWAITING ROB IPHONE TEST (L-2173)

---

## What Was Fixed

Root cause (from `docs/debug/F755D-ZONE-GEOMETRY-DIAGNOSIS.md`): stale pre-S139 centre-oval SVG was rendering at z-index 5, above the correct canvas cheek-oval guide at z-index 4.

---

## Changes — Files + Lines

**File:** `vac-reauth-ceremony.js`

| # | Change | Lines (approx) | Detail |
|---|--------|----------------|--------|
| 1 | Dead code removed | 473–485 | Removed `_HAND_ZONE_RX`, `_HAND_ZONE_RY`, `_ptInHandZone` + stale comment block |
| 2 | HTML preflight SVG removed | ~4881–4886 | `#handZonePreflight`: stale `<ellipse cx=90 cy=120 rx=90 ry=120>` deleted; label kept |
| 3 | HTML gesture SVG removed | ~4997–5002 | `#handZone`: same stale ellipse deleted; label kept |
| 4 | CSS z-index lowered | ~5254 | `.hand-zone` z-index: 5 → 3 (canvas at z-index:4 now renders above the container) |
| 5 | CSS comment updated | ~5248–5253 | Removed stale 0.32/0.40 geometry claim; updated to describe current state |
| 6 | Centroid readout added | ~910–922 | `_drawFingerTargetGuide`: bottom-left text: `ZONE: IN ✓` / `ZONE: OUT` + wrist coords |
| 7 | Centroid readout added | ~981–994 | `_avDrawHand`: same readout in preflight canvas; counter-mirrored for legibility |

---

## Grep Proof — No Remaining Centre-Oval References

```
_HAND_ZONE_RX  →  0 live hits (comment-only mention in removal notice)
_HAND_ZONE_RY  →  0 live hits
_ptInHandZone  →  0 live hits
ellipse rx="90" (stale SVG)  →  0 hits
<svg preserveAspectRatio (in hand-zone div)  →  0 hits
```

Both `drawCheekZoneGuide` call sites (`_avDrawHand` + `_drawFingerTargetGuide`) and the acceptance gate (`_handNearFaceZone`) all read exclusively from `GESTURE_ZONE_SPEC`. Single source of truth: ✓

---

## Architecture After Fix

```
GESTURE_ZONE_SPEC  (L492–500)
    └─ _handNearFaceZone()     — acceptance gate (unchanged)
    └─ _drawFingerTargetGuide()  — gesture-step canvas guide (z-index:4)
    └─ _drawAvCheekOvals()     — preflight canvas guide (z-index:4)

.hand-zone div  (z-index:3)
    └─ label text only (SVG centre-oval REMOVED)
    └─ CSS show/hide via .show-hand-zone class (unchanged)
```

---

## On-Screen Readout (Rob's iPhone Verification Aid)

Both canvas overlays now show a small corner overlay:

```
┌──────────────┐
│ ZONE: IN ✓   │  ← green when _handNearFaceZone passes
│ wrist(x,y)   │  ← normalized coords of lm[0]
└──────────────┘
```

- **Green "ZONE: IN ✓"**: wrist + 3+ fingertips are inside a cheek oval — same gate the server uses
- **Grey "ZONE: OUT"**: hand is visible but outside the accept zone
- Positioned bottom-left of display (counter-mirrored so text reads forward despite canvas CSS scaleX(-1))

---

## Gates

- [ ] `/codex` review
- [ ] `/browse` visual QA: drawn cheek ovals must coincide with accept zone; no centre-oval ghost
- [ ] Rob live test on iPhone (L-2173) — look for `ZONE: IN ✓` when hand is beside cheek

---

## Live Test URL

**https://vacprotocol.org/auth.html**

(Vercel auto-deploys from main. This branch must be merged by Rob after iPhone test passes.)

---

## Do NOT Merge

Per task spec, do not merge to main. Rob live-tests on iPhone first (L-2173).
