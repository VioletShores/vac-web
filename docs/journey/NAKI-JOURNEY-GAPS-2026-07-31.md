# Naki journey test — gaps, blockers, confusions, polish

Retry of task-462 (originally failed before producing a report). Branch: `task-462b-journey-test`.

**Persona:** Naki (Nakibirango), the recipient of the private onboarding pager. Non-technical-ish
professional at a company (implied: Finova-adjacent / financial services leadership context) writing
a paper for her employer's leadership on governed AI adoption. She received the pager link after a
tennis-club conversation with Rob and is being walked toward AthenaPilot access.

**Method note:** stated per page/section below (`/browse` live render vs. static curl+HTML audit).

**Widths tested:** mobile (~390px) and desktop (~1280px) where the method allows it.

**Status:** IN PROGRESS — this file is committed after every section so a crash never loses findings.

---

## Surfaces in scope

1. `p/onboard-preview-9c4e71d2a8b5.html` — the onboarding preview Naki would walk through
2. `p/naki-3bd20e1222bf.html` — the private pager written for her
3. The demo page the pager links (`financial-demo`)
4. `eu-ai-act.html` — linked from onboard-preview step 2
5. Every other link discoverable from the above (signalrank-live pager, story pager, IETF drafts,
   `/tribunal-demo`, WhatsApp deep links, hub placeholder, etc.)

---

## Findings log

(Sections below fill in as each surface is tested.)
