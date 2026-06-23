# S116 — Live browse verification of the Caroline evaluator flow

**Date:** 2026-06-23
**Tool:** `/browse` (headless Chromium, gstack)
**Target:** https://vacprotocol.org (deployed = `origin/main` @ `3b2555a`)
**Tester note:** Local `main` was 16 commits behind `origin/main` at session start; fast-forwarded to `3b2555a` so the local tree matches what is deployed. The seal-fires-gate branch `f4c9d21` (`s116-seal-fires-gate`) is **NOT** merged into `origin/main`.

---

## TL;DR

| Page | Verdict |
|------|---------|
| `architecture.html` | **PASS** — 6-step flow renders, BUILT·LIVE / BUILT·MERGING badges correct, no console errors, no layout breaks |
| `tribunal-demo.html` | **FAIL (functional)** — walkthrough advances and reaches the seal, but **clicking "Seal & lodge decision" throws `Uncaught ReferenceError: VERIFY_SRC is not defined`** → the re-auth overlay never opens, the seal button is left disabled, and no receipt is shown. The token is never revealed (so nothing leaks), but the gate dead-ends instead of presenting re-auth. |
| `vat-verify.html` | **PASS** — credential reveal is correctly gated behind a working "Quick re-verify" overlay; unknown email escalates to "Full verification required"; token stays hidden. MediaPipe/WebGL console warnings are headless-GPU artifacts, not app bugs. |

**Headline:** The *quick-reauth* gate (vat-verify) is **live and working**. The *seal* re-auth gate (tribunal) is **deployed but broken** by a JS scoping bug — and the unmerged `f4c9d21` branch does **not** fix that bug (it adds server-side authorization on top of the same broken overlay call).

---

## Page 1 — `architecture.html` → PASS

- Loads `200`, no console errors, no failed network requests, no horizontal overflow (`scrollWidth == clientWidth == 1280`), no broken images.
- The 6-step end-to-end flow renders in order, each with a badge:
  1. Verified human root — **BUILT · LIVE**
  2. A real human — not (yet) a legal identity — **BUILT · LIVE**
  3. Assurance proportional to the action — **BUILT · LIVE**
  4. The action is gated — and the decision is audited — **BUILT · MERGING**
  5. Bounded agent delegation — **BUILT · MERGING**
  6. Signed, independently-verifiable receipts — **BUILT · LIVE**
- Legend shows three badge states: `BUILT · LIVE`, `BUILT · MERGING`, `PLANNED`. The SVG flow diagram renders.
- The MERGING badges on steps 4 & 5 are an honest match for reality: the gate+audit layer (which includes the seal-fires-gate work) is not yet on `origin/main`.

Screenshot: `s116-screenshots/01-architecture-full.png`

---

## Page 2 — `tribunal-demo.html` → FAIL (functional, blocking the seal)

### What works
- Page loads `200`, no console errors on load.
- Walkthrough advances cleanly: intro → "Continue to the matters" → matter list (6 matters) → open a matter → "Begin" → "Next step" ×N → final step relabels the button to **"Seal & lodge decision"**.
- The seal handler IS wired: `#advance`'s onclick reaches the final-step branch, disables the button, and calls `sealReauthGate(onPass, onCancel)` (added by commit `8501105`, "gate the SEAL moment with a fresh live re-auth"). The `onPass` callback is `async () => { await mintMatterToken(); showReceipt(); }` — i.e. the token is only minted/shown **after** a verified `postMessage` from the embedded `/auth.html`.
- The overlay machinery itself is fine: opening `verifyOverlay` manually (`frame.src='/auth.html'; overlay.hidden=false`) renders the embedded **"Verify You're a Real Human"** `/auth.html` form at full size (642×678). Screenshot `08-auth-overlay-manual.png`.

### What's broken (the blocker)
Clicking **"Seal & lodge decision"** on the live site throws:

```
Uncaught ReferenceError: VERIFY_SRC is not defined
```

(captured via a `window.addEventListener('error', …)` hook during the real click — note: gstack `console --errors` did **not** surface this uncaught exception; only the window error listener did.)

**Root cause (confirmed in deployed source, `tribunal-demo.html`):**
- `function sealReauthGate(...)` is declared at **top level** (line ~933) and its last line does `frame.src=VERIFY_SRC; overlay.hidden=false;`.
- But `const VERIFY_SRC='/auth.html'` is declared at line ~1101 **inside the later upfront-identity IIFE** `(function(){ … })()` (the `idGate` block).
- A `const` block-scoped to that IIFE is **not visible** to the top-level `sealReauthGate`, so the reference throws.

**Observable result of the bug:**
- `#advance` is set to `disabled=true` (first line of the seal branch) *before* `sealReauthGate` throws → the seal button is left **stuck disabled**.
- The overlay never opens (`verifyOverlay` stays `hidden`, `display:none`).
- `mintMatterToken()` / `showReceipt()` never run → **no token, no receipt revealed**.
- User dead-ends; only "Reset" recovers.

### Gate-invariant interpretation
The task's expected result — *"the seal does NOT reveal the token without re-auth"* — technically **holds** (no token leaks), but for the wrong reason: the gate **errors out** instead of presenting a usable re-auth step. This is a broken user experience for an evaluator (Caroline), not a clean "gate blocks pending verify" demo. **It should be treated as a release blocker for the tribunal seal demo.**

