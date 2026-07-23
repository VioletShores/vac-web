# F-755d — Zone Geometry Diagnosis

**Branch:** task-s144-f755d-diagnose  
**Date:** 2026-07-23  
**Status:** DIAGNOSIS ONLY — no code changed

---

## 1. Exact Line Numbers + Code of Both Zone Definitions

### (a) Accept / Cheek-Zone Test

**File:** `vac-reauth-ceremony.js`

```javascript
// Lines 492–500 — GESTURE_ZONE_SPEC (single source of truth for acceptance)
const GESTURE_ZONE_SPEC = Object.freeze({
    ovals: [
        { cx: 0.18, cy: 0.48, side: 'left'  },
        { cx: 0.82, cy: 0.48, side: 'right' },
    ],
    rx: 0.17,          // acceptance + draw radii — unified (S139 Rob live-tune)
    ry: 0.22,
    minTipsInside: 3,
});

// Lines 501–508 — _ptInCheekZone (point membership)
function _ptInCheekZone(p) {
    const rx = GESTURE_ZONE_SPEC.rx, ry = GESTURE_ZONE_SPEC.ry;
    for (const o of GESTURE_ZONE_SPEC.ovals) {
        const dx = (p.x - o.cx) / rx, dy = (p.y - o.cy) / ry;
        if (dx * dx + dy * dy <= 1) return true;
    }
    return false;
}

// Lines 509–516 — _handNearFaceZone (hand acceptance gate)
function _handNearFaceZone(lm) {
    if (!lm || lm.length < 21) return false;
    if (!_ptInCheekZone(lm[0])) return false;       // wrist must be inside either cheek oval
    const tips = [4, 8, 12, 16, 20];
    let inside = 0;
    for (const t of tips) { if (_ptInCheekZone(lm[t])) inside++; }
    return inside >= GESTURE_ZONE_SPEC.minTipsInside;
}
```

**Geometry:** Two off-center cheek ovals in raw MediaPipe normalized space:
- Left cheek: center (0.18, 0.48), rx=0.17, ry=0.22
- Right cheek: center (0.82, 0.48), rx=0.17, ry=0.22

**Consumers of this accept test:** lines 706, 2426, 827, 960, 1258, 2402, 2587, 3417

---

### (b) Drawn-Marker Geometry

**File:** `vac-reauth-ceremony.js` (HTML template embedded in the file)

```html
<!-- Line 4881–4885 — Pre-flight camera box (#cameraBox) -->
<div class="hand-zone" id="handZonePreflight">
    <svg viewBox="0 0 180 240" width="100%" height="100%" preserveAspectRatio="none" style="overflow:visible;">
        <ellipse class="hand-zone-ring" cx="90" cy="120" rx="90" ry="120"/>
    </svg>
    <div class="hand-zone-label">✋ Hold hand beside your cheek</div>
</div>

<!-- Lines 4997–5001 — Gesture-step camera box (#cameraBoxRec) — identical geometry -->
<div class="hand-zone" id="handZone">
    <svg viewBox="0 0 180 240" width="100%" height="100%" preserveAspectRatio="none" style="overflow:visible;">
        <ellipse class="hand-zone-ring" cx="90" cy="120" rx="90" ry="120"/>
    </svg>
    <div class="hand-zone-label" id="handZoneLabel">✋ Hold hand beside your cheek</div>
</div>
```

**CSS (auth.html line 121):**
```css
.hand-zone { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
             width: 64%; height: 80%; pointer-events: none; display: none; z-index: 5; }
```

**Geometry derivation:**
- SVG viewBox is 180×240; the ellipse fills it exactly: cx=90/180=0.5, cy=120/240=0.5 of the SVG
- The div is 64% of frame width × 80% of frame height, centered at (0.5, 0.5)
- Therefore the ellipse in frame-normalized coords: **center (0.5, 0.5), rx=0.32, ry=0.40**
- This is a single CENTER oval, not a cheek oval

**Z-index:** `.hand-zone` div is z-index:5; the canvas overlays (`avHandOverlay`, `handOverlay`) are z-index:4. The CSS center oval renders ON TOP of the canvas cheek ovals, so the user sees the stale center oval primarily.

---

## 2. ASCII Diagram — Coordinate System Divergence

Camera frame (normalized, 0→1 each axis). MediaPipe x=0 is LEFT of raw camera feed; with CSS scaleX(-1) on video+canvas, display left↔right is swapped.

```
  MediaPipe/raw space     Display space (after CSS scaleX(-1))
  (what _handNearFaceZone  (what the user's eyes see)
   tests against)

  x=0           x=1       x=0           x=1
  ┌──────────────────┐    ┌──────────────────┐
  │  ░░     ACCEPT    │    │    ACCEPT     ░░ │ y=0
  │ ░░░░░   ZONE      │    │    ZONE      ░░░░│
  │  ░░ L    (cx=.18) │    │ R (cx=.82)    ░░ │
  │                   │    │                  │ y=0.48
  │         ACCEPT    │    │ ACCEPT           │
  │          ZONE ░░  │    │  ░░ ZONE         │
  │       (cx=.82)░░░░│    │░░░░(cx=.18)      │
  │                ░░ │    │ ░░               │ y=1
  └──────────────────┘    └──────────────────┘

  DRAWN GUIDE (CSS div, display space, same in both views):
  ┌──────────────────┐
  │                  │
  │    ┌────────┐    │ y=0.10
  │    │  DRAWN │    │
  │    │  GUIDE │    │
  │    │(cx=0.5)│    │
  │    │(rx=.32)│    │
  │    └────────┘    │ y=0.90
  │                  │
  └──────────────────┘

  DIVERGENCE: The drawn guide is a large center oval.
  The cheek accept zones are two small off-center ovals.
  A hand centered in the drawn oval is NOT in either cheek zone.
  A hand in a cheek zone is NOT inside the drawn oval.
```

