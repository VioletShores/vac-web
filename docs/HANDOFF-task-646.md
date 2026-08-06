# HANDOFF — task-646-zone-guide-visibility

**Status: FLASH DONE — pushed to main (9def04f), Vercel deploying**  
**Date: 2026-08-06**  
**For: Rob's combined retest on live iPhone**

---

## What shipped

Double-stroke halo on the cheek-zone guide ovals — makes them readable over both bright and dark camera feeds on mobile.

### Visual change

When the zone is EMPTY (hand not yet raised):
- **Dark outer ring** `rgba(10,15,26,0.85)` — reads on bright backgrounds (typical bright iPhone front-camera feed)
- **Gold inner ring** `rgba(212,169,78,0.95)` — reads on dark backgrounds
- Both dashed `[max(10px, w×2.4%), max(5px, w×1.2%)]` — longer dashes than before
- Gentle 1.2s cosine opacity pulse [0.65→1.0] draws the eye

When hand IS in zone: unchanged solid green confirmation  
When wrong-cheek oval: unchanged faint ghost (no halo signal)

### lineWidth scaling

- Outer floor: `max(3×DPR, w×0.006)` — at DPR=3: min 9px physical
- Inner floor: `max(2×DPR, w×0.003)` — at DPR=3: min 6px physical
- Outer always > inner (no floor collapse — differentiated multipliers)

### Files changed

| File | What |
|------|------|
| `vac-reauth-ceremony.js` | `_drawFingerTargetGuide` + `_avDrawHand._drawAvCheekOvals`: double-stroke halo, try/finally ctx guard |
| `tests/confirmed-behaviors.test.js` | 7 new CB-ZONE-03 tests (spy ctx, Node.js, no browser) |
| `tests/fixtures/confirmed/founding-rows.json` | CB-ZONE-03 row with draw-call minimums |
| `docs/CONFIRMED-BEHAVIORS.md` | CB-ZONE-03 section |

### Geometry unchanged

`rx`, `ry`, `gap` constants untouched — owned by task-644.

---

## Gates passed

- `node --check vac-reauth-ceremony.js` → SYNTAX OK
- `node --test tests/confirmed-behaviors.test.js` → 22/22 pass (0 fail)
- `/review` adversarial pass → 4 real findings fixed (F1 try/finally, F2 DPR floor, F3 pulse test coverage, F4 outer>inner assertion)
- `/browse` desktop → page loads, 0 JS errors

---

## For Rob's retest

1. Open auth.html on iPhone (after Vercel deploy completes, ~60s)
2. Start ceremony → reach the gesture step (cheek-zone ovals)
3. Confirm: ovals are now clearly visible with a dark-outer/gold-inner double ring
4. Confirm: ovals pulse gently while hand is not raised
5. Confirm: solid green confirmation when hand moves into zone (unchanged)

---

## Learnings (task-646)

**DPR floor collapse**: If outer and inner strokes use the same `Math.max(N×dpr, w×frac)` formula with the same N, they can floor-collapse to identical widths at typical DPR×canvas combos, making the "double stroke" invisible. Fix: use `3×dpr` for outer, `2×dpr` for inner.

**Spy ctx pulse coverage**: `performance.now()` returning 0 in tests gives pulse=1.0 (same as canvas default globalAlpha), so a deleted pulse assignment passes silently. Use mid-cycle time (e.g. 600ms for a 1200ms period) to make pulse != 1.0, then assert `alpha < 1.0`.

**try/finally for ctx.save()**: `ctx.save()` without try/finally leaks globalAlpha if any drawing primitive throws (e.g. NaN radius during a startup race). The leak persists for the page lifetime — the entire canvas stays at the locked alpha value. Always wrap the body in try/finally.
