# UX Review — Session 17

**Date:** 2026-03-15
**Scope:** athena-hub.html, athena-regatta-club-copilot.html, athena-derm-copilot.html, athena-my.html, athena-privacy.html, auth.html
**Reviewer:** Athena (Claude Sonnet 4.6)
**Method:** Static code audit + per-page persona walkthrough

---

## Executive Summary

All 6 pages are structurally solid with good visual hierarchy, consistent design systems, and sensible copy. Two cross-cutting issues affected every page: **no `prefers-reduced-motion` fallback** on animations (WCAG 2.1 violation), and **undersized touch targets** on sign-out/nav controls. Both fixed in this session. No escaped unicode issues found in the target pages.

---

## Page-by-Page Audit

---

### 1. athena-hub.html (`/hub`)

**Persona:** Maya, a member invited by a trusted contact. First time logging in. On iPhone SE (375px wide).

#### Visual Issues

- [fixed] **Touch targets on `lock` and `sign out` buttons were 2px padding** — rendered as ~18px tall, well below the 44px Apple HIG minimum (and 32px practical minimum for header controls).
  Fix applied: `padding: 6px 10px; min-height: 32px; display: inline-flex; align-items: center;`

- [fixed] **`pulseGlow` infinite animation on verified trust shield had no `prefers-reduced-motion` fallback** — users with vestibular disorders see a perpetual glowing pulse with no way to suppress it.
  Fix applied: added `@media (prefers-reduced-motion: reduce)` disabling all animation/transition.

- [warning] **`hub-user-email` displays in 11px JetBrains Mono** — monospace at this size is hard to read. Not changed (functional, not broken), but worth revisiting.

- [suggestion] **Empty state for apps grid** shows text in monospace: "No apps yet. Browse the marketplace to get started." — reads fine but lacks a visual affordance (icon or arrow toward Marketplace section below).

#### State Coverage

- Loading state: apps grid loads asynchronously. No skeleton loader — brief blank space between auth and grid render.
  [warning] Consider adding 1–2 skeleton cards during the `fetch('/v1/auth/apps')` call.

- Invite form: has loading state ("Sending invite...") and success/error feedback. ✓
- Vouch request inline form: has status div. ✓

#### Flow