Screenshots:
- `s116-screenshots/02-tribunal-initial.png` — walkthrough intro
- `s116-screenshots/03-matter-opened.png` — matter selected
- `s116-screenshots/04-matter-begin.png` — walkthrough begun
- `s116-screenshots/05-seal-step.png` — reached the seal step
- `s116-screenshots/06-seal-clicked-reauth.png` — after first seal click (no overlay)
- `s116-screenshots/07-seal-stuck-no-overlay.png` — seal button stuck disabled, no overlay, no receipt
- `s116-screenshots/08-auth-overlay-manual.png` — `/auth.html` overlay rendered when opened manually (proves the embed works; only the auto-trigger is broken)

---

## Page 3 — `vat-verify.html` → PASS

- Loads `200`. The credential page renders: trust score ring (76.7%), 3 nodes / 5 modalities, "Vouch for this identity", verification modalities, and a **"Sensitive credential details"** card locked behind a **"Quick re-verify to reveal"** button.
- Before re-verify: token is **not** in the DOM (`tokenVisible:false`), reveal prompt + lock present. No broken images, no horizontal overflow.
- Clicking **"Quick re-verify to reveal"** opens a working overlay (`z-index:1000`): **"QUICK RE-VERIFY → Open your credential — Enter the email on this credential. We'll match a quick face + number check against your verified identity."** Token stays hidden. No JS errors.
- Submitting an unknown email (`test@example.com` + Continue) correctly escalates: **"Full verification required — No face on file for test@example.com. Continue with the full verification to open the credential."** Token still hidden. The gate never reveals on an unverified path — correct.

This is the **QUICK-reauth** side of the demo (commits `455872c`, `53647c5`, `c352181`: one-digit BOUND `/v1/auth/quick-reauth`, `USE_QUICK_REAUTH` flipped true). It is fully live and behaves correctly.

### Console note (not a bug)
`vat-verify.html` logs MediaPipe `HandLandmarker` / WebGL warnings + one `StartGraph failed … kGpuService … emscripten_webgl_create_context() returned error 0`. These are **headless-Chromium GPU-context limitations**, not app errors — the page handles them gracefully (`[VAC] HandLandmarker unavailable, will use timer fallback`). On a real GPU-backed browser these would not appear.

Screenshots:
- `s116-screenshots/09-vat-verify-initial.png` — locked credential
- `s116-screenshots/10-vat-verify-reauth-gate.png` — quick re-verify overlay
- `s116-screenshots/11-vat-verify-continue-step.png` — full-verification escalation

---

## Console / network errors found

| Page | Finding | Severity |
|------|---------|----------|
| architecture | none | — |
| tribunal-demo | `Uncaught ReferenceError: VERIFY_SRC is not defined` on seal click (uncaught exception; not shown by `console --errors`) | **High — blocks the seal** |
| vat-verify | MediaPipe/WebGL GPU-context warnings + `StartGraph failed` (kGpuService) | Info — headless artifact, graceful fallback |

No 404s, no broken images, no layout breaks on any page.

---

## LIVE vs. what the seal-fires-gate branch (`f4c9d21`, unmerged) will add

### Live on `origin/main` (deployed now)
- `architecture.html` end-to-end page with BUILT·LIVE / MERGING badges.
- Tribunal walkthrough → seal step → a **client-side** seal re-auth gate (`sealReauthGate`) that *intends* to open the embedded `/auth.html` and only mint/show the token on a verified `postMessage`. **Currently broken by the `VERIFY_SRC` scope bug** (overlay never opens).
- `vat-verify.html` quick-reauth credential reveal — fully working.

### What `f4c9d21` ("seal fires the gate+audit") adds
- A new `authorizeSeal()` that, after the fresh re-auth + mint, calls **`POST /v1/vat/authorize {action:'seal_decision', vat_jti, authorising_session_token}`** server-side so the **HARD GATE** (`seal_decision` = `critical` → requires full re-auth) **and the AAR action-attestation** actually fire. The seal becomes a *gated, audited* action, not just a client token reveal.
- Captures `session_token` / `auth_level` from the `vac-auth-success` message (was just `name`) so the seal can authorise the action server-side.
- Receipt gains an **"Action gate + audit"** line showing `GATED (full re-auth) & AUDITED · AAR <id>` (or an honest "not server-authorised" line if no full-auth session token reached the client — it does **not** fake authorisation; consumer-contract rule D-ATTESTATION-CONSUMER-CONTRACT).
- Depends on `s116-seal-decision-sensitivity` (`seal_decision=critical`) being merged.

### ⚠️ Important: `f4c9d21` does NOT fix the live blocker
The branch carries the **same `VERIFY_SRC` scope bug** — `sealReauthGate` (line ~999) references `VERIFY_SRC`, which is still only declared at line ~1150 inside the upfront-identity IIFE. So even after merging `f4c9d21`, clicking the seal will still throw `ReferenceError: VERIFY_SRC is not defined` and the overlay still won't open.

**Recommended fix before/with the merge:** hoist `VERIFY_SRC` (and ideally the shared verify-overlay open logic) to a top-level/shared scope so `sealReauthGate` can see it — the in-code comment already flags this ("once that capture UI is factored into a shared module — tracked in F-TRIBUNAL-SEAL-REAUTH-GATE"). That refactor is the actual unblock; the server-side authorize work in `f4c9d21` rides on top of it.

---

## Verdict summary

- **architecture.html:** PASS
- **tribunal-demo.html:** FAIL — seal re-auth gate is wired but throws `VERIFY_SRC is not defined`; overlay never opens, seal dead-ends, no token leaks. Release blocker.
- **vat-verify.html:** PASS — quick-reauth gated reveal works correctly.
- **Branch `f4c9d21`:** adds the server-side gate+audit (hard gate + AAR) but inherits the same `VERIFY_SRC` scope bug — needs the scoping fix to make the seal overlay open at all.
