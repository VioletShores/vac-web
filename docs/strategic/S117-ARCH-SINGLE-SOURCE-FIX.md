# S117 — D-ARCHITECTURE-NOT-WIRED-TO-TRIBUNAL

**Status:** Shipped to main — FOR ROB REVIEW
**Date:** 2026-06-24
**Files:** `tribunal-demo.html`, `vercel.json`
**Commits:** `405c61a` (dedupe), `61e1221` (fix), see SHA section below

## Problem

The tribunal demo (`tribunal-demo.html`) carried its **own** embedded
"How it works end-to-end" tab (`#tab-arch`) with a **stale 5-node architecture
explanation**:

1. Verified parties
2. Policy-carrying packet
3. Condition evaluation
4. Human authorises
5. Sealed & lodged decision

The standalone `architecture.html` is the **current, stronger** version. It has
honest capability badges (`BUILT · LIVE` / `BUILT · MERGING` / `PLANNED`) and
prominently features the two real differentiators:

- **Assurance proportional to the action — decided, not hardcoded** (a risk
  controller decides how much proof each action needs).
- **The action is gated AND the decision is audited** — including refusals,
  written to an immutable Action Attestation Record.

The tribunal embedded tab **omitted both** differentiators. A tribunal user saw
the weaker, older story and had **no path** to `architecture.html`. The two
sources had drifted, and the tribunal one was losing.

## Fix

Make `architecture.html` the **single source of truth** and stop the drift,
low-risk (no tab-system restructure):

1. **Replaced** the stale `.arch` 5-node diagram block inside `#tab-arch` with:
   - A short, honest end-to-end summary (4 bullets) reflecting the **current**
     `architecture.html` capabilities — verified human root, **assurance
     proportional to the action (decided, not hardcoded)**, the action
     **gated AND audited** (incl. refusals), and **signed,
     independently-verifiable receipts** (Ed25519).
   - A prominent link: **"See the full architecture and honest capability
     status →"** pointing to `/architecture`.
2. **Kept** the existing `arch-note` paragraph and the `more-cases` /
   high-stakes-domains section that follow.
3. **Did not touch** the tab-switching JS, the walkthrough tab, the seal flow,
   or the fast-reauth panel.
4. **Added** the `/architecture → /architecture.html` rewrite to `vercel.json`
   so the link resolves (it returned **404** before; now **200**).

Styling matches the existing tribunal dark Athena/VAC system (new
`.arch-summary*` classes reuse `--surface`, `--border`, `--teal`,
`--text-*`; the CTA reuses the existing `.cta-btn`). No emoji — the `→` glyph
matches existing CTA usage on the page.

## Before / After

### Before
- `#tab-arch` contained 5 `.arch-node` cards: *Verified parties / Policy-carrying
  packet / Condition evaluation / Human authorises / Sealed & lodged decision.*
- No mention of proportional assurance or the gate+audit layer.
- No link to `architecture.html`.
- `GET /architecture` → **404** (no vercel rewrite).

### After
- `#tab-arch` contains a 4-bullet honest summary covering verified human root,
  proportional assurance (decided not hardcoded), gate+audit (incl. refusals),
  and signed receipts.
- Prominent **"See the full architecture and honest capability status →"** CTA
  links to `/architecture`.
- `GET /architecture` → **200**, serves the current `architecture.html` with
  `BUILT · LIVE` / `BUILT · MERGING` badges.
- Verified live click-through: tribunal arch tab → `/architecture` loads.

## Verification (live, via /browse on vacprotocol.org)

- Loaded `https://vacprotocol.org/tribunal-demo.html`, clicked
  **"How it works end-to-end"** → `.arch-summary` visible, all 4 bullets render.
- Clicked **"See the full architecture and honest capability status →"** →
  navigated to `https://vacprotocol.org/architecture` (200), `architecture.html`
  hero and capability badges render.
- `curl` checks: `/architecture` → 200 (was 404); tribunal page contains the new
  `arch-summary` markup.

## Screenshots

- `screenshots/S117-arch/01-tribunal-arch-tab-new-summary.png` — tribunal "How it
  works end-to-end" tab showing the new summary + link.
- `screenshots/S117-arch/02-architecture-page-loaded.png` — `/architecture` page
  reached by clicking the link, showing the current capability-badged story.
