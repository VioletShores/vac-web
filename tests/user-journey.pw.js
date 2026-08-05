// user-journey.pw.js — VAC Protocol · User-Journey Harness
//
// SPEC: L0 PACKET — USER-JOURNEY HARNESS + CONTINUE-TO-MATTERS FIX
// TC family: TC-UJ (framework v6 journey)
//
// Debt item: after Rob passed full E2E auth, clicking "Continue to the matters" on
// auth.html navigated to tribunal-demo.html#matters but the biometric was re-offered
// (auth state not carried / wrong landing). Recurrence = no fixture was ever written
// for this flow. This file is that fixture.
//
// Root cause (reproduced by TC-UJ-F0): auth.html saves vac_verified to localStorage,
// generates link to tribunal-demo.html#matters, but tribunal-demo.html has no
// #matters-hash + localStorage check on load → walkBody stays hidden → idPre stays
// visible → "Try the live biometric" re-offered → loop.
//
// TEST-ONLY auth stub: localStorage.vac_verified is injected via addInitScript before
// page scripts run. This is the same key auth.html writes after biometric success —
// no production code is modified. /cso verifies no stub code exists in prod paths.
//
// Run: npx playwright test tests/user-journey.pw.js
//      npx playwright test tests/user-journey.pw.js --headed (visual)

'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const TRIBUNAL_URL = 'file://' + path.join(ROOT, 'tribunal-demo.html');
const AUTH_URL     = 'file://' + path.join(ROOT, 'auth.html');

// TEST-ONLY auth stub — mirrors what auth.html writes to localStorage on biometric success.
// MUST NOT appear in any production code path. /cso gate verifies unreachable in prod.
function _testAuthSession(overrides) {
  return Object.assign({
    email: 'test@vacprotocol.test',
    name: 'Test User',
    timestamp: Date.now(),
    authResult: { overall_score: 0.95 }
  }, overrides || {});
}

// ── TC-UJ-F0: FAILING FIXTURE (must fail on unfixed code) ────────────────────
//
// Reproduces Rob's loop: user completes auth on auth.html (localStorage.vac_verified
// is set), clicks "Continue to the matters" → lands on tribunal-demo.html#matters.
// On UNFIXED code: walkBody stays hidden, idPre visible, "Try the live biometric"
// re-offered. This test asserts the CORRECT post-fix behavior; it must FAIL before
// the fix is applied and PASS after.

test('TC-UJ-F0 [continue-to-matters loop — failing fixture]: vac_verified + #matters → walkBody revealed, biometric NOT re-offered', async ({ page }) => {
  // Inject verified session before any page script runs (TEST-ONLY auth stub)
  await page.addInitScript(session => {
    try { window.localStorage.setItem('vac_verified', JSON.stringify(session)); } catch(_) {}
  }, _testAuthSession());

  await page.goto(TRIBUNAL_URL + '#matters');
  await page.waitForLoadState('domcontentloaded');

  // ASSERT: walkBody is revealed (matters visible)
  // TC-UJ-F0-A: walkBody must not carry the hidden attribute
  const walkBody = page.locator('#walkBody');
  await expect(walkBody, 'TC-UJ-F0-A: walkBody must be visible after auth return via #matters').not.toHaveAttribute('hidden');

  // ASSERT: gate is in done state (auth recognised — idPre collapsed by CSS)
  // TC-UJ-F0-B: idGate must have class "done"
  const gate = page.locator('#idGate');
  await expect(gate, 'TC-UJ-F0-B: idGate must carry class done (auth state recognised)').toHaveClass(/\bdone\b/);

  // ASSERT: "Try the live biometric" CTA is NOT re-offered
  // TC-UJ-F0-C: idVerifyBtn hidden via #idPre{display:none}
  const idVerifyBtn = page.locator('#idVerifyBtn');
  await expect(idVerifyBtn, 'TC-UJ-F0-C: idVerifyBtn must not be visible (biometric not re-offered)').not.toBeVisible();

  // ASSERT: verified badge is shown
  // TC-UJ-F0-D: idVerified not hidden
  const idVerified = page.locator('#idVerified');
  await expect(idVerified, 'TC-UJ-F0-D: idVerified badge must be visible').not.toHaveAttribute('hidden');
});

// ── TC-UJ-01: Cold landing ────────────────────────────────────────────────────

