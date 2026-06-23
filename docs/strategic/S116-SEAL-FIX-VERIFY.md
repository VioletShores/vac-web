# S116 — Live tribunal seal fix + browse verification

**Date:** 2026-06-23
**Bug:** Clicking **Seal & lodge decision** on the deployed `tribunal-demo.html`
threw `Uncaught ReferenceError: VERIFY_SRC is not defined` → the re-auth overlay
never opened, seal dead-ended. Release-blocking.

## Root cause

`sealReauthGate` (top-level fn) referenced `VERIFY_SRC` at the seal moment, but
`const VERIFY_SRC` was only declared **inside** the later `idGate` IIFE —
block-scoped, invisible to the top-level fn → ReferenceError on the seal click.

## Fix applied

Two-part change to `tribunal-demo.html` (applied directly to `main`, not a full
cherry-pick of `d8f09cc` — `main` lacks the `seal-fires-gate` `SEAL_AUTHZ`
authorize wiring, so the whole commit would conflict on context):

1. Declare `const VERIFY_SRC = '/auth.html';` **once** at top-level, right after
   `let SEAL_TOKEN = REAL_TOKEN;` — the single source of truth.
2. Neutralise the inner IIFE duplicate (`const VERIFY_SRC='/auth.html';`) to a
   comment pointing at the top-level declaration.

**Sanity:** single `const VERIFY_SRC` in the file (verified by grep count = 1);
inline script parses clean via `new Function(code)` (0 syntax errors); referenced
at line 960 (`sealReauthGate`) and line 1131 (`openVerify`), both now resolve to
the top-level const.

**Push SHA:** `137cc8b64ddfc88a8da1ac59c1d2afb2fb4bc630` (main, pushed +
Vercel auto-deployed; live file confirmed to carry the top-level const).

## Browse re-test (live: https://vacprotocol.org/tribunal-demo.html)

Walked matter 01 (Property deposit release) → Begin → 6× Next step → reached
**Seal & lodge decision**. Installed a `window.addEventListener('error', ...)`
listener up front (uncaught `ReferenceError`s do not reliably show in console
scraping).

Pre-click: `window.__errs = []`, `#verifyOverlay` hidden, no JWT visible.

Clicked **Seal & lodge decision**:

| Check | Result |
|---|---|
| Re-auth overlay opens | **YES** — `#verifyOverlay` `hidden=false`, `is visible` = true; "Verify You're a Real Human" modal rendered (screenshot `/tmp/seal-overlay.png`) |
| No `VERIFY_SRC` ReferenceError | **YES** — `window.__errs = []` post-click; `console --errors` = none |
| Re-auth iframe loaded | `#voFrame` src = `/auth.html` |
| Token gated behind verify (not revealed without re-auth) | **YES** — no JWT (`eyJ…`) in DOM before verification; gate holds |

## Verdict

**overlay opens: y** · **gate holds: y** · no uncaught exceptions. Seal is fixed
on live main. The security invariant (token never leaks before re-auth) was held
throughout.

## Independent re-verification (2026-06-23, second pass)

Re-checked the live deploy to confirm the fix is still holding.

- Code state on `main`: exactly **1** `const VERIFY_SRC` (top-level, line 743);
  inner IIFE duplicate gone (comment at line 1106); both usages resolve
  (`sealReauthGate` line 960, `openVerify` line 1131). Local `main` == `origin/main`
  at `7a60560` — fix `137cc8b` already pushed, nothing to re-push.
- Balance: `{}` 449/449, `()` 891/891, backticks 46 (even).
- `/browse` live walk: matter 01 → VAC/VAT workflow → advanced to
  **Seal & lodge decision** → clicked. `window.__errs` = `[]`,
  `#verifyOverlay` `hidden=false` / `is visible` = true,
  `#voFrame` src = `https://vacprotocol.org/auth.html`. No
  `VERIFY_SRC`/`ReferenceError`/`not defined` in console (only unrelated
  MediaPipe WebGL warnings).

**Re-verdict: still fixed and live. Seal opens the re-auth overlay, no ReferenceError.**
