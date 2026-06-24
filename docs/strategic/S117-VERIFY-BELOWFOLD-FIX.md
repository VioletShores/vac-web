# S117 — D-VERIFY-CHECKS-BELOW-FOLD fix (auth.html)

**Status:** shipped to main, pending Rob review before considered blessed.
**SHA:** `3a953f4538422e6e2e281a0d37839bfffbe97a58`
**Scope:** pure layout/CSS + DOM order. No detection logic, no `vac-finger-detect.js`,
no challenge flow, no backend touched.

## Problem

On Step 2 ("Camera & Mic") of `auth.html`, the `.camera-container` was capped at
`clamp(200px, 40vh, 320px)` and — worse — the live checklist (`#preRecordChecklist`:
mic-level meter, the guided "Step N of 3" instruction, and the Light/Mic/Hand status
pills) rendered **below** the primary button in DOM order.

Result on a standard ~800px laptop viewport: the disabled button reading **"Complete
the checks above"** was on-screen, but the checks it pointed at were off-screen below
it. The user saw their face and a greyed-out button with no visible indication that
action was required underneath — it looked stuck until they scrolled. The copy was also
backwards: it said "above" while the checks rendered below.

## Fix

1. **Reorder (the real fix):** moved `#preRecordChecklist` to sit **directly under the
   camera**, with the privacy statement + button now following it. The checks are now
   in view immediately, and the button's "Complete the checks above" copy is literally
   true (checks are above it). Pure DOM reorder — all JS references elements by
   `getElementById`, so no behaviour changes.
2. **Cap the feed:** `max-height` `clamp(200px, 40vh, 320px)` → `clamp(180px, 36vh, 300px)`
   so the camera no longer dominates the fold. Aspect ratio (4/3) unchanged.

No copy string needed changing — the reorder made the existing "Complete the checks
above" accurate.

## Verification (1280×800, live https://vacprotocol.org/auth.html)

Measured top/bottom of each element against the 800px fold. Headless Chromium has no
camera/mic, so the post-enable checklist state was simulated via JS to capture the
real rendered layout (DOM order + CSS heights are exactly what ships).

| Element | Before (old layout) | After (this fix) |
|---|---|---|
| Camera feed | 270–590 ✓ | 270–558 ✓ |
| Mic-level meter | (below) | 566–661 ✓ |
| Step instruction ("Step 3 of 3…") | **812–886 ✗ below fold** | 669–743 ✓ |
| Light/Mic/Hand pills | **896–927 ✗ below fold** | 753–784 ✓ |
| Button "Complete the checks above" | 653–701 (above the checks ✗) | 841 (below the now-visible checks ✓) |

Goal met: camera **+** live status row **+** active-step instruction are all visible
together without scrolling. The disabled button now sits just under the visible checks
it references (it auto-enables / advances once the three checks pass).

## Screenshots

- Before (bug): `docs/strategic/assets/S117-verify-belowfold-before-1280x800.png`
  — button "Complete the checks above" visible; instruction + status pills off-screen below.
- After (fixed): `docs/strategic/assets/S117-verify-belowfold-after-1280x800.png`
  — camera, mic meter, "Step 3 of 3" instruction, and Light/Mic/Hand pills all in view.

## Out of scope

The tribunal re-auth overlay (`vat-verify.html`) does **not** share this component — it
uses its own `.ra-camera` card (portrait 3/4, `max-height: 340px`) built from JS string
templates with a different status flow, and has none of the `Complete the checks` copy.
No change made there.
