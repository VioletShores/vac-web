# VAC / Athena brand rails

Source of truth for the gold-on-ink dark theme now established across the `p/*.html` brief
pages. This doc + `vac-hexagon.svg` + `athena-owl.svg` are the canonical assets — new pages
should reference these instead of re-drawing marks inline.

## Colors

```css
:root{
  --bg:     #0A0F1A;  /* page background */
  --panel:  #101827;  /* card / panel surface */
  --panel2: #0D1420;  /* recessed surface (code blocks, wells) */
  --line:   #1E2A3D;  /* borders, dividers */
  --ink:    #E8EDF5;  /* primary text */
  --ink-dim:#93A1B8;  /* secondary text */
  --gold:   #C9A227;  /* primary gold — hexagon outline, emphasis */
  --gold2:  #D4A94E;  /* secondary gold — the "--gold" var already in use across p/*.html,
                          owl mark, links, headings, accents */
  --gold-dim:#8A7233;  /* borders/dividers on gold panels */
}
```

**Naming note:** every existing `p/*.html` page defines its own `--gold: #D4A94E` (what this
doc calls `gold2`) — that's already the working accent color site-wide. `#C9A227` (`--gold`,
primary) is a new, slightly deeper token reserved for the hexagon mark itself, so the logo
reads as a shade distinct from body accents/links. When retrofitting a page, keep its existing
`--gold` variable name pointed at `#D4A94E` — don't rename it — and add `--gold2`/`--gold-dim`
alongside it if the hexagon mark is added.

Secondary status colors already in use and worth keeping as part of the rail:
`--green:#5FB87A` (success/done), `--red:#D9705F` (warning/hold), `--blue:#6FA8DC` (info links,
sparingly — not a default anchor color, see rules below).

## Fonts

```
Fraunces      — headings (h1/h2), serif, editorial weight. Load weights 500 + 650.
Inter         — body text, UI chrome. Weights 400/500/600.
JetBrains Mono— eyebrows, labels, code, timestamps, anything numeric/technical.
```

Google Fonts import used across existing pages:
```
https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,650&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap
```

## Logo usage

- **`vac-hexagon.svg`** — the protocol mark. Two nested hexagons (outer stroke, inner
  fill+stroke). This is the same double-hexagon geometry used site-wide as the VAC logo
  (`auth.html`, `index.html`, `dashboard.html`, `org-*.html`, etc.) — those pages currently
  render it inline with per-page colors (purple `#6C5CE7` is the dominant existing color,
  green `#3FB950` on the auth success/OTP-verified state, navy `#1a3a5c` on the homepage).
  The extracted asset here recolors it to the gold rail (`--gold` outer, `--gold2` inner) as
  the brand-forward version for gold-themed surfaces (briefs, hub, investor pages). It does
  **not** replace the purple/green/navy inline versions on the product surfaces — that's a
  separate, riskier swap tracked as future work, not this lane.
  - Minimum size: 18px. Below that, drop the inner hexagon and render outer stroke only.
  - Never stretch non-uniformly; always square viewBox.
  - On dark panels: gold on `--bg`/`--panel`. On light/white backgrounds: use the outer
    hexagon only, in `--ink` or black — gold-on-white reads muddy.

- **`athena-owl.svg`** — the constellation owl. Extracted verbatim (geometry + color) from
  `p/psc-memory-6e7bd1c565c2.html:50-60`, where it's the page masthead mark (also present,
  without the outer star-field circles, in `p/rob-hub-0f17c4a9ab36.html:53-58`). Two eye-circles
  with center dots, a small chevron beak, an outer constellation ring, and three loose
  "star" points scattered around it. Gold-only, no fill except the eye-centers and stars.
  - Use as a masthead/header mark on brief-style `p/*.html` pages and the hub — it currently
    signals "Athena-authored" the way the hexagon signals "VAC Protocol."
  - Don't recolor it off-gold; the constellation reads specifically as gold dots on dark.
  - Don't use it and the hexagon in the same lockup without deliberate hierarchy — pick one
    as primary per page (hexagon = protocol/product surfaces, owl = Athena
    briefs/hub/internal).

## Hard rules

- **No emoji.** Status/decoration symbols are typographic (✓ ✗ ★ ⚠), not pictograph emoji
  (🎉 🚀 💡 📄). The existing brief pages already lean on ✓/✗/★ for status — that's fine and
  should stay; true pictograph emoji should not be introduced.
