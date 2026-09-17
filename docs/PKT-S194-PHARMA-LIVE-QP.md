# PKT-S194-PHARMA-LIVE-QP — pharma-demo's certify step gets a live ceremony hand-off

Lane 3301 (Athena dispatch, task 3301). No PKT- prefixed docs existed anywhere in the repo at
lane start (checked via `grep -rl "PKT-"` and `find . -iname "PKT-*"`, both across the whole
tree) — this file is the first, created under `docs/` per critique-gate resolution (y).

## Why

Rob's S194-evening ask: make pharma-demo.html "more of a real demo" for a pharma prospect. Lane
3294's code-checked grid found that pharma-demo.html's Authority beat ("Try the live biometric")
sits *outside* the main walkthrough and, by default, mints the Seal-step token under a placeholder
QP identity (`qp@pharma-demo.vac`) with no live human ever in the loop — unlike financial-demo.html
and tribunal-demo.html, whose sign-off/seal moment is *itself* gated by a fresh, live re-auth before
minting, followed by a server-side `/v1/vat/authorize` call. This packet is the exists-audit backing
that comparison, plus the build log for closing the gap in pharma-demo.html only.

## Exists-audit: pharma-demo.html vs financial-demo.html (pre-change state)

### Ceremony hand-off + return handling

- **financial-demo.html** (and tribunal-demo.html, which it was copy-pasted from — see the
  `surface:'tribunal-demo'` strings left over inside financial-demo.html's own seal-authorize
  calls, e.g. financial-demo.html:580,950,1077): the seal moment is gated by `sealReauthGate(onPass,
  onCancel)` (financial-demo.html:814-887). It opens the **existing `.vo`/`#verifyOverlay` overlay**
  as an **iframe** (`frame.src = VERIFY_SRC + '?greeting=skip&reauth=1&name=...&email=...'`,
  `VERIFY_SRC = '/auth.html'`), then listens on `window` for a same-origin `postMessage` of
  `{type:'vac-auth-success', email, name, session_token, auth_level}` from auth.html (auth.html
  posts this to `window.parent` when embedded, per auth.html:1199-1219). On receipt it captures
  `window.__vacVerified = {name, email, session_token, auth_level}` and calls `onPass()`. Because
  this is an **iframe overlay, not a page navigation**, state survives the round trip purely in the
  page's own JS memory (`window.__vacVerified`) — no query/hash/sessionStorage marker is needed for
  the seal-gate round trip itself. (The separate, upfront identity-gate step in financial-demo.html
  *does* use a `#matters` hash + `localStorage('vac_verified')` freshness check for page-reload
  persistence — financial-demo.html:1482-1493 — but that is the identity-gate beat, not the seal
  ceremony hand-off in scope here.)
- **pharma-demo.html** (pre-change): the "Try the live biometric" Authority beat
  (`pharmaOpenVerify`, pharma-demo.html:601-605 pre-change) did a **full-page navigation**
  (`location.assign('/auth?return=/pharma-demo')`) rather than an iframe hand-off, and picked the
  result back up via a `localStorage('vac_last_verified')` mirror on `pageshow`/`visibilitychange`/
  `storage` events (pharma-demo.html:606-643 pre-change) — a different code path from financial's,
  and one that lived entirely **outside** the 5-step walkthrough. The Seal step (step 4) in the
  walkthrough never called this beat at all: `advance()` minted unconditionally
  (`await mintPharmaToken()`) the moment step 4 was revealed, using whatever `window.__vacVerified`
  happened to be sitting in memory (usually nothing, so it minted under the placeholder QP identity).
  There was also a `.vo`/`#verifyOverlay`/`#voFrame` iframe-overlay markup already present in the
  page's HTML, and a dead `window.addEventListener('message', ...)` listener for `vac-auth-success`
  sitting alongside the redirect-based flow — vestigial, since nothing ever set `frame.src` to open
  it as an iframe.

### Mint (`/v1/vat/issue`)

- financial-demo.html's `mintMatterToken()` (financial-demo.html:613-689): fails closed if the
  ceremony completed but no verified **email** is present (a name-only token can't bind the
  `/v1/vat/authorize` re-auth, which re-hashes against an email-derived `human_ref`) — refuses to
  mint and falls back to the reference token with `minted:false` rather than fake a binding.
  `verification_method: 'multi_modal'` is hardcoded; `actions` includes both `seal_decision` (what
  the seal-gate authorizes) and `view_credential` (what the post-seal proportional-reauth demo
  authorizes) — an action absent from this array is rejected by `/v1/vat/authorize` as
  out-of-scope even when identity matches.
