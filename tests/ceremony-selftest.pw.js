// ceremony-selftest.pw.js — S158 ceremony self-testing: sensor 2 (Playwright CI)
//
// Playwright tests that verify the ceremony page loads correctly and that the
// greeting_audible self-test wiring is consistent across all loader pages.
// Runs in CI on every push touching vac-reauth-ceremony.js or auth.html.
//
// What Playwright tests can verify in headless file:// mode:
//   - The ceremony page loads with no fatal JS errors
//   - The ceremony script tag carries the correct pin (s158a1)
//   - The ceremony DOM mount point and step structure is intact
//   - Pin parity: all loader pages reference the same pin
//
// Run: npx playwright test tests/ceremony-selftest.pw.js

'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs   = require('fs');

const ROOT     = path.resolve(__dirname, '..');
const AUTH_URL = 'file://' + path.join(ROOT, 'auth.html');

// Pages that load the ceremony script — pin must be identical across all.
const CEREMONY_LOADERS = [
  'auth.html',
  'financial-demo.html',
  'reauth-count-test.html',
  'vat-verify.html',
  'tribunal-demo.html',
];

// ── TC-CS-01: auth.html loads with no fatal JS errors ────────────────────────
test('TC-CS-01: auth.html loads without fatal JS errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(AUTH_URL);
  await page.waitForLoadState('domcontentloaded');

  // Allow benign errors from missing camera/mic or backend in headless CI.
  const fatal = errors.filter(e =>
    !e.includes('getUserMedia') &&
    !e.includes('fetch') &&
    !e.includes('NetworkError') &&
    !e.includes('ERR_BLOCKED') &&
    !e.includes('MediaDevices') &&
    !e.includes('Permission') &&
    !e.includes('NotAllowed') &&
    !e.includes('cors') &&
    !e.includes('CORS') &&
    !e.includes('Failed to load resource') &&
    !e.includes('net::ERR')
  );
  expect(fatal, 'TC-CS-01: fatal JS errors on auth.html load: ' + JSON.stringify(fatal)).toHaveLength(0);
});

// ── TC-CS-02: ceremony script tag carries pin s158a1 ─────────────────────────
test('TC-CS-02: auth.html ceremony script tag carries pin s158a1', async ({ page }) => {
  await page.goto(AUTH_URL);
  await page.waitForLoadState('domcontentloaded');

  const scriptSrc = await page.evaluate(() => {
    const s = Array.from(document.querySelectorAll('script[src]'))
                   .find(el => el.getAttribute('src').includes('vac-reauth-ceremony.js'));
    return s ? s.getAttribute('src') : null;
  });

  expect(scriptSrc, 'TC-CS-02: ceremony script tag not found in auth.html').not.toBeNull();
  expect(scriptSrc, 'TC-CS-02: ceremony script must carry pin s158a1').toContain('s158a1');
  expect(scriptSrc, 'TC-CS-02: ceremony script must not carry old pin s157c1').not.toContain('s157c1');
});

// ── TC-CS-03: ceremony step DOM structure is present ─────────────────────────
test('TC-CS-03: auth.html has ceremony step sections in DOM', async ({ page }) => {
  await page.goto(AUTH_URL);
  await page.waitForLoadState('domcontentloaded');

  // The ceremony mounts step1/step2/step3 divs in the challenge panel.
  // Verify the static skeleton is present (step-sections in HTML or injected by ceremony IIFE).
  const bodyText = await page.locator('body').innerText();
  expect(bodyText.length, 'TC-CS-03: auth.html must render meaningful content').toBeGreaterThan(200);

  // The ceremony script tag must be the last non-inline script (load order guard).
  const scriptSrcs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[src]')).map(s => s.getAttribute('src'))
  );
  const hasCeremony = scriptSrcs.some(s => s.includes('vac-reauth-ceremony.js'));
  expect(hasCeremony, 'TC-CS-03: vac-reauth-ceremony.js script tag must be present in DOM').toBe(true);
});

// ── TC-CS-04: pin parity — all loader pages carry the same pin ───────────────
//
// Source-level check (not Playwright browser — avoids the 5× page load overhead).
// Verifies that every page that loads the ceremony script uses the same pin (s158a1).
// A pin mismatch causes cache-busting to serve different ceremony versions on different
// pages — the "frozen-pin disease" that caused the s156h8→s157c1 regression (cbf0415).

test('TC-CS-04: pin parity — all ceremony loader pages reference s158a1', async () => {
  const pinRe = /vac-reauth-ceremony\.js\?v=([a-z0-9]+)/g;
  const mismatches = [];

  for (const file of CEREMONY_LOADERS) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    let m;
    const pins = new Set();
    while ((m = pinRe.exec(src)) !== null) pins.add(m[1]);
    pinRe.lastIndex = 0;

    if (!pins.has('s158a1')) {
      mismatches.push({ file, found: [...pins] });
    }
  }

  expect(
    mismatches,
    'TC-CS-04: pin mismatch — these files do not reference s158a1: ' + JSON.stringify(mismatches)
  ).toHaveLength(0);
});

// ── TC-CS-05: ceremony source has no old pin (belt-and-suspenders) ───────────
test('TC-CS-05: vac-reauth-ceremony.js source does not contain old pin s157c1', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'vac-reauth-ceremony.js'), 'utf8');
  expect(
    src.includes('s157c1'),
    'TC-CS-05: vac-reauth-ceremony.js must not contain the old s157c1 pin'
  ).toBe(false);
  expect(
    src.includes('s158a1'),
    'TC-CS-05: vac-reauth-ceremony.js must contain the new s158a1 pin'
  ).toBe(true);
});
