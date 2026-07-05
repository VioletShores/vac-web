# F-703 Trusted-Water Demo — Implementation Plan

**Date:** 2026-07-05  
**Branch:** task-f703-water-demo  
**Audience:** AQP innovation lead — self-serve, 5 minutes, no handholding

---

## What we're building

Two deliverables:

### 1. Water domain card on tribunal-demo (closes ux-audit #27)

Add a 4th card to the `more-cases` grid on `tribunal-demo.html`:

> **Water network AI & operations** — An AI system recommends a pressure reduction or leak-response dispatch on a district metered area. VAC seals the approving engineer's authority, the action conditions, and the outcome — giving the regulator a cryptographically verified trail of who authorised what, under which operational rules, and when.

Includes a deep-link button to `/trusted-water-demo` so an interested engineer can explore the full scenario immediately.

### 2. Standalone `/trusted-water-demo` route

**File:** `trusted-water-demo.html`  
**Route:** `/trusted-water-demo` (vercel.json rewrite)

#### Scenario (representative, labeled)

*AI recommends pressure reduction on District 14 (Northside DMA) following elevated overnight leakage index → Network Operations Centre engineer reviews, verifies authority, VAC seals the authorisation → regulator-grade receipt queryable after the fact.*

#### Page structure

1. **Preview banner** — same amber honesty bar as tribunal-demo: "Representative scenario — the seal and receipt mechanics are real VAC system output."
2. **Minimal header** — VAC logo + "WATER NETWORK · PREVIEW" badge. No nav links to landing page (disclosure gate rule).
3. **Hero** — scenario narrative, audience framing.
4. **Guided walkthrough overlay** — 4-5 step stepper with plain-English labels:
   - Step 1: Scenario — AI flags District 14 anomaly; pressure drop recommended
   - Step 2: Decision — NOC engineer reviews; accepts recommendation
   - Step 3: Authority — VAC verifies the engineer holds operational authority for this DMA
   - Step 4: Seal — VAC seals who + what + when + policy conditions
   - Step 5: Receipt — Regulator-grade sealed receipt, queryable by JTI
5. **Live seal + receipt** — calls real `/v1/vat/issue` + `/v1/vat/authorize`; receipt shows JTI, verify link
6. **F-690 anchor line** in walkthrough: *"The part of the system that checks the work is never the part that did the work."*
7. **Domain cards footer** — thin CTA back to tribunal-demo; no global nav

#### Design system

Identical CSS variables and component classes to `tribunal-demo.html` — copy the `:root` block verbatim. No new visual language, no emoji, brand SVG only.

---

## Commit sequence (L-2189)

1. `[athena-exec] F-703 step 1: plan doc`
2. `[athena-exec] F-703 step 2: water card on tribunal-demo`  
3. `[athena-exec] F-703 step 3: trusted-water-demo.html scaffold + walkthrough`
4. `[athena-exec] F-703 step 4: live seal/receipt wiring + vercel.json`

---

## Hard constraints (never violate)

- Seal/receipt mechanics MUST be real system output — never unlabeled mock data
- Scenario copy MUST be labeled "representative scenario"
- No global nav links to landing page from the standalone route
- No new visual language beyond tribunal-demo design system
- No emoji
