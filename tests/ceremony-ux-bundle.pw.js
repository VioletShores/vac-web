// ceremony-ux-bundle.pw.js — s182 ceremony UX bundle: browser visual verification
//
// Serves the repo over a local HTTP server (absolute /vac-auth.js and /vac-reauth-ceremony.js
// paths do not resolve under file://), mocks the two backends, and drives each fix to its
// visible state. Screenshots land in test-results/ux-bundle/ for the human eye.
//
//   TC-UX-01  grant.html: aged (25h) prior authority -> expiry narration in the gate
//   TC-UX-02  grant.html: live by-vat shape -> no red authority_class banner, permit id + expiry
//             rendered, VRT copy, dark .page-shell
//   TC-UX-03  auth.html: aged vac_verified -> expiry note on the identity step
//   TC-UX-04  auth.html: post-capture stages (verifying cover; done + what it grants)
//
// Run: npx playwright test tests/ceremony-ux-bundle.pw.js

'use strict';

const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'test-results', 'ux-bundle');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const REWRITES = { '/auth': '/auth.html', '/grant': '/grant.html' };
const H = 60 * 60 * 1000;

let server, base;
test.beforeAll(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    p = REWRITES[p] || p;
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { await new Promise(r => server.close(r)); });

// Block the outside world; mock only what each flow calls.
async function isolate(page, api) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
    const u = new URL(route.request().url());
    const hit = api && api(u, route.request());
    if (hit) return route.fulfill({ status: hit.status || 200, contentType: 'application/json', body: JSON.stringify(hit.body === undefined ? {} : hit.body) });
    return route.abort();
  });
}

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

test.use({ viewport: { width: 430, height: 900 } });