---

## 3. Root Cause — Stale Drawn Guide After System Migration

**Root cause: stale-remnant mismatch after the S139 cheek-oval migration.**

The original system (pre-S139) used `_ptInHandZone` — a single CENTER ellipse, rx=0.32, ry=0.40 — which matched the CSS `.hand-zone` div exactly. Evidence at `vac-reauth-ceremony.js` line 473–484:

```javascript
// Line 473 (comment, now stale):
// ZONE: a central ellipse centered at (0.5,0.5) with normalized radii RX x RY that EXACTLY
// match the drawn .hand-zone guide (div 64% x 80% of frame => radii 0.32 x 0.40 ...)
const _HAND_ZONE_RX = 0.32, _HAND_ZONE_RY = 0.40;   // === the .hand-zone div (64% x 80%)
function _ptInHandZone(p) { ... }   // DEAD CODE — never called
```

The S139 refactor replaced the center-oval test with `GESTURE_ZONE_SPEC` (two cheek ovals, smaller radii) and updated the canvas drawing functions (`_drawFingerTargetGuide` line 831, `_avDrawHand` line 931) to read from `GESTURE_ZONE_SPEC`. **But the static HTML SVG `.hand-zone` ring was not updated** — it still draws the old center oval.

**Evidence line:** `vac-reauth-ceremony.js` line 481:
```javascript
const _HAND_ZONE_RX = 0.32, _HAND_ZONE_RY = 0.40;   // === the .hand-zone div (64% x 80%)
```
This constant is dead code (zero callers), but its MATCHING HTML element (the `.hand-zone` SVG div) is still live and still drawn on screen. The comment "EXACTLY match" was true before S139 but is false now — the acceptance gate migrated but the visual guide did not.

**Consequence:** The CSS ring (z-index:5) renders above the canvas cheek ovals (z-index:4), so the user primarily sees the wrong (center) guide. A hand in the center passes the visual test but fails the acceptance gate; a hand beside the cheek passes the gate but falls outside the visual ring.

**Classification:** Stale-remnant mismatch (NOT a normalized-vs-pixel mismatch, NOT a mirror/flip mismatch, NOT an origin-offset issue). Both systems use normalized coordinates consistently; the divergence is purely that one system migrated to a new geometry and the other was not updated.

---

## 4. Proposed SSOT Function Signature

Replace the static SVG `.hand-zone` ring with a canvas-drawn guide that reads from `GESTURE_ZONE_SPEC`. Both the acceptance test and the drawn guide then share the same spec object.

```javascript
/**
 * drawCheekZoneGuide(ctx, w, h, options)
 *   ctx    — CanvasRenderingContext2D (already has CSS scaleX(-1))
 *   w, h   — canvas pixel dimensions
 *   options.activeSide — 'left' | 'right' | null (null = both dim-equal)
 *   options.confident  — boolean (true = glow the active oval)
 *   options.spec       — optional override; defaults to GESTURE_ZONE_SPEC
 *
 * Pseudocode:
 *   spec = options.spec ?? GESTURE_ZONE_SPEC
 *   for each oval in spec.ovals:
 *       isActive = (oval.side === options.activeSide)
 *       draw ellipse at (oval.cx * w, oval.cy * h)
 *                  with radii (spec.rx * w, spec.ry * h)
 *       apply glow style if isActive && options.confident, else dim style
 *   remove: static .hand-zone SVG div (both #handZonePreflight and #handZone)
 */
```

**Call sites after fix:**
1. `_avDrawHand` (pre-flight): calls `drawCheekZoneGuide(ctx, w, h, { activeSide: _nearSide, confident: _avZone })`
2. `_drawFingerTargetGuide` (gesture step): calls `drawCheekZoneGuide(ctx, w, h, { activeSide: side, confident: _confident })`
3. `_handNearFaceZone` (acceptance): continues reading `GESTURE_ZONE_SPEC` directly — no change needed

Both drawing call sites and the acceptance gate now read from `GESTURE_ZONE_SPEC` exclusively. The stale `.hand-zone` SVG ring is removed.

---

## Summary

| | Accept Zone | Drawn Guide |
|---|---|---|
| **File** | `vac-reauth-ceremony.js` L492–516 | `vac-reauth-ceremony.js` L4881–4885, 4997–5001 |
| **Shape** | Two cheek ovals | One center ellipse |
| **Centers** | (0.18, 0.48) and (0.82, 0.48) | (0.50, 0.50) |
| **Rx** | 0.17 | 0.32 |
| **Ry** | 0.22 | 0.40 |
| **Source** | `GESTURE_ZONE_SPEC` (live, S139) | Static SVG (stale, pre-S139) |

**Root cause line:** `vac-reauth-ceremony.js` **line 481** — `_HAND_ZONE_RX = 0.32, _HAND_ZONE_RY = 0.40` is dead code, but its paired static HTML ring (line 4883 / line 4999) is still rendered, producing the mismatch.

**Note on pre-resolved files:** The task listed `vac-finger-detect.js` and `finger-test.html` as the relevant files. Neither contains zone geometry — `vac-finger-detect.js` only has finger-angle counting helpers; `finger-test.html` has no spatial zone at all. The actual defect lives entirely in `vac-reauth-ceremony.js`.
