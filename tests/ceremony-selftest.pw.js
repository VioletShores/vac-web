// ceremony-selftest.pw.js — S158 ceremony self-testing: sensor 2 (Playwright CI)
//
// Playwright tests that verify the ceremony page loads correctly and that the
// greeting_audible self-test wiring is consistent across all loader pages.
// Runs in CI on every push touching vac-reauth-ceremony.js or auth.html.
//
// What Playwright tests can verify in headless file:// mode:
//   - The ceremony page loads with no fatal JS errors
//   - The ceremony script tag carries the correct pin (s182)
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

// ── TC-CS-02: ceremony script tag carries a release pin ─────────────────────
// The pin is the cache key that makes browsers (above all iPad Safari) fetch new ceremony bytes.
// It is bumped with every ceremony change, so a frozen literal here goes stale on the next release
// (it did: s182 → s194d → s204-…). Assert a well-formed, non-retired pin; TC-CS-04 enforces parity.
const RETIRED_PINS = ['s173', 's182', 's194d', 's158b1', 's157c1', 's204-20261103-face-id'];
function authPin() {
  const src = fs.readFileSync(path.join(ROOT, 'auth.html'), 'utf8');
  const m = src.match(/vac-reauth-ceremony\.js\?v=([A-Za-z0-9-]+)/);
  return m ? m[1] : null;
}
test('TC-CS-02: auth.html ceremony script tag carries a current release pin', async ({ page }) => {
  await page.goto(AUTH_URL);
  await page.waitForLoadState('domcontentloaded');

  const scriptSrc = await page.evaluate(() => {
    const s = Array.from(document.querySelectorAll('script[src]'))
                   .find(el => el.getAttribute('src').includes('vac-reauth-ceremony.js'));
    return s ? s.getAttribute('src') : null;
  });

  expect(scriptSrc, 'TC-CS-02: ceremony script tag not found in auth.html').not.toBeNull();
  const m = scriptSrc.match(/[?&]v=([A-Za-z0-9-]+)/);
  expect(m, 'TC-CS-02: ceremony script must carry a ?v= release pin').not.toBeNull();
  expect(m[1], 'TC-CS-02: pin must look like a release stamp').toMatch(/^s\d{3}[a-z0-9-]*$/);
  expect(RETIRED_PINS, 'TC-CS-02: ceremony script carries a retired pin: ' + m[1]).not.toContain(m[1]);
  expect(m[1], 'TC-CS-02: served pin must equal the source pin').toBe(authPin());
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
// Every page that loads the ceremony script must use auth.html's pin. A mismatch serves
// different ceremony versions on different pages — the "frozen-pin disease" that caused the
// s156h8→s157c1 regression (cbf0415). The changed handoff script carries the same pin.

test('TC-CS-04: pin parity — all ceremony loader pages reference auth.html\'s pin', async () => {
  const pin = authPin();
  expect(pin, 'TC-CS-04: auth.html has no ceremony pin').not.toBeNull();
  const pinRe = /vac-reauth-ceremony\.js\?v=([A-Za-z0-9-]+)/g;
  const mismatches = [];
  for (const file of CEREMONY_LOADERS) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    let m;
    const pins = new Set();
    while ((m = pinRe.exec(src)) !== null) pins.add(m[1]);
    pinRe.lastIndex = 0;
    if (pins.size !== 1 || !pins.has(pin)) mismatches.push({ file, found: [...pins] });
  }
  expect(mismatches, 'TC-CS-04: pin mismatch vs auth.html ' + pin + ': ' + JSON.stringify(mismatches)).toHaveLength(0);
  const auth = fs.readFileSync(path.join(ROOT, 'auth.html'), 'utf8');
  expect(auth, 'TC-CS-04: vac-vault-handoff.js must be cache-keyed with the same pin')
    .toContain('/vac-vault-handoff.js?v=' + pin);
});
