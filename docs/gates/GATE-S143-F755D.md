# GATE-S143-F755D — finger-capture zone geometry fix

**Branch:** task-s143-f755d-zone-geometry  
**Task:** F-755d / D-F755D-ZONE-GEOMETRY  
**Date:** 2026-07-23

---

## Geometry Diagnosis

Two coordinate systems existed before this fix; neither was tied to the other:

```
BEFORE
──────
DRAWN (auth.html CSS .hand-zone):
  shape: single CENTRAL ellipse
  center: (0.50, 0.50) normalized
  radii:  rx=0.32, ry=0.40

ACCEPT (_handNearFaceZone / GESTURE_ZONE_SPEC in vac-reauth-ceremony.js):
  shape: TWO CHEEK ovals
  left:  cx=0.18, cy=0.48, rx=0.17, ry=0.22
  right: cx=0.82, cy=0.48, rx=0.17, ry=0.22

finger-test.html:
  drawn:  NONE
  accept: NONE

Result: hand in center-frame passes drawn ring but fails cheek ovals (and vice
versa). _ptInHandZone() (matching the CSS ring) was defined but never called —
dead code. The ring glowed green when cheek-oval acceptance passed, but its
shape implied a different zone.
```

```
AFTER (this fix)
────────────────
vac-finger-detect.js FingerDetector.zoneSpec (single source):
  left:  cx=0.18, cy=0.48, rx=0.17, ry=0.22
  right: cx=0.82, cy=0.48, rx=0.17, ry=0.22
  minTipsInside: 3

finger-test.html drawZoneOvals():
  → reads FingerDetector.zoneSpec (drawn = accepted, by construction)

finger-test.html updateZoneReadout():
  → reads FingerDetector.ptInCheekZone / handNearFaceZone (same spec)

Result: drawn oval IS the acceptance oval — one path, no divergence possible.
```

---

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `vac-finger-detect.js` | 324–368 | Added `zoneSpec`, `ptInCheekZone()`, `handNearFaceZone()`, `nearestCheek()` as stateless geometry helpers |
| `finger-test.html` | multiple | Added `drawZoneOvals()`, updated `drawLandmarks()` to pass `inZone`/`activeSide`, added `updateZoneReadout()`, added zone-readout HTML panel |

---

## Gates

### /codex PLAN gate
**Status:** PENDING — run before /browse

### /codex DIFF gate
**Status:** PENDING — run after commit

### /browse visual QA
**Status:** PENDING — Rob live-tests on device (L-2173)

**Test URL:** https://vacprotocol.org/finger-test.html (after merge) or branch preview

**What to verify:**
1. Two purple ovals appear at left/right cheek positions even with no hand
2. The active oval (nearest cheek) highlights purple when hand approaches
3. The oval turns GREEN when `handNearFaceZone` passes (wrist + ≥3 tips inside)
4. The zone-readout panel shows correct wrist coords and in/out status per frame
5. A hand in the CENTER of frame reads OUT-OF-ZONE — confirming the old CSS ring mismatch is now gone from this bench

---

## F-781 fail-open
Not touched — the server-side fail-open on total zone-drop remains as the safety net. This fix corrects the geometry so the net is no longer load-bearing on the client.

---

## Merge gate
**DO NOT MERGE** until Rob live-tests on iPhone (L-2173).