- pharma-demo.html's `mintPharmaToken()` (pre-change, pharma-demo.html:376-432): always sent
  `verification_method: 'multi_modal'` regardless of whether any live ceremony had actually run,
  and defaulted `human_identity` to the placeholder `qp@pharma-demo.vac` whenever
  `window.__vacVerified` was empty — i.e. the default (unauthenticated) path silently claimed
  `multi_modal` verification. `actions` was `['certify_batch_release', 'view_credential']` — it did
  **not** include `seal_decision`, so a `/v1/vat/authorize` call with `action:'seal_decision'`
  against this token would have been rejected as out-of-scope even if one had been made.

### Authorize (`/v1/vat/authorize`, action `seal_decision`)

- financial-demo.html's `authorizeSeal()` (financial-demo.html:564-595): called immediately after
  mint, from inside the seal-gate's `onPass`. Fails closed honestly when there is no session token
  or no jti (`{authorized:false, reason:'no_session_token'|'no_jti', server_attested:false}`)
  rather than fabricating a verdict; otherwise records the server's `authorized`/`reason`/`aar_id`
  verbatim. The receipt (financial-demo.html:892-961) renders three distinct states off this: server
  authorized (green, "GATED & AUDITED"), server explicitly refused (amber, "server refused:
  &lt;reason&gt;"), and never attempted / no live session (grey, "not server-authorised in this
  preview"). Note: financial-demo.html's `showReceipt()` does **not** change its own heading or
  overall `Status` field based on `SEAL_AUTHZ` — the top-line "Decision sealed & lodged" / "SEALED ·
  LODGED · AUDITABLE" renders unconditionally even on an explicit server refusal. That is a gap in
  financial-demo.html itself, not something pharma-demo.html should copy — see the CERT-DEBT note
  below and critique-gate resolution (c) on this lane, which pharma-demo.html now satisfies more
  strictly than its financial-demo.html model does.
- pharma-demo.html (pre-change): had **no** `/v1/vat/authorize` call anywhere. The Seal step only
  ever minted a token; nothing gated or audited the certify *action* itself, so there was no
  server-side hard-gate or AAR (action attestation record) behind the pharma seal at all.

## What this lane built (pharma-demo.html only)

1. Copied financial-demo.html's `sealReauthGate(onPass, onCancel)` into pharma-demo.html **as a
   named function of the same name**, per critique-gate resolution (a) — duplication accepted
   tonight, flagged as debt below. Two effectively-dead branches specific to financial-demo.html's
   *other* surface (the post-seal FAST proportional-reauth widget: `resetDemoSurface('full')`,
   `#voContinue` / `#voContinueBar` repaint) were dropped rather than copied, because pharma-demo.html
   has no competing FAST-reauth mount to guard against and no `#voContinue` button in its `.vo-head`
   markup — the remaining references to those elements in the copied financial code were already
   `if (el) {...}`-guarded, so nothing in the copied function needed rewriting. Source: financial-
   demo.html:814-887 (== tribunal-demo.html:1209-1282, which financial-demo.html was itself copied
   from).
2. Copied `authorizeSeal()` (financial-demo.html:564-595) as `authorizeSeal()`, pointed at
   `resource: 'pharma:site:qp_release'` and `action: 'seal_decision'`.
3. Added `seal_decision` to the minted token's `actions` array (previously missing — see audit
   above) so the authorize call is in-scope.
