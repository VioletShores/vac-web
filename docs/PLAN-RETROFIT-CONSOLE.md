# PLAN: Governance Console v1 Demo (F-865)
## retrofit-console.html — Wizard → Manifest → Dashboard

> Console preview — illustrative extraction | Seal action = LIVE PRODUCTION

---

## ASCII Wizard State Flow

```
 ┌─────────────────────────────────────────────────────────────────┐
 │  STEP 1 — Your system                                           │
 │  [dropdown] Water digital twin (AQP-class)                      │
 │             SCADA-ADMS                                          │
 │             Case management                                     │
 │             Custom                                              │
 │                                                                 │
 │  Selection → seeds STEP 2 decision-point list                   │
 └───────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │  STEP 2 — Decision points                                       │
 │  [multi-select checklist, pre-populated per system]             │
 │  Badge: "example extraction — the product does this from SOPs"  │
 │                                                                 │
 │  Water twin examples:                                           │
 │  ☑ Accept Stage-1 pressure reduction                            │
 │  ☑ Approve meter-anomaly response                               │
 │  ☑ Authorise valve actuation                                    │
 │  ☑ Sign off network-model change                                │
 └───────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │  STEP 3 — Assurance tiers                                       │
 │  Per selected decision point → tier dropdown:                   │
 │  • Operational acceptance (Tier 2 — verified person)            │
 │  • Safety-critical actuation (Tier 3 — step-up + dual option)   │
 │  • Financial approval (Tier 2 + threshold step-up)              │
 │                                                                 │
 │  One-line "what the ceremony requires" shown per tier           │
 └───────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │  STEP 4 — Authority                                             │
 │  Role dropdowns → sample delegates:                             │
 │  • NOC engineer                                                 │
 │  • Duty manager                                                 │
 │  • Compliance officer                                           │
 │  Note: production → ingested from your SSO (SCIM)              │
 └───────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │  STEP 5 — Rails                                                 │
 │  ☑ EU AI Act pack v1 (version-stamped)                          │
 │  Jurisdiction dropdown (AU / UK / EU / US-state)                │
 │  Caption: "regulation as configuration"                         │
 └───────────────────────┬─────────────────────────────────────────┘
                         │
              [ Build deployment manifest → ]
                         │
                         ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │  DASHBOARD (payoff)                                             │
 │                                                                 │
 │  (a) DEPLOYMENT MANIFEST card                                   │
 │      Versioned JSON rendered from actual wizard selections      │
 │      "sealed on issue" note · monospace                         │
 │                                                                 │
 │  (b) INTEGRATION card                                           │
 │      3 real API curl snippets:                                  │
 │      POST /v1/vat/issue      — mint a session-bound token       │
 │      POST /v1/vat/authorize  — seal a decision with manifest id │
 │      GET  /vat/verify/:jti   — verify the sealed record         │
 │      API_BASE = https://vac-system-production.up.railway.app    │
 │                                                                 │
 │  (c) EVIDENCE card                                              │
 │      Link to /eu-ai-act.html                                    │
 │      "each deployment generates a living evidence page"         │
 │                                                                 │
 │  (d) LIVE ACTION button — "Run a sealed acceptance now — LIVE"  │
 │      Opens /auth.html ceremony (VERIFY_SRC pattern)             │
 │      After pass → calls /v1/vat/authorize action=seal_decision  │
 │      LABEL: LIVE PRODUCTION                                     │
 └─────────────────────────────────────────────────────────────────┘
```

---

## Honesty Contract

| Surface | Label |
|---------|-------|
| All 5 wizard steps | `Console preview — illustrative extraction` |
| Manifest card | `Preview manifest · not yet submitted` |
| Integration snippets | `Real endpoints · illustrative manifest ids` |
| LIVE ACTION button | `LIVE PRODUCTION · this calls the real VAC backend` |

---

## Tech Stack

- House style: `#0A0F1A` shell / `#0F1524` cards / `#C9A227` gold
- Fonts: Fraunces (headings) / Inter (body) / JetBrains Mono (code + labels)
- Stepper dots: numbered circles, active/done state via JS classList
- Mobile-first, `clamp()` sizing
- No emoji, custom SVG only
- API_BASE: `https://vac-system-production.up.railway.app`
- Ceremony: VERIFY_SRC = `/auth.html` iframe overlay (reuses trusted-water-demo pattern)

---

## File Targets

- `/retrofit-console.html` — new file (zero touches to vac-reauth-ceremony.js)
- `/vercel.json` — add `/retrofit-console` → `retrofit-console.html` rewrite
- `/docs/PLAN-RETROFIT-CONSOLE.md` — this file

---

## Design-Review Simulation

**Structure** ✓ — 5 distinct wizard steps with clear data flow, dashboard as terminal state  
**Honesty** ✓ — preview/live labels mapped to correct surfaces  
**API realism** ✓ — endpoints read directly from tribunal-demo/trusted-water-demo source  
**Style fidelity** ✓ — tokens from capabilities page, stepper pattern from trusted-water-demo  
**Mobile** ✓ — clamp sizing, single-column wizard, stacked dashboard cards  
**Scope** ✓ — retrofit-console.html only; no touches to ceremony JS  
