// browse-s166.js — S166j task-greeting-gate-margins-and-overlays, item 8
// One-off Playwright walk of the ceremony at the iPhone 430x932 viewport, screenshotting every
// reachable screen to docs/debug/browse-s166/. Not a CI test (ad-hoc QA script) — run manually:
//   node scripts/browse-s166.js
// Requires: a local static server for the repo root (this script starts one), and
// `npx playwright install chromium` already done.

'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, '..', 'docs', 'debug', 'browse-s166');
fs.mkdirSync(OUT_DIR, { recursive: true });
const BASE_URL = process.env.BROWSE_BASE_URL || 'http://localhost:8899';

async function shot(page, name) {
    const p = path.join(OUT_DIR, name + '.png');
    await page.screenshot({ path: p });
    console.log('[shot]', name);
}

async function main() {
    const browser = await chromium.launch({
        args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
        ],
    });
    const context = await browser.newContext({
        viewport: { width: 430, height: 932 },
        deviceScaleFactor: 3,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        permissions: ['camera', 'microphone'],
    });
    await context.addInitScript(() => {
        try {
            localStorage.setItem('vac_otp_confirmed', JSON.stringify({ 'browse-s166@example.com': Date.now() }));
        } catch (_) {}
    });
    const page = await context.newPage();
    page.on('console', (msg) => { try { fs.appendFileSync(path.join(OUT_DIR, 'console.log'), '[' + msg.type() + '] ' + msg.text() + '\n'); } catch (_) {} });
    page.on('pageerror', (err) => { try { fs.appendFileSync(path.join(OUT_DIR, 'console.log'), '[pageerror] ' + err + '\n'); } catch (_) {} });

    // ── landing (identity step) ──────────────────────────────────────────────
    await page.goto(BASE_URL + '/auth.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await shot(page, '01-landing');

    await page.fill('#inputName', 'Browse S166');
    await page.fill('#inputEmail', 'browse-s166@example.com');
    await shot(page, '02-landing-filled');
    await page.click('#btnIdentity');

    // ── camera & mic preflight ───────────────────────────────────────────────
    await page.waitForSelector('#vacReauthMount video, #videoPreview', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(4000);   // let the preflight sensors settle (analyser, face/hand detectors)
    await shot(page, '03-camera-mic-preflight');

    // Try to advance past preflight if there's a manual continue/arm button.
    const armBtn = await page.$('button.btn-primary:visible, #btnArm, #continueBtn');
    if (armBtn) { try { await armBtn.click(); } catch (_) {} }
    await page.waitForTimeout(2000);
    await shot(page, '04-camera-mic-preflight-after-arm');

    // ── greeting (say the phrase) ────────────────────────────────────────────
    // No manual advance — the greeting phase is audio-gated (item 1-3 fix under test) or times
    // out via PHRASE_PHASE_MAX_S. Wait long enough to observe the "LISTENING" state and, if the
    // fake (silent) mic never satisfies the gate, the eventual timeout fallback.
    await page.waitForTimeout(6000);
    await shot(page, '05-greeting');
    await page.waitForTimeout(12000);
    await shot(page, '06-greeting-late');

    // ── digits 1-3 (show-and-say gesture phase) ──────────────────────────────
    for (let i = 1; i <= 3; i++) {
        await page.waitForTimeout(8000);
        await shot(page, `0${6 + i}-digit-${i}`);
    }

    // ── verifying / result ────────────────────────────────────────────────────
    await page.waitForTimeout(6000);
    await shot(page, '10-verifying');
    await page.waitForTimeout(10000);
    await shot(page, '11-result-or-final-state');

    await browser.close();
    console.log('Done. Screenshots in', OUT_DIR);
}

main().catch((e) => { console.error(e); process.exit(1); });