4. Removed pharma-demo.html's old full-navigation `pharmaOpenVerify()` / `localStorage
   ('vac_last_verified')` mirror / `pageshow`/`visibilitychange`/`storage` listeners. The outer
   "Try the live biometric" Authority-beat button now calls the **same** `sealReauthGate()` used by
   the certify step, so there is exactly one ceremony hand-off code path on this page, not two
   competing ones racing the same `postMessage` listener.
5. The certify step (Seal, step 4) no longer auto-mints on reveal. It now pauses on an inline seal
   gate with two explicit actions:
   - **"Run the live check & seal"** — calls `sealReauthGate()`; on pass, mints with
     `verification_method:'multi_modal'` bound to the verified email/session from the ceremony,
     then calls `authorizeSeal()`, then reveals the receipt.
   - **"Skip the live check (demo only)"** — mints under the sample identity
     (`qp@pharma-demo.vac`) with `verification_method:'credential_check'`, still calls
     `authorizeSeal()` for consistency (it fails closed honestly with `no_session_token` since
     there was no ceremony), then reveals the receipt. The receipt states plainly that this seal
     used the sample identity and no live check.
6. Per critique-gate resolution (c): if `/v1/vat/authorize` comes back server-attested and
   explicitly refused, the receipt heading and status no longer claim the decision is "sealed &
   lodged" — they show an amber "NOT sealed — request refused" state instead. This is **stricter**
   than financial-demo.html's own receipt (see the CERT-DEBT note above), intentionally, per the
   binding resolution for this lane.
7. Updated the page's own honest-scope copy (preview banner, the `.fwd-note` block, and the footer
   `.posture` line) to describe the certify step's live-ceremony-or-skip choice honestly.

## Debt (flagged, not fixed tonight)

- **CERT-DEBT-1 (duplication):** `sealReauthGate` and `authorizeSeal` now exist verbatim (or
  near-verbatim) in three files — tribunal-demo.html, financial-demo.html, pharma-demo.html.
  Extracting a shared module is the obvious follow-up; accepted as tonight's tradeoff per
  critique-gate resolution (a).
- **CERT-DEBT-2:** financial-demo.html's own receipt does not gate its headline "sealed & lodged"
  copy on `SEAL_AUTHZ.authorized` (see audit above) — worth backporting pharma-demo.html's stricter
  behaviour (built under resolution (c) here) into financial-demo.html and tribunal-demo.html in a
  follow-up lane, for consistency across all three.

## Checks run

Driven with `puppeteer-core` against the real `/usr/bin/google-chrome` binary (`headless: 'new'`),
serving pharma-demo.html from a throwaway local static server (`http://localhost:8791`) so the page
runs under a real URL rather than `file://`. All live network calls (`/v1/vat/issue`,
`/v1/vat/authorize`) went to the real production backend, `https://vac-system-production.up.railway.app`
— nothing mocked.

- **No horizontal overflow, 390px and 1280px:** `document.documentElement.scrollWidth` ==
  `window.innerWidth` at both widths (`overflow: 0` both times).
- **Skip path, end to end against the live backend:** walked the 5-step flow to the Seal step,
  clicked "Skip the live check (demo only)", and the receipt rendered with a genuinely minted,
  Ed25519-signed token. Ran this **twice** in the same session (once directly, once after Reset)
  to confirm the flow is idempotent and mints a fresh token each time:
  - Run 1 token id: `vat_root_985954cfa48d`
  - Run 2 token id (post-reset re-run): `vat_root_d5fcb3a7bf44`
  - Receipt correctly showed `Live check: Skipped (demo only) — verification_method:
    credential_check, sample identity` and `Action gate + audit: not server-authorised in this
    preview (no live session — skip path)` — honest, not presented as a live-verified seal.
  - No `pageerror`/JS exceptions during either run. Two pre-existing, unrelated console errors
    appear on every load regardless of any of this lane's changes: a 404 for
    `/_vercel/insights/script.js` (only resolves on a real Vercel deployment, not the local static
    server used for this check) and a 422 from the pre-existing `sendBeacon` telemetry call to
    `https://api.athenapilot.ai/v1/telemetry/view` (unrelated pharma-demo.html feature, unmodified
    by this lane).
- **Live path reaches the ceremony page (per resolution d — cannot complete an actual live
  biometric in this headless/non-interactive lane: no camera, no human):** clicked "Run the live
  check & seal" on the Seal step and confirmed the overlay opens with
  `#voFrame.src = "<origin>/auth.html?greeting=skip&reauth=1"` — the same URL shape financial-
  demo.html's sealReauthGate opens, confirming the copied ceremony hand-off is wired correctly and
  does not silently mint/authorize without it. Also confirmed the same is true of the outer "Try
  the live biometric" Authority-beat button (`#pharmaBioBtn`), which now shares this exact code
  path (see build step 4 above) rather than the old full-navigation flow.
- **Cancel-and-retry:** clicking the overlay's close button while the live ceremony is pending
  hides the overlay (`#verifyOverlay.hidden === true`) and does not block the page — confirmed
  after fixing a bug this lane introduced and caught in its own testing (see below).

### Bug caught and fixed during these checks

The first pass of the live-ceremony port left the overlay's close (×) button non-functional for
the cancel path: `sealReauthGate`'s own `onClose` (copied from financial-demo.html) only settles
the cancel callback — in financial-demo.html the overlay is actually hidden by a *separate*,
permanent listener that belongs to financial-demo.html's own upfront identity-gate step
(financial-demo.html:1444), which pharma-demo.html has no equivalent of. Without that second
listener, clicking × left the full-viewport overlay covering the page indefinitely. Fixed by
binding an equivalent permanent hide-on-close listener once pharma-demo.html's own markup, in the
script block that runs after `#verifyOverlay`/`#voFrame` exist in the DOM (an earlier attempt to
bind it immediately after `sealReauthGate`'s own definition failed for the same reason — that
script block runs before the overlay markup appears later in the page). Caught by the headless
outer-button/close/reset/re-run test in this same check pass, before this was ever pushed.