- **No default blue links.** Every page must set `a{color:...}` explicitly (gold or the muted
  `--blue:#6FA8DC` for external/reference links) with an intentional `text-decoration`. An
  unstyled `<a>` renders browser-default blue+underline, which reads as a broken/unstyled page
  against this dark theme.

## KNOWN-OFFENDERS (inventory only — not fixed in this lane)

Scope: `p/*.html` (22 files) + `athena-hub.html`. Grepped for inline `<svg>` owl marks, logo
marks, missing brand fonts, and missing global link styling. **No mass replacement below —
review first, fix in a separate lane.**

### Inline owl SVGs (candidates to replace with `athena-owl.svg`)
- `p/psc-memory-6e7bd1c565c2.html:50-60` — full owl w/ star field, `class="owl"`. Source of the
  extracted asset.
- `p/rob-hub-0f17c4a9ab36.html:53-58` — same owl geometry, no outer star-field circles, no
  outer ring `<circle>`, inline in the header (no class).

### Logo marks inconsistent with the hexagon/owl system
- `athena-hub.html:148` — `.hub-logo` renders a **shield+checkmark** icon
  (`stroke="#22c55e"`, green, Lucide-style `shield-check`), not the VAC hexagon or the Athena
  owl. This is the hub's masthead mark and currently doesn't match either canonical logo.
- `athena-hub.html:182` — a 5-point star `<polygon>` used as a UI icon (favorite/rating), not a
  logo mark — flagged only so it isn't confused with the hexagon polygon pattern during a
  future find-replace pass.

### Pages missing the brand font stack
- `p/rob.html` — `font-family:monospace` only; no Fraunces/Inter/JetBrains Mono import, no
  gold palette vars at all. Oldest-looking page in `p/`, likely predates the gold rail.
- `p/eu-ai-act-0a7f7d81477d.html` — no `font-family` declaration found, no gold palette vars.
- `p/ietf-brief-4e6123b6f1bb.html` — no explicit `font-family` on `body`/`*` (relies on
  browser default sans); **does** already use the gold vars (`--gold:#D4A94E`) elsewhere, so
  it's a partial offender — just missing the font import/declaration.
- `athena-hub.html` — uses `--sans: 'DM Sans', -apple-system, sans-serif`, not Inter. Whole-hub
  font swap is a bigger call (hub has its own established look) — flagged, not queued.

### Pages missing explicit link styling (default-blue-link risk)
- `athena-hub.html:197` — two `<a href>` tags (`vacprotocol.org`, `athenapilot.ai`) with no
  `style=`/`class=` and no global `a{color:...}` rule anywhere in the file. These will render
  browser-default blue+underline against the hub's dark theme unless a browser/extension
  stylesheet overrides them.
- All 22 `p/*.html` files were checked for a global `a{}` rule: 21/22 already define one
  (mostly `a{color:var(--gold);text-decoration:underline;...}`, `p/dev-review-s144.html` uses
  `a{color:var(--blue)}`) — **not** offenders. `p/rob.html` and `p/eu-ai-act-0a7f7d81477d.html`
  have no gold vars to key off in the first place (see font-stack list above); their link
  color wasn't separately re-checked since the font/palette gap is the bigger issue.

## Extraction notes (for reviewers)

The task brief for this lane assumed the hexagon mark lives in an OTP email template under
`templates/` or a backend directory. Neither exists in this repo — per prior findings, the VAC
backend lives in the separate `vac-protocol` repo (Railway-deployed), and this repo has no
`templates/` directory or email-rendering code (`engine.py` at repo root is a stale copy, OTP
logic only, no markup). The closest analog inside `vac-web` is the hexagon mark shown on the
OTP-verified success state in `auth.html:451-452` (green `#3FB950` there) — same geometry as
every other inline hexagon in the repo. `vac-hexagon.svg` extracts that shared geometry,
recolored to the gold rail per this doc's color spec, rather than the literal email template
(which isn't in this repo to extract from).

The owl had no prior "extract from X" instruction in the brief and no dedicated asset file
existed anywhere in the repo (`find . -iname "*.svg"` before this lane returned only two
files, neither an owl). It was located by grepping for `owl` as a CSS class name rather than
a file — see `p/psc-memory-6e7bd1c565c2.html:50-60` above. `athena-owl.svg` is a verbatim
extraction of that inline markup, not a new design.