test('TC-UJ-01: cold landing on tribunal-demo — "Try the live biometric" is present', async ({ page }) => {
  await page.goto(TRIBUNAL_URL);
  await page.waitForLoadState('domcontentloaded');

  const btn = page.locator('#idVerifyBtn');
  await expect(btn, 'TC-UJ-01: idVerifyBtn must be present on cold landing').toBeVisible();
  await expect(btn, 'TC-UJ-01: button text').toContainText('Try the live biometric');
});

// ── TC-UJ-02: Cold landing — skip CTA present ─────────────────────────────────

test('TC-UJ-02: cold landing — "Continue to the matters" skip button present', async ({ page }) => {
  await page.goto(TRIBUNAL_URL);
  await page.waitForLoadState('domcontentloaded');

  const skip = page.locator('#idSkip');
  await expect(skip, 'TC-UJ-02: idSkip must be present on cold landing').toBeVisible();
  await expect(skip, 'TC-UJ-02: button text').toContainText('Continue to the matters');
});

// ── TC-UJ-03: Click skip → matters revealed without auth ─────────────────────

test('TC-UJ-03: click "Continue to the matters" → walkBody revealed, matters cards present', async ({ page }) => {
  await page.goto(TRIBUNAL_URL);
  await page.waitForLoadState('domcontentloaded');

  // walkBody starts hidden
  const walkBody = page.locator('#walkBody');
  await expect(walkBody, 'TC-UJ-03 pre: walkBody starts hidden').toHaveAttribute('hidden');

  await page.locator('#idSkip').click();

  // TC-UJ-03-A: walkBody now visible
  await expect(walkBody, 'TC-UJ-03-A: walkBody revealed after skip click').not.toHaveAttribute('hidden');

  // TC-UJ-03-B: at least one .matter card is present
  const matterCards = page.locator('#matters .matter');
  const count = await matterCards.count();
  expect(count, 'TC-UJ-03-B: at least one matter card must be rendered').toBeGreaterThan(0);

  // TC-UJ-03-C: idGate does NOT have .done (unauthenticated skip — verify CTA still offered)
  const gate = page.locator('#idGate');
  await expect(gate, 'TC-UJ-03-C: gate is not done on unauthenticated skip').not.toHaveClass(/\bdone\b/);
});

// ── TC-UJ-04: Full journey POST-FIX ──────────────────────────────────────────
//
// Simulates the full cold-user journey:
//   land on demo entry → biometric CTA present → (auth stub injected) → navigate
//   to #matters → matters content rendered, auth CTA NOT re-offered, no loop back.

test('TC-UJ-04: full journey — auth state carried via #matters, matters content rendered, no loop', async ({ page }) => {
  // Step 1: cold landing — verify entry point
  await page.goto(TRIBUNAL_URL);
  await page.waitForLoadState('domcontentloaded');

  // TC-UJ-04-A: biometric CTA present on cold landing
  await expect(page.locator('#idVerifyBtn'), 'TC-UJ-04-A: biometric CTA present on cold landing').toBeVisible();

  // Step 2: simulate completed auth (TEST-ONLY stub — mirrors auth.html localStorage write)
  await page.evaluate(session => {
    try { window.localStorage.setItem('vac_verified', JSON.stringify(session)); } catch(_) {}
  }, _testAuthSession());

  // Step 3: navigate to #matters (the URL auth.html's "Continue to the matters" button generates).
  // Use a forced full reload: navigate away then to the target URL so the IIFE re-runs.
  // (same-base + different-hash from the same page is a same-document navigation in Chrome —
  // scripts don't re-run; the reload approach matches the real user flow from auth.html which
  // is a full cross-page navigation, not a hash change.)
  await page.goto('about:blank');
  await page.goto(TRIBUNAL_URL + '#matters');
  await page.waitForLoadState('domcontentloaded');

  // TC-UJ-04-B: matters content rendered (walkBody visible)
  await expect(page.locator('#walkBody'), 'TC-UJ-04-B: walkBody must be visible').not.toHaveAttribute('hidden');

  // TC-UJ-04-C: auth recognised — gate done, idPre collapsed
  await expect(page.locator('#idGate'), 'TC-UJ-04-C: idGate must have class done').toHaveClass(/\bdone\b/);

  // TC-UJ-04-D: "Try the live biometric" is NOT re-offered
  await expect(page.locator('#idVerifyBtn'), 'TC-UJ-04-D: biometric CTA must not be visible (no loop)').not.toBeVisible();

  // TC-UJ-04-E: at least 6 matter cards rendered (MATTERS array has 6 items in source)
  const matterCards = page.locator('#matters .matter');
  const count = await matterCards.count();
  expect(count, 'TC-UJ-04-E: all 6 matter cards must be rendered').toBeGreaterThanOrEqual(6);

  // TC-UJ-04-F: verified name in badge
  const badge = page.locator('#idVerified');
  await expect(badge, 'TC-UJ-04-F: verified badge must be visible').not.toHaveAttribute('hidden');
});

