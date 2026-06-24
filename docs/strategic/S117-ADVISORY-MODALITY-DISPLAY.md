# S117 — Advisory Modality Display (UI honesty fix)

**Status:** BUILT · FOR ROB REVIEW (not yet shipped to prod at write time)
**Scope:** `auth.html` only — pure presentation in the "Verification Modalities" results list.
**Surfaces:** the results list on `auth.html` AND `tribunal-demo.html` (which embeds `/auth.html` in an iframe via `VERIFY_SRC = '/auth.html'`, so the single fix covers both).

## Problem

The modality results list rendered **Finger Gesture** and **Duress Detection** with a
green/red pass/fail dot and a colored score — visually identical to the MANDATORY
modalities (Face Liveness, Speech Match, Lip-Sync, Challenge Response, Deepfake).

But per `compute_honest_verdict` in vac-protocol `engine.py`, those two are **ADVISORY**:

- **Finger Gesture** is NEVER consulted in the auth verdict — `D-F577-D3-FALSE-ACCEPT`,
  a known false-accept means it cannot gate auth yet.
- **Duress** is a **deny-signal**, not a pass/fail score — a "clear" result is not a "pass."

So a user saw e.g. **Finger Gesture 0.43 with a red ✗** sitting next to a **VERIFIED**
badge, and the header read **"6/7 passed"** in red. That reasonably reads as "the system
is broken" or "this score is meaningless / the auth half-failed," when in fact the verdict
was clean on all five mandatory gates.

## Change (presentation only)

No backend, no score, no verdict logic, no modality-requirement change. Three edits in `auth.html`:

1. **Grouping** — a new `Advisory signals — informational, did not affect the verdict`
   subheading (`.mod-subhead`, top-border separator) splits the two advisory rows away
   from the five mandatory rows.
2. **Neutral row treatment** — `updateModality` now renders any `.advisory` row with a
   muted neutral dot (`•`, `--text-tertiary`) and a muted score (`.mod-score.advisory`)
   **regardless** of pass/fail, instead of the green ✓ / red ✗ + green/red score. The
   percentage stays visible (it is informative) but no longer looks like a gate. Each
   advisory row also gets an inline chip: `Advisory · not required` (finger) /
   `Advisory · deny-signal` (duress). The true per-row status still lives in the
   expandable engine detail (e.g. `Expected: [2, 4] / Gemini saw: [1, 4]`,
   `Status: ✅ Clear`).
3. **Honest headline count** — `updateModalitySummary` now counts only the five mandatory
   modalities. `modFinger` + `modDuress` are omitted (same list that already omits
   `modDidit`). This both stops the advisory rows from flipping the header to a red
   "X/Y passed" and prevents a neutral `•` from freezing the header at "Checking…"
   (a `•` is neither ✓ nor ✗).

## Before / After

| | Before | After |
|---|---|---|
| Header | **"6/7 passed"** in **red** (has-fail) | **"5/5 passed"** in green |
| Finger Gesture | red ✗ + red `0.43` (looks like a failed gate) | neutral `•` + `Advisory · not required` chip + muted `0.43` |
| Duress Detection | green ✓ + green `0.02` (looks like a passed gate) | neutral `•` + `Advisory · deny-signal` chip + muted `0.02` |
| Grouping | advisory rows inline with mandatory, no distinction | under an `Advisory signals` subheading, separated |

**Screenshots** (results state simulated headless — no camera in the QA browser — by
injecting mock modality results; finger forced to the `0.43` honesty case):

- Before: `docs/strategic/screenshots/S117-advisory-before.png`
- After: `docs/strategic/screenshots/S117-advisory-after.png`

## Out of scope (noted for Rob)

The hard-failure card (`failReasons`, only shown when auth actually fails) still builds its
`failed[]` from any modality with `status === 'failed'`, so a finger mismatch can appear in
that card's reason list / drive the "try a slower speed" tip. That surface is separate from
the results list and only shows on a real failure (not the VERIFIED case in this task), and
the slower-speed tip is genuinely useful UX. Left untouched to keep this change pure
presentation in the results list; flag if you want the advisory framing extended there too.