// ── TC-UX-01 ──────────────────────────────────────────────────────────────────
test('TC-UX-01: grant.html narrates an expired (25h) prior authority in the full-ceremony gate', async ({ page }) => {
  await page.addInitScript(({ ts }) => {
    localStorage.setItem('vac_verified', JSON.stringify({ email: 'rob@example.com', name: 'Rob', timestamp: ts, authResult: { session_token: 'stale-token', authenticated: true } }));
  }, { ts: Date.now() - 25 * H });
  await isolate(page, (u) => {
    if (u.pathname === '/v1/auth/session') return { status: 401, body: { detail: 'Invalid session: expired' } };
    return null;
  });
  await page.goto(base + '/grant');
  const note = page.locator('#expiryNote');
  await expect(note).toBeVisible();
  await expect(note).toContainText('Your previous authority expired after 24 hours.');
  await expect(note).toContainText('Quick renewal is not yet enabled, so a full ceremony is required.');
  await expect(page.locator('#startCeremonyBtn')).toBeVisible();
  // the aged blob was purged, never bridged into a token
  expect(await page.evaluate(() => localStorage.getItem('vac_verified'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('vac_session'))).toBeNull();
  const shell = page.locator('.page-shell');
  expect(await shell.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(10, 15, 26)');
  expect(EMOJI.test(await page.locator('body').innerText())).toBe(false);
  await page.screenshot({ path: path.join(SHOTS, 'ux-01-grant-expiry.png'), fullPage: true });
});

// ── TC-UX-02 ──────────────────────────────────────────────────────────────────
test('TC-UX-02: grant.html renders a live human-rooted by-vat grant without the red banner, with permit id + expiry, in VRT copy', async ({ page }) => {
  await page.addInitScript(({ ts }) => {
    localStorage.setItem('vac_verified', JSON.stringify({ email: 'rob@example.com', name: 'Rob', timestamp: ts, authResult: { session_token: 'live-token', authenticated: true, session: { token: 'live-token', auth_level: 'full' } } }));
  }, { ts: Date.now() - 2 * H });
  const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  await isolate(page, (u, req) => {
    if (u.pathname === '/v1/auth/session') return { body: { valid: true, email: 'rob@example.com', name: 'Rob', auth_level: 'full', is_verified: true } };
    if (u.pathname === '/v1/auth/trust-status') return { body: { trust_level: 'verified', is_verified: true, vouches_received: 2 } };
    if (u.pathname === '/v1/auth/config') return { status: 404, body: {} };
    if (u.pathname === '/v1/vat/issue') return { body: { jti: 'jti_live_01', compact_jwt: 'h.p.s', verify_url: '/vat/verify/jti_live_01?intent=verify', claims: { vac_assurance_level: 'L3', context: { vac_authorisation: { attested_by: 'server', auth_level: 'full', assurance_basis: 'full ceremony' } } } } };
    if (u.pathname === '/v1/mac/merge-candidates') return { body: { candidates: [{ name: 'task-ceremony-ux', sha: SHA, pr: 31, title: 'ceremony UX bundle', gates: { status: 'passed' }, ready: true }] } };
    if (u.pathname === '/v1/mac/authorizations/by-vat' && req.method() === 'POST') {
      // exact live shape (athena backend/main.py by-vat route): id/expires_at nest under permit
      return { body: { permit: { id: 'permit_7f3a9c', repo: 'VioletShores/athena', expires_at: '2026-09-03T04:00:00+00:00', authority_class: 'human-rooted', vat_jti: 'jti_live_01', scope: 'merge' }, authority_class: 'human-rooted', vac_verdict: { valid: true }, receipt: 'permit permit_7f3a9c granted' } };
    }
    return null;
  });
  await page.goto(base + '/grant');
  const mint = page.locator('#mintBtn');
  await expect(mint).toBeVisible();
  await expect(mint).toHaveText('Mint merge-scope VRT');
  await mint.click();
  await expect(page.locator('#jtiBox')).toHaveText('jti_live_01');
  await expect(page.locator('body')).toContainText('Merge-scope VRT minted');
  const grant = page.locator('#grantBtn');
  await expect(grant).toBeEnabled();
  await grant.click();
  const card = page.locator('#grantResultCard');
  await expect(card).toBeVisible();
  await expect(card.locator('.warn-box')).toHaveCount(0);            // the false red banner is gone
  await expect(card).toContainText('permit_7f3a9c');
  await expect(card).toContainText('2026-09-03T04:00:00+00:00');
  await expect(card).toContainText('human-rooted');
  await expect(card).toContainText('task-ceremony-ux@a1b2c3d');
  const text = await page.locator('body').innerText();
  expect(/\bVAT\b/.test(text)).toBe(false);
  expect(EMOJI.test(text)).toBe(false);
  await page.screenshot({ path: path.join(SHOTS, 'ux-02-grant-result.png'), fullPage: true });
});

// ── TC-UX-03 ──────────────────────────────────────────────────────────────────
test('TC-UX-03: auth.html shows the expiry note (and keeps the identity pre-fill) when vac_verified is older than 24h', async ({ page }) => {
  await page.addInitScript(({ ts }) => {
    localStorage.setItem('vac_verified', JSON.stringify({ email: 'rob@example.com', name: 'Rob Z', timestamp: ts, authResult: { authenticated: true } }));
  }, { ts: Date.now() - 25 * H });
  await isolate(page, () => null);
  await page.goto(base + '/auth');
  const note = page.locator('#vacExpiryNote');
  await expect(note).toBeVisible();
  await expect(note).toContainText('Previous authority');
  await expect(note).toContainText('Your previous authority expired after 24 hours. Quick renewal is not yet enabled, so a full ceremony is required.');
  await expect(page.locator('#inputEmail')).toHaveValue('rob@example.com');
  expect(await page.evaluate(() => localStorage.getItem('vac_verified'))).toBeNull();
  expect(EMOJI.test(await note.innerText())).toBe(false);
  await page.waitForTimeout(900);   // step-section fade-in settles
  await page.screenshot({ path: path.join(SHOTS, 'ux-03-auth-expiry.png'), fullPage: true });
});

// ── TC-UX-04 ──────────────────────────────────────────────────────────────────
test('TC-UX-04: auth.html post-capture stages — verifying cover over the camera, then done + what it grants on the verify step', async ({ page }) => {
  await isolate(page, () => null);
  await page.goto(base + '/auth');
  await page.waitForFunction(() => window.VACReauth && typeof window.VACReauth.run === 'function');
  await page.evaluate(() => {
    document.getElementById('inputEmail').value = 'rob@example.com';
    document.getElementById('inputName').value = 'Rob Z';
    window.VACReauth.run({ mount: 'vacReauthMount', email: 'rob@example.com', name: 'Rob Z' });   // renders the ceremony DOM; no camera until a tap
    goToStep(2);
    document.getElementById('vacPostCapture').style.display = 'flex';
    window.VACReauth.renderAuthorityStages('verifying');
  });
  const cover = page.locator('#vacPostCapture');
  await expect(cover).toBeVisible();
  await expect(cover.locator('.vac-stage.active')).toHaveText(/Verifying your ceremony/);
  await expect(cover.locator('.vac-stage')).toHaveCount(3);
  // the cover sits above the skeleton canvas
  const z = await page.evaluate(() => [getComputedStyle(document.getElementById('vacPostCapture')).zIndex, getComputedStyle(document.getElementById('handOverlay')).zIndex]);
  expect(Number(z[0])).toBeGreaterThan(Number(z[1]));
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, 'ux-04a-stages-verifying.png'), fullPage: true });

  await page.evaluate(() => {
    goToStep(3);
    window.VACReauth.renderAuthorityStages('done', { result: { authenticated: true, session: { token: 'x', auth_level: 'full' } }, email: 'rob@example.com', returnPath: '/grant' });
  });
  const list = page.locator('#vacAuthorityStages');
  await expect(list).toBeVisible();
  await expect(list.locator('.vac-stage.done')).toHaveCount(3);
  await expect(list).toContainText('Minting your authority');
  await expect(list).toContainText('A full-tier verified session for rob@example.com, valid for 24 hours on this device. It can mint merge authority for VioletShores/athena on the grant page.');
  const gold = await list.locator('.vac-stage.active .vac-stage-title').count();
  expect(gold).toBe(0);   // nothing is "active" once done
  expect(EMOJI.test(await list.innerText())).toBe(false);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, 'ux-04b-stages-done.png'), fullPage: true });
});