// ── TC-UJ-05: auth.html — "Try the live biometric" entry point present ───────

test('TC-UJ-05: auth.html cold landing — biometric form entry point is present', async ({ page }) => {
  await page.goto(AUTH_URL);
  await page.waitForLoadState('domcontentloaded');

  // auth.html has an email/OTP entry or biometric form; the key marker is that it
  // loads without JS error and shows an interactive form (not a blank page).
  // We check the page has a non-trivial body content.
  const bodyText = await page.locator('body').innerText();
  expect(bodyText.length, 'TC-UJ-05: auth.html must render content').toBeGreaterThan(100);
});

// ── TC-UJ-06: No dead links on journey pages ──────────────────────────────────
//
// Source-level check: all same-origin hrefs in tribunal-demo.html and auth.html
// must resolve to existing files in the project root.

test('TC-UJ-06: no dead links — all same-origin hrefs in journey pages resolve to existing files', async () => {
  const journeyFiles = ['tribunal-demo.html', 'auth.html'];
  const dead = [];

  for (const file of journeyFiles) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    // Extract all href values
    const hrefRe = /href=["']([^"'#?]+(?:\.html|\.js|\.css|\.json|\.pdf|\.png|\.ico|\.jpg|\.webp)[^"']*)["']/gi;
    let m;
    while ((m = hrefRe.exec(src)) !== null) {
      const href = m[1];
      // Skip external URLs
      if (/^https?:\/\//.test(href)) continue;
      // Resolve to file path (strip leading /)
      const rel = href.replace(/^\//, '');
      const abs = path.join(ROOT, rel);
      if (!fs.existsSync(abs)) {
        dead.push({ in: file, href });
      }
    }
  }

  expect(dead, 'TC-UJ-06: dead links found: ' + JSON.stringify(dead)).toHaveLength(0);
});

// ── TC-UJ-07: "Start a conversation" CTA — non-noop destination gate ──────────
//
// D-START-CONVERSATION-DEAD-CTA: the matters-page conversion button was a no-op
// (plain button with no destination). The fix: wire it to the site's existing
// mailto contact pattern (enterprise@vacprotocol.org) with prefilled source-page
// context in the body so Rob's team immediately knows which page the lead came from.
//
// This test is the regression gate: it must FAIL on a bare button or a subject-only
// mailto (no body = no source context), and PASS after the fix.
//
// Assertions:
//   A: the CTA is visible (not hidden behind auth gate)
//   B: the href is a mailto: link — not '#', 'javascript:', or a dead <button>
//   C: the mailto includes a body= parameter with source-page context [FAILING FIXTURE]

test('TC-UJ-07 [D-START-CONVERSATION-DEAD-CTA — no-op gate]: "Start a conversation" CTA has a mailto href with source-page context in the body', async ({ page }) => {
  await page.goto(TRIBUNAL_URL);
  await page.waitForLoadState('domcontentloaded');

  // TC-UJ-07-A: CTA is present and visible (lives outside the auth-gated walkBody)
  const ctaLink = page.locator('a.cta-btn:has-text("Start a conversation")');
  await expect(ctaLink, 'TC-UJ-07-A: "Start a conversation" CTA must be visible').toBeVisible();

  // TC-UJ-07-B: href must be a mailto: URI (not a no-op # or bare button)
  const href = await ctaLink.getAttribute('href');
  expect(href, 'TC-UJ-07-B: href must be a mailto: link').toMatch(/^mailto:/i);

  // TC-UJ-07-C: mailto must carry a body= parameter with source-page context.
  // A subject-only mailto gives Rob's team no signal about which page the lead came
  // from; a prefilled body encodes the source page for attribution.
  expect(href, 'TC-UJ-07-C: mailto must include a body= parameter (source-page context)').toContain('body=');
});