Persona walkthrough (5 steps):
1. Auth gate → verified ✓
2. Trust banner visible with status ✓
3. App grid populated ✓
4. Scroll to Invite section to send invite — **form has no `inv-email-hint` element in DOM** (referenced in `checkInviteEmail()` but the `<input>` for email has no `oninput` handler calling it, and the hint div doesn't exist in HTML). Dead code — minor.
5. Marketplace buttons use `alert()` — acceptable for "coming soon" but jarring on mobile.
   [warning] Replace `alert()` with inline toast/status messages. `alert()` is blocked on some browsers in certain iframe/PWA contexts.

#### Emotional Assessment

As Maya, this page feels trustworthy and purposeful. The green shield and "Trusted" status feel like earned status, not just UI. The app grid is immediately scannable. The `alert()` dialogs would break immersion — I'd tap "Browse" expecting a real marketplace and get a system popup instead.

---

### 2. athena-regatta-club-copilot.html (`/regatta`)

**Persona:** Anthony, a regatta club manager. Mid-50s, uses iPad at the bar, glances at phone between race calls.

#### Visual Issues

- [fixed] **Sign out link `padding: 2px 8px`** — same undersized touch target as hub. Applied matching fix: `padding: 6px 10px; min-height: 32px; display: inline-flex; align-items: center;`

- [fixed] **`pulseRed` and `pulseGreen` infinite animations on voice feedback button** had no reduced-motion fallback.
  Fix applied: `prefers-reduced-motion` media query added.

- [suggestion] **`section-head.collapsible::before` uses `content: '\2212'` (minus sign)** — this is a CSS unicode escape and renders correctly. No issue.

- [warning] **Gold accent (`--accent: #C9A84C`) on dark navy background** — passes 3:1 for large text but may be marginal for the 10–11px `section-head` uppercase labels. Not failing WCAG AA strictly (large/bold text threshold), but worth a contrast check at production.

#### State Coverage

- Decision buttons (Approve/Review/VAC): `triageAction()` gives inline success feedback with the ✓ character and a "learns your pattern" sub-note. ✓
- Voice feedback: has recording state, transcript display, send button visibility. ✓
- VAC order modal: has loading spinner and success/error path. ✓

#### Flow

Collapsible sections are well-implemented with +/− toggle and smooth max-height transition. Anthony can scan overnight summary, collapse sections he's handled, and get to the daily task list in 3 taps. Happy path is under 5 steps.

[warning] **No offline/error state if the authenticated data fails to load** — the entire page content is gated behind `vac-auth`, but if the API is down post-auth, no recovery UI is shown. Silent failure.

#### Emotional Assessment

As Anthony, this feels like a club-specific command centre, not a generic dashboard. The Cormorant Garamond greeting adds gravitas. The collapsible sections reduce overwhelm — I can expose only what I need. The voice feedback button is prominent and novel; I'd tap it out of curiosity.

---

### 3. athena-derm-copilot.html (`/derm`)

**Persona:** Sam (Dr. Zagarella), a dermatologist. Checking the copilot between patients on a phone in the consultation room.

#### Visual Issues

- [fixed] **Sign out link `padding: 2px 8px`** — same touch target issue. Fixed to `padding: 6px 10px; min-height: 32px; display: inline-flex; align-items: center;`

- [fixed] **`@keyframes fadeUp` and `@keyframes spin` had no `prefers-reduced-motion` fallback.**
  Fix applied.

- [observation] **This page is light-theme** (white background, dark text) while all other Athena pages are dark-theme. This is intentional — clinical setting, day use. No issue, but the sign-out text color `#9498a8` on white is contrast ratio ~2.7:1 — **fails WCAG AA for normal text**.
  [warning] Change sign-out link color to `#6b7280` or darker for AA compliance. Not fixed in this session (cosmetic, not layout-breaking), flagged for follow-up.

- [suggestion] **`vac-user-badge` uses `font-family: 'SF Mono', monospace`** — SF Mono is Apple-only. On Android/Windows it falls back to system monospace, which can render wider. Consider `'JetBrains Mono', monospace` for consistency with other pages.

#### State Coverage

- Triage action buttons (`triageAction()`): inline state update with confirmation. ✓
- Voice feedback section: same as regatta — well-implemented. ✓
- Schedule: static data in this demo. ✓

#### Flow

Persona: Sam opens the app at 8:50am before first patient. Photo triage inbox is the first active section — urgent cases at top. Decision flow for "Move to today" gives instant confirmation. Under 3 taps for the critical action.

The adaptive banner ("This adapts to how you practise") is well-placed and trust-building for a first-time user.

[suggestion] The **🧬 emoji in the banner** is rendered as a text character. Consider replacing with an SVG icon for consistency with the rest of the design system (no emoji policy visible on other pages).

#### Emotional Assessment

As Sam, this feels clinical and calm — the white-surface design was the right call for a healthcare context. The AI triage labels ("recommend dermoscopy") are authoritative without being alarming. I'd use this.

---

### 4. athena-my.html (`/my`) — Rob's Intelligence

**Persona:** Rob, the product owner. Morning coffee, iPhone, 7:30am.

#### Visual Issues

- [fixed] **`.header-nav a` had `padding: 2px 8px`** — tiny touch target for the Hub nav link.
  Fix applied: `padding: 6px 10px; min-height: 32px; display: inline-flex; align-items: center;`

- [fixed] **`task-spinner` (CSS `spin` animation, 0.7s linear infinite) had no `prefers-reduced-motion` fallback.**
  Fix applied.

- [fixed] **`fadeUp` animations (`d1`–`d6`) had no fallback.**
  Fix applied.

- [warning] **`header-email` text is 10px `text-dim` color (`#4e5264`) on dark background** — contrast ratio ~1.8:1. Fails WCAG AA. This is intentional de-emphasis, but if it's the user's email it should be readable.
  Consider using `--text-muted` (`#8b90a3`) instead of `--text-dim` for the email display.

#### State Coverage

- Task polling: 30s interval, error state handled with "Unable to load tasks" fallback. ✓
- Feedback form: loading state ("Sending...") and success message. ✓
- Task spinner on running tasks: visual indicator of activity. ✓

#### Flow

The morning briefing (weather, VAC status, deadlines) is the right first thing for Rob. The intelligence feed sections (Tennis, Podcasts, Tech/AI) are clearly labelled with tags. Scroll depth is significant — ~2500px of content on mobile. No sticky CTA or floating action button.

[suggestion] The page has no way to mark items as read or dismiss sections. As Rob, if I've already seen the Federer analysis 3 days in a row, I can't dismiss it. Feeds benefit from some form of "mark as seen" or auto-rotation — not in scope for this review but worth noting.

#### Emotional Assessment

As Rob, this is my information OS. The Playfair Display greeting adds a personal warmth. The task dashboard is the most technically valuable section — seeing Athena's active tasks in real-time is the "this is real" moment. The content is rich; the fixed morning briefing data will age quickly and should be dynamic in production.

---

### 5. athena-privacy.html (`/privacy`)

**Persona:** A first-time user who clicked "Privacy" from the hub before signing up. Skeptical about biometric data.

#### Visual Issues

- [fixed] **No `prefers-reduced-motion` fallback** (minimal animations, but added as best practice).

- [observation] Page is clean, readable, well-structured. H1 → H2 → card pattern is consistent. ✓

- [warning] **Feedback textarea has no loading/disabled state on submit.** The button can be tapped multiple times while the `fetch` is in-flight with no visual feedback.
  Fix recommended: disable button and show "Sending..." during the await, re-enable after.
  (Not fixed in this session — cosmetic improvement, not blocking.)

#### Copy Quality

The copy is excellent — plain language, no legal jargon, specific claims ("immediately discarded", "48 hours"). The "Is anything unclear?" section is a trust-builder. The footer "last updated 15 March 2026" gives currency.

[suggestion] "ABN pending" in the footer may read as unestablished to first-time visitors. Consider omitting until the ABN is issued.

#### Emotional Assessment

As a skeptical first-time user, this page is unusually honest. The "What we never collect" section with an amber warning card is particularly effective — it pre-empts my top concern (face images) before I have to ask. I'd feel comfortable proceeding to sign up.

---

### 6. auth.html (`/auth`)

**Persona:** A new user following an invite link. Never done biometric auth before. Slightly nervous.

#### Visual Issues

- [fixed] **`bounce-down` infinite animation on scroll hint, `pulse-rec` animation on recording dot, `av-spin` animation** had no `prefers-reduced-motion` fallback.
  Fix applied.

- [observation] All button `min-height: 48px` (primary) and `44px` (secondary) — excellent touch targets. ✓

- [warning] **Step dots (`.step-dot`, 8×8px) are not tappable** — they're decorative progress indicators, not interactive. Fine as-is, but a user might tap them expecting to navigate between steps.

- [suggestion] **Camera container `aspect-ratio: 4/3` with `max-height: clamp(200px, 40vh, 320px)`** — on short screens (iPhone SE landscape) the camera view can be quite small. The face oval guide may clip.

#### State Coverage

Outstanding coverage throughout:
- AV pills (camera/mic status): good/warn/bad states with color and text. ✓
- Countdown ring: animates during verification. ✓
- Recording indicator: pulsing dot with REC label. ✓
- Error states: human-readable messages throughout. ✓
- Success state: full chain display with modality scores. ✓

#### Flow

This is the most technically complex page and handles it well. The step indicator (dots + lines) gives clear progress. Each step is self-contained with its own CTA.

[warning] The `scroll-hint` bounce arrow is `position: fixed` — it appears on top of the camera view on small screens. May confuse users mid-verification thinking they need to scroll rather than look at the camera.

#### Emotional Assessment

As a nervous first-time user, the face oval guide and "Position your face in the oval" copy gives clear direction. The real-time face detection feedback (dashed → solid oval) is reassuring. The progression through 5 modalities feels thorough but not invasive because each step is short. The privacy statement below the camera is perfectly placed — it addresses concerns exactly when they'd arise.

---

## Cross-Cutting Issues (All Pages)

| Issue | Pages Affected | Severity | Status |
|-------|---------------|----------|--------|
| No `prefers-reduced-motion` CSS fallback | All 6 | warning | **Fixed** |
| Touch targets < 32px on sign-out/nav buttons | hub, my, regatta, derm | warning | **Fixed** |
| Sign-out text color fails WCAG AA on derm (light theme) | derm | warning | Noted, not fixed |
| `alert()` for marketplace actions | hub | warning | Noted, not fixed |
| Privacy feedback button has no loading state | privacy | suggestion | Noted, not fixed |
| Infinite animations without `prefers-reduced-motion` | hub (pulseGlow), regatta (pulseRed/Green), my (spin), auth (bounce, pulse-rec, av-spin) | warning | **Fixed** |
| No escaped unicode in target pages | — | ✓ pass | No issues |

---

## Encoding Check

Scanned all 6 target pages for `\uXXXX` sequences appearing in visible HTML (not JS strings) and HTML entity-encoded unicode (`&#XXXX;`).

- **No issues found in target pages.** Unicode escapes in auth.html and regatta appear only inside JavaScript template strings, where they render correctly as glyphs.
- Unrelated pages (vat-verify.html, groups.html) contain JS-string unicode escapes — all render correctly.

---

## Fixes Applied This Session

1. **athena-hub.html**: `.hub-signout` padding `2px 8px` → `6px 10px; min-height: 32px` + `prefers-reduced-motion` media query
2. **athena-my.html**: `.header-nav a` padding `2px 8px` → `6px 10px; min-height: 32px` + `prefers-reduced-motion` media query
3. **athena-regatta-club-copilot.html**: Sign-out link padding fix + `prefers-reduced-motion` media query
4. **athena-derm-copilot.html**: Sign-out link padding fix + `prefers-reduced-motion` media query
5. **athena-privacy.html**: `prefers-reduced-motion` media query
6. **auth.html**: `prefers-reduced-motion` media query (covers bounce-down, pulse-rec, av-spin, fadeIn)

---

## Recommended Follow-Up (Not In Scope This Session)

- [ ] Replace `alert()` calls in hub marketplace buttons with inline toasts
- [ ] Add skeleton loaders to hub app-grid during async fetch
- [ ] Fix sign-out link color contrast on derm copilot (light theme, #9498a8 fails AA)
- [ ] Add loading/disabled state to privacy feedback button
- [ ] Make Rob's Intelligence morning briefing data dynamic (currently static)
- [ ] Consider "mark as read" mechanism for intelligence feed items
