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

### 1. `p/onboard-preview-9c4e71d2a8b5.html` — onboarding preview

**Method:** `/browse` live render (headless Chromium) against the deployed prod URL
`https://vacprotocol.org/p/onboard-preview-9c4e71d2a8b5.html`. Walked all 4 steps end to end,
filled Step 3 with Naki-plausible answers (org: Finova, region: UK, sector: Financial services & AI,
peer: Covecta, watch: Compliance and regulation changes), reached Step 4, ran "Review my answers".
Tested at 390×844 (mobile) and 1280×900 (desktop).

**Works well:**
- Step 3 → Step 4 personalization is real and correct: "Watching: Finova + 1 peer — UK financial
  services & AI" derives properly from the org/competitor/region/sector fields (`buildNamedOrgWatch`
  in the page's own JS), not a canned string.
- "Review my answers" renders a JSON payload in-page and is honest that nothing was sent anywhere —
  matches the page's own MOCK/LIVE BOUNDARY comment in source (no network call for onboarding data,
  only the quill feedback widget calls a real `/v1/feedback` endpoint).
- `sessionStorage` progress-restore works: answers survived a full page reload during testing.
- The four "Test it now" biometric-ceremony link and "See the mapping" (EU AI Act) link both point
  to routes that exist in `vercel.json` (`/tribunal-demo`, `/eu-ai-act.html`).

**Confusions / polish (no blockers found):**
- **POV register shift, Step 4 "Your paper, taken further" card.** The whole page addresses the
  reader as "you" throughout (this is Naki's page — the "Your briefing" card even links her specific
  private pager `naki-3bd20e1222bf.html`). But one sentence drops into third person: *"(Naki's paper
  is headed to Finova's leadership — her seeded watch reads 'Watching: Finova + peers…'.)"* Reading
  this in first person, Naki sees herself described in third person mid-page — a jarring register
  shift. Worth rewriting as "(your paper is headed to Finova's leadership — your seeded watch reads
  …)" for consistency, or dropping the parenthetical since the card above it already demonstrates the
  real derived watch.
  - Minor compounding issue: that parenthetical's example text — `"Watching: Finova + peers…"` —
    doesn't match the actual format the page renders two cards above it
    (`"Watching: Finova + 1 peer — UK financial services & AI"`), so it also reads as a stale/generic
    placeholder next to a working, specific example.
- **Two unrelated microphone affordances on Step 3.** The "Anything else" textarea has its own
  press-to-talk mic (🎤, bottom-left of the field), and the always-present feedback quill (bottom
  fixed-position pencil icon) also has a mic for dictating feedback. Both are visually similar (round
  icon buttons) and do different things — one dictates an onboarding answer, the other sends live
  feedback to Athena. On a form-dense screen this could get used for the wrong purpose (e.g. Naki
  holds the quill mic thinking it fills the "anything else" box).
- **Desktop layout is a centered mobile column, not a desktop-adapted layout.** At 1280×900 the
  `.app` container stays `max-width:520px` centered, leaving ~380px of empty dark space on each side
  through all 4 steps. Not broken, but if Naki opens this on her laptop while drafting the leadership
  paper (plausible — she's writing a paper, likely at a desk) it reads as sparse/unfinished rather
  than intentionally minimal.
- **Feedback quill floats disconnected from content on desktop.** Fixed at `right:16px; top:50%` of
  viewport, so on the wide desktop viewport it sits ~350px away from the actual content column with
  nothing visually tying it to the page. On mobile it's flush against the content edge and reads
  fine.
- **Not independently verified:** clicking "Ask Athena about this" (`window.open('wa.me/...', '_blank')`)
  did not open a second tab in the headless session — likely a headless-Chromium popup-blocking
  artifact rather than a real bug (no console error, and the code path is a standard
  `window.open(..., 'noopener')` on a direct click handler). Flagging so a real-device pass double
  checks the WhatsApp deep link actually opens with the right prefilled text.

**No hard blockers found on this surface.**

---
