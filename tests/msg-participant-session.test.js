'use strict';
// msg-participant-session.test.js — S206 (vac-protocol #37/#39): msg.html sends the VAC
// session on the message GET and on video playback, plays the video from a blob URL
// (a <video src> cannot carry a header), and never parses sender-controlled text as HTML.
//
// Run: node --test tests/msg-participant-session.test.js
// Needs the `playwright` package and a Chromium (PLAYWRIGHT_CHROMIUM overrides the path).
// Network is fully intercepted: nothing leaves the machine.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let chromium = null;
for (const mod of ['playwright', '/opt/node22/lib/node_modules/playwright', '/opt/node-tools/node_modules/playwright']) {
    try { chromium = require(mod).chromium; break; } catch (_) {}
}

const PAGE = 'file://' + path.join(__dirname, '..', 'msg.html');
const API = 'https://vac-system-production.up.railway.app';
const MID = 'msg-0123456789ab';
const TOKEN = 'synthetic-session-token';
const EVIL = '"><img src=x onerror="window.__pwned=(window.__pwned||0)+1"><svg onload="window.__pwned=1">\'';

function message(overrides = {}) {
    return {
        message_id: MID, message_type: 'video_clip', content: '🎥 Video\n' + EVIL,
        sender_name: EVIL, subject: '', created_at: '2026-11-23T00:00:00+00:00',
        trust_level: 'verified', sender_trust_score: 0.8, sender_currently_verified: true,
        sender_chain: [], viewer_is_participant: false, ...overrides,
    };
}

async function open(t, { token = TOKEN, videoStatus = 200, msg = message() } = {}) {
    const opts = process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {};
    const browser = await chromium.launch(opts);
    t.after(() => browser.close());
    const page = await browser.newPage();
    const seen = [];
    if (token) await page.addInitScript(tk => { try { localStorage.setItem('vac_session', tk); } catch (e) {} }, token);
    await page.route('**/*', route => {
        const req = route.request();
        const url = req.url();
        if (!url.startsWith(API)) return url.startsWith('file:') ? route.continue() : route.abort();
        seen.push({ url, method: req.method(), auth: req.headers()['authorization'] || null });
        if (url === `${API}/v1/msg/${MID}`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(msg) });
        if (url === `${API}/v1/msg/${MID}/video`) {
            if (videoStatus !== 200) return route.fulfill({ status: videoStatus, contentType: 'application/json', body: '{"detail":{"error":"participant_session_required"}}' });
            return route.fulfill({ status: 200, contentType: 'video/webm', body: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]) });
        }
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });
    await page.goto(`${PAGE}?id=${MID}`);
    await page.waitForFunction(() => document.querySelector('[id^="msgMedia_"]'), null, { timeout: 10000 });
    await page.waitForTimeout(300);
    return { page, seen };
}

test('message GET and video GET carry the session; the video plays from a blob URL', { skip: !chromium }, async t => {
    const { page, seen } = await open(t);
    const get = seen.find(r => r.url === `${API}/v1/msg/${MID}`);
    const vid = seen.find(r => r.url === `${API}/v1/msg/${MID}/video`);
    assert.equal(get && get.auth, `Bearer ${TOKEN}`);
    assert.equal(vid && vid.auth, `Bearer ${TOKEN}`);
    const src = await page.$eval(`#msgMedia_${MID}`, el => el.src);
    assert.ok(src.startsWith('blob:'), 'played from a blob URL, never a token-bearing URL');
    assert.ok(!seen.some(r => r.url.includes(TOKEN)), 'the token is never put in a URL');
});

test('sender-controlled text is never parsed as HTML', { skip: !chromium }, async t => {
    const { page } = await open(t);
    assert.equal(await page.evaluate(() => window.__pwned || 0), 0);
    assert.equal(await page.$$eval('#readBody img, #readBody svg, #chainNodes img, #chainNodes svg', els => els.length), 0);
    assert.ok((await page.textContent('#readBody')).includes('<img src=x'), 'shown as text');
});

test('without a session, a 403 video shows the sign-in message, not a broken player', { skip: !chromium }, async t => {
    const { page, seen } = await open(t, { token: null, videoStatus: 403 });
    assert.equal(seen.find(r => r.url === `${API}/v1/msg/${MID}`).auth, null);
    const fb = await page.$eval(`#msgMedia_${MID}_fallback`, el => ({ shown: el.style.display, text: el.textContent }));
    assert.equal(fb.shown, 'block');
    assert.match(fb.text, /Sign in as the sender or recipient/);
    assert.equal(await page.$eval(`#msgMedia_${MID}`, el => el.style.display), 'none');
});

test('an expired or missing video says so', { skip: !chromium }, async t => {
    const { page } = await open(t, { videoStatus: 404 });
    const text = await page.$eval(`#msgMedia_${MID}_fallback`, el => el.textContent);
    assert.match(text, /no longer available/);
});
