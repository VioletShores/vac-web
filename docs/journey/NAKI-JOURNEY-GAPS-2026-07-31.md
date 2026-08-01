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

### 2. `p/naki-3bd20e1222bf.html` — the private pager

**Method:** `/browse` live render against
`https://vacprotocol.org/p/naki-3bd20e1222bf.html`, at 390×844 and 1280×900. Cross-checked links
and full page HTML with `browse links` / `browse js`, and network log for asset failures.

**Works well:**
- Content renders identically to the repo source (`p/naki-3bd20e1222bf.html`), no console errors,
  no failed network requests (fonts load 200 across both widths).
- Desktop layout holds up much better here than on onboard-preview: `.wrap{max-width:820px}` keeps
  line length readable at 1280px instead of collapsing to a narrow centered mobile column.
- `<meta name="robots" content="noindex, nofollow">` is present — matches the footer's own claim
  "Not indexed, not public."
- All 6 outbound links present and pointing where the visible link text says: financial-demo (×2),
  the two IETF Internet-Draft datatracker URLs, the SignalRank pager, and the story pager.

**Blocker-adjacent finding:**
- **The page makes an offer with no way to act on it.** "Early access, deliberately narrow" closes
  with "The offer is to put you on it early..." but the page contains zero mechanism to claim
  it — no link to the onboarding flow, no WhatsApp deep link, no email, no "reply to this" — verified
  by searching the full page HTML for `onboard`, `wa.me`, and `athenapilot` (all absent). The only
  way Naki can act on the offer is to already have a separate channel to Rob (the tennis-club
  connection) or already possess the `onboard-preview` URL from elsewhere. Given the onboard-preview
  page *does* link back to this pager (Step 4's "Your briefing" card), the reverse link is missing:
  this is a dead end unless she was sent both URLs together out of band. Worth adding a direct CTA
  here (link to the onboard-preview page, or the WhatsApp number itself) so the pager is
  self-sufficient.

**Minor polish:**
- Bold gold-colored emphasis phrases in the opening paragraph ("unpriced risk", "is the AI output
  actually better than the human baseline here", etc.) use the same gold color as real links
  (`--gold`/`--accent`) but are `<b>` tags, not `<a>` tags — no underline, so technically
  distinguishable on close inspection, but a fast skim could read them as clickable and be surprised
  they aren't. Low severity since real links in the same page are underlined and these aren't.

---

### 3. `financial-demo` (`https://vacprotocol.org/financial-demo`) — the demo the pager links

**Method:** `/browse` live render at 390×844 and 1280×900. The live biometric ceremony itself
requires a real camera/mic and GPU-backed WebGL (MediaPipe face/hand landmarkers) — headless
Chromium has neither, so `Try the live biometric` could not be driven end-to-end. This is a method
limitation, not a page defect: console shows the expected MediaPipe→WebGL2 fallback warnings, no
crash. A real-device pass is still needed to verify the live ceremony itself; everything below is
what could be verified statically/structurally without a camera.

**Blocker — near-invisible "Continue to the scenario" button (both widths).** Step One's card has
two CTAs side by side: `Try the live biometric` (gold-filled, readable) and `#idSkip` "Continue to
the scenario" (outline button, `style="background:transparent;border:1px solid var(--amber-border)"`).
Its text computes to `rgb(26, 20, 6)` — near-black dark brown — on a transparent button over the
page's near-black background. Contrast ratio is effectively ~1:1; the button text is not legible.
Screenshot confirms it (isolated element capture shows an almost-blank dark rectangle where the label
should read). This matters specifically for Naki: she is very unlikely to have camera access ready
in the moment she's reading this (professional context, possibly at a desk without a webcam, or
just not wanting to do a live face scan to read a briefing) — the "skip to the illustrative
walkthrough" path exists precisely for her, and it is currently unreadable. Confirmed present at
both 390px and 1280px (same inline style, no responsive override).
  - **Root cause identified (not fixed, per brief):** `financial-demo.html:391` sets
    `id="idSkip"` with inline `style="background:transparent;border:1px solid var(--amber-border);"`
    but does not override `color`, so it inherits the base `.cta-btn` rule at
    `financial-demo.html:253`, which sets `color:#1A1406` (dark brown — correct against that class's
    default *filled* `var(--purple)` background, wrong against a transparent one). Cross-checked
    against `tribunal-demo.html`, which has the visually identical button (`#idSkip`, same inline
    style, labelled "Continue to the matters" at `tribunal-demo.html:391`) and renders it fine
    because *that* page's base `.cta-btn` rule (`tribunal-demo.html:253`) uses `color:#fff`. The two
    demo pages have diverged: same component, same inline override, different base text color, and
    only financial-demo's combination is unreadable. A one-line `color` override on the `#idSkip`
    element (or in a page-specific rule) would fix it without touching the shared `.cta-btn` class.

**Second confirmed bug — horizontal overflow on mobile, "How it works end-to-end" tab.** At 390px
width, switching to the second tab makes `document.documentElement.scrollWidth` grow to 449px (59px
of horizontal overflow) because `.arch-summary-cta` ("See the full architecture and honest capability
status →", linking to `/architecture`) is `display:inline-block; white-space:nowrap` at a computed
width of 416px — wider than the viewport, and not allowed to wrap. This forces horizontal scroll on
mobile. The default "Walkthrough" tab does not have this problem (confirmed `scrollWidth` stays at
390px there).

**Works well:**
- Both footer links resolve 200: `/org-config.html`, `/architecture`.
- Honest-scope framing is consistent with the rest of the site's voice ("VAC provides the
  verification and the sealed audit rails; it does not hold client assets or execute trades").
- Preview banner at the very top is unambiguous about what's live vs. illustrative.
- Desktop layout (max-width'd content column, generous margins) reads well and doesn't repeat the
  onboard-preview page's "narrow mobile column on a wide desktop" issue.

---

### 4. `eu-ai-act.html` — linked from onboard-preview Step 2

**Method:** `/browse` live render at 390×844 and 1280×900.
`https://vacprotocol.org/eu-ai-act.html`.

**No bugs found.** Clean at both widths: no horizontal overflow (`scrollWidth` matches viewport at
both sizes), no console errors, dense but readable typography, good use of the wider desktop canvas
(this page does not repeat onboard-preview's narrow-column-on-wide-viewport issue, and its content
column genuinely uses the 1280px width rather than the ~820px cap the naki pager uses).

**Links discovered here (new, added to scope), all verified 200 via curl:**
- `https://vacprotocol.org/retrofit-console.html`
- `https://vacprotocol.org/tribunal-demo.html`
- `https://vacprotocol.org/signalrank.html`
- `https://arxiv.org/pdf/2604.23280` (cited as "Source" for the independent problem-validation claim)
- IETF drafts (verified-human-root, autonomy-governor) — same two URLs as on the naki pager.

**Polish observation:** the penalty figures ("up to €35M or 7%...") sit in a red-tinted callout box
that reads clearly, and the compliance-hedge disclaimer at the bottom ("this page describes how the
infrastructure is designed to support compliance with the cited provisions... not a claim of
certification") is exactly the kind of honest-scope framing seen elsewhere on the site. No notes.

---

### 5. Remaining discovered links

**Scope note:** "every link discoverable from them" is read as every link reachable *from the four
named surfaces* (onboard-preview, naki pager, financial-demo, eu-ai-act.html) — i.e. the union of
outbound links already enumerated in sections 1–4. Second-order links (links found *on* those
discovered pages — e.g. the three links inside the SignalRank Live walkthrough) were spot-checked
for a 200 response via `curl -L` for completeness but not given a full `/browse` walkthrough, to keep
this pass bounded. None of the spot-checks below turned up a broken link (all 200).

**Method:** `/browse` full render + `browse console --errors` + horizontal-overflow check
(`document.documentElement.scrollWidth` vs `window.innerWidth`) at 390px for each first-order link
not already covered above, plus `curl -s -o /dev/null -w "%{http_code}"` sweeps for link resolution.

| Link | Method | Result |
|---|---|---|
| `p/signalrank-live-6e3a91f2c8b4.html` (SignalRank walkthrough, from naki pager) | `/browse`, exercised the interactive "Financial" question end to end | Clean. No console errors, no overflow, routing walkthrough (classify → calibration snapshot → route) renders and updates correctly. |
| `p/story-8fbb551c6c4c.html` (footer link, from naki pager) | `/browse` | Clean. No console errors, no overflow at 390px. |
| `/tribunal-demo.html` (from eu-ai-act.html, and the underlying page behind onboard-preview's `/tribunal-demo` "Test it now" link and financial-demo's live-biometric CTA) | `/browse` | Clean, and notably: this page's own `#idSkip` "Continue to the matters" button — the same component that's unreadable on financial-demo — renders correctly here (white text). See root-cause note in Section 3; used this page as the working control to confirm the financial-demo bug is page-specific, not systemic. |
| `/retrofit-console.html` (from eu-ai-act.html) | `/browse` | Clean. No console errors, no overflow at 390px. |
| `/signalrank.html` (from eu-ai-act.html; distinct from the `signalrank-live` pager) | `/browse` | Clean. No console errors, no overflow at 390px. |
| `datatracker.ietf.org/doc/draft-zagarella-verified-human-root/` | curl | 200 |
| `datatracker.ietf.org/doc/draft-zagarella-autonomy-governor/` | curl | 200 |
| `arxiv.org/pdf/2604.23280` (eu-ai-act.html "Source" citation) | curl | 200 |
| `org-config.html`, `/architecture` (financial-demo footer links) | curl (see Section 3) | 200 |
| Second-order: `p/models-7f2a91c4e8b3.html`, `p/architecture-e2e-5c8d92f1a4b7.html`, `p/signalrank-8c31d47ab2e9.html` (all linked from the SignalRank Live pager) | curl | 200 each — not walked further per scope note above |

**Not independently verified — flagged for a real-device pass:**
- `wa.me/447404843156?text=...` deep links (the onboard-preview "Ask Athena about this" actions bar
  and any other WhatsApp CTAs) — headless Chromium did not visibly open a second tab when this was
  triggered (Section 1), which is consistent with popup-blocking in a headless context rather than a
  page bug, but this was not confirmed on a real phone/browser.
- The live biometric ceremony itself (face liveness, gesture, spoken-number challenge) on
  `financial-demo`, `tribunal-demo.html`, and `/tribunal-demo` — requires a real camera/mic and
  GPU-backed WebGL; headless Chromium has neither. Everything reachable *without* driving the camera
  was verified; the ceremony's actual pass/fail behavior was not.

---
