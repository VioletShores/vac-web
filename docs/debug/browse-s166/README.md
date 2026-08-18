# S166j /browse attempt — iPhone 430x932 walk of the ceremony (item 8)

**Status: screenshots NOT captured.** This sandbox has no root/sudo and no configured apt sources
(`apt-get update` fails with `Permission denied` on `/var/lib/apt/lists`), so the shared libraries
Playwright's Chromium needs (`libglib-2.0.so.0`, `libnss3.so`, `libX11.so.6`, ~20 others) cannot be
installed. `npx playwright install chromium` succeeds (downloads the binary), but the browser
cannot launch — every `chromium.launch()` call fails with
`error while loading shared libraries: libglib-2.0.so.0: cannot open shared object file`.

This is an environment limitation, not a code issue — flagging it rather than fabricating
screenshots. `scripts/browse-s166.js` (checked in) is a ready-to-run Playwright walk of the
ceremony at the 430x932 viewport (landing → identity → camera/mic preflight → greeting → digits
1-3 → verifying/result), using `--use-fake-device-for-media-stream` so it needs no real camera/mic
and no manual interaction. Run it in any environment with working Chromium (e.g. CI, or a laptop):

```
python3 -m http.server 8899 &
npx playwright install chromium   # once
node scripts/browse-s166.js
```

Screenshots land in this directory (`docs/debug/browse-s166/`), numbered by screen.

## What was done instead

Static review of every canvas-drawn caption and the CSS for the screens item 8 lists, at 430px
width:

- **Squashed captions (item 7):** this WAS a real, confirmed bug — the pose-caption pill had an
  aspect-compensation fix (S166) but the zone-hint readout and the QA fingers/mic readout did not,
  so they still squashed on any camera box whose CSS aspect ratio differs from the video's native
  resolution. Fixed by factoring the compensation into one shared helper
  (`_canvasAspX`/`_applyCanvasAspComp`) and applying it to all four canvas text draws. See the
  vac-reauth-ceremony.js diff and `tests/confirmed-behaviors.test.js` (CB-ZONE-03, now passing with
  the shared helper injected into its extraction sandbox).
- **CSS overflow/clipping:** grepped every `white-space:nowrap` and fixed-pixel-width rule reachable
  from the ceremony/auth screens. All fixed-width containers use `max-width` (420-560px) with
  `margin:0 auto` inside a `.page` that itself clamps to the viewport — none exceed 430px in a way
  that would clip on the target device. The two `nowrap` labels found
  (`.face-oval-label`/`.hand-zone-label`) hold short fixed strings ("FACE" zone / device labels);
  `.hand-zone-label` is hidden on the capture screen already (`#cameraBoxRec .hand-zone-label {
  display: none !important; }`, F-760). No new clipping/overlap found beyond the squash bug already
  fixed.

This is a code-level review, not a substitute for the real /browse screenshots — re-run
`scripts/browse-s166.js` in an environment with working Chromium before signing off on the visual
QA for this task.
