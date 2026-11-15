'use strict';
// vat-verify-xss.test.js — PKT-S201-VACWEB-VERIFY-ESCAPE: render the real verify page in
// Chromium with backend responses (and a token header) whose every free-text field carries
// markup, and assert that nothing runs and no injected element or handler exists.
//
// Covers: the chain, the issuer card, modalities, budgets, the token inspector, patent
// tiles, warnings and errors (view / verify / failed intents); the key id from a token in
// the link (#jwt=); and the vouch-success view (email, and vouch-back links that are
// scripted, protocol-relative or browser-normalised to another host).
// Every free-text, numeric, enum and key-material field the backend returns is hostile,
// apart from the booleans that choose which view renders. The one exception is the
// published-key case of the key-id test, which needs a parseable key to reach that path.
//
// Run: node --test tests/vat-verify-xss.test.js
// Needs the `playwright` package and a Chromium (PLAYWRIGHT_CHROMIUM overrides the path).
// Network is fully intercepted: nothing leaves the machine.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let chromium = null;
for (const mod of ['playwright', '/opt/node22/lib/node_modules/playwright', '/opt/node-tools/node_modules/playwright']) {
    try { chromium = require(mod).chromium; break; } catch (_) {}
}

const PAGE = 'file://' + path.join(__dirname, '..', 'vat-verify.html');
const VALID_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=\n-----END PUBLIC KEY-----';
const EVIL = '"><img src=x onerror="window.__pwned=(window.__pwned||0)+1"><svg onload="window.__pwned=1">\'';

function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

function fixtures() {
    const hop = {
        token_id: EVIL, is_root: true, human_ref: EVIL, trust_score: EVIL, delegation_depth: EVIL,
        verification_method: EVIL, chain_hash: EVIL, issued_at: EVIL, expires_at: EVIL,
    };
    const verification = {
        valid: true, chain_length: EVIL, root_human_ref: EVIL, effective_trust_score: EVIL,
        chain: [hop, { ...hop, is_root: false }], errors: [], warnings: [EVIL], assurance_level: EVIL,
        email: EVIL, subject: EVIL, vouch_count: EVIL,
    };
    const node = (root) => ({
        depth: EVIL, agent_id: EVIL, trust_score: EVIL, is_root: root, status: EVIL, label: EVIL, icon: EVIL,
        scope_summary: { resources: EVIL, actions: [EVIL, EVIL], exclusions: EVIL },
        verification_method: EVIL, verification_signals: [EVIL],
    });
    return {
        chain: { chain_display: [node(true), node(false)], claim_mapping: [{ claims: EVIL, description: EVIL, status: EVIL }, { claims: EVIL, description: EVIL, status: EVIL }],
                 verification, vouch_count: EVIL, issuer: EVIL },
        verify: verification,
        budget: { budgets: [{ label: EVIL, spent: EVIL, budget: EVIL, utilisation_pct: EVIL, narrowing: EVIL, unit: EVIL }], time_window_minutes: EVIL },
        failed: { ...verification, valid: false, errors: [EVIL] },
        key: { key_id: EVIL, public_key: EVIL, keys: [{ key_id: EVIL, public_key: EVIL }] },
    };
}

async function open(browser, url, kind, f) {
    const page = await browser.newPage({ viewport: { width: 390, height: 1600 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => {
        const u = route.request().url();
        if (u.startsWith('file:')) return route.continue();
        if (u.includes('/v1/vat/chain/')) return route.fulfill({ json: kind === 'failed' ? { ...f.chain, verification: f.failed } : f.chain });
        if (u.includes('/v1/vat/verify/')) return route.fulfill({ json: kind === 'failed' ? f.failed : f.verify });
        if (u.includes('/v1/vat/budget/')) return route.fulfill({ json: f.budget });
        if (u.includes('/v1/vat/key')) return route.fulfill({ json: f.key });
        return route.fulfill({ status: 404, body: '' });
    });
    await page.goto(url);
    await page.waitForTimeout(2000);
    return { page, errors };
}

async function inspect(page) {
    return page.evaluate(() => {
        const root = document.body;
        const injected = root.querySelectorAll('img[src="x"], svg[onload]').length;
        let handlers = 0;
        root.querySelectorAll('*').forEach(el => { for (const a of el.attributes) if (/^on/i.test(a.name) && /__pwned/.test(a.value)) handlers++; });
        const badStatus = [...document.querySelectorAll('.chain-node-badge')]
            .map(el => [...el.classList].filter(c => c !== 'chain-node-badge'))
            .filter(cls => cls.some(c => !['active', 'revoked', 'expired'].includes(c))).length;
        // A link is unsafe if it is not http(s) once parsed, or if a relative-looking href lands
        // on another host (protocol-relative, or normalised by the browser, e.g. /\host).
        const SITE = 'https://vacprotocol.org/vat-verify.html';
        const badHref = [...document.querySelectorAll('a[href]')].filter(a => {
            const raw = a.getAttribute('href');
            if (/^\s*#/.test(raw)) return false;
            // the page's own origin (the auth link is built from location.origin; file:// here)
            if (raw.startsWith(location.origin + '/') && !raw.startsWith(location.origin + '//')) return false;
            let u; try { u = new URL(raw, SITE); } catch (_) { return true; }
            if (!/^https?:$/.test(u.protocol)) return true;
            return !/^https?:\/\//i.test(raw) && u.host !== 'vacprotocol.org';
        }).length;
        const app = document.getElementById('app');
        return { pwned: window.__pwned || 0, injected, handlers, badStatus, badHref, rendered: app ? app.innerText.length : 0,
                 shownLiterally: app ? app.innerText.includes('onerror=') : false };
    });
}

function launchOpts() {
    const exe = process.env.PLAYWRIGHT_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
        ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
    return exe ? { executablePath: exe } : {};
}

test('hostile backend values never become live markup on the verify page', { skip: !chromium && 'playwright not installed' }, async () => {
    const browser = await chromium.launch(launchOpts());
    try {
        for (const kind of ['view', 'verify', 'failed']) {
            const { page, errors } = await open(browser, PAGE + '?jti=vat_root_x&intent=' + (kind === 'verify' ? 'verify' : 'view'), kind, fixtures());
            const r = await inspect(page);
            await page.close();
            assert.ok(r.rendered > 0, `${kind}: page rendered nothing (${errors.join('; ')})`);
            assert.equal(r.pwned, 0, `${kind}: script ran`);
            assert.equal(r.injected, 0, `${kind}: injected elements present`);
            assert.equal(r.handlers, 0, `${kind}: injected inline event handlers present`);
            assert.equal(r.badStatus, 0, `${kind}: chain status reached the class list unfiltered`);
            assert.equal(r.badHref, 0, `${kind}: unsafe link present`);
            assert.ok(r.shownLiterally, `${kind}: hostile text should be shown as plain text`);
        }
    } finally {
        await browser.close();
    }
});

test('a key id from a token in the link is shown as text', { skip: !chromium && 'playwright not installed' }, async () => {
    const browser = await chromium.launch(launchOpts());
    try {
        // Two paths print the token's own key id: a key the service does not publish ("old
        // key"), and the published key (checked in the browser). The fixture publishes key id
        // EVIL; the published path needs a parseable key, so that case alone gets a real one.
        for (const [path, kid] of [['old_key', EVIL + '-retired'], ['published', EVIL]]) {
            const jwt = b64url({ alg: 'EdDSA', kid }) + '.' + b64url({ jti: 'vat_root_x' }) + '.AAAA';
            const f = fixtures();
            if (path === 'published') f.key = { ...f.key, public_key: VALID_PUBLIC_KEY };
            const { page } = await open(browser, PAGE + '?jti=vat_root_x#jwt=' + encodeURIComponent(jwt), 'view', f);
            const r = await inspect(page);
            const sig = await page.evaluate(() => (document.getElementById('sigCheckResult') || {}).innerText || '');
            await page.close();
            assert.ok(sig.includes('onerror='), path + ': key id rendered as text: ' + sig.slice(0, 160));
            assert.equal(r.pwned, 0, path);
            assert.equal(r.injected, 0, path);
            assert.equal(r.handlers, 0, path);
        }
        // Hostile key material with a matching key id. A key that still decodes reaches a
        // completed render; a key that is not base64 stops the page before it builds any
        // markup from the API (behaviour at 7f2f9ec too). Neither may run anything.
        const kidJwt = b64url({ alg: 'EdDSA', kid: EVIL }) + '.' + b64url({ jti: 'vat_root_x' }) + '.AAAA';
        const decodable = '-----BEGIN ' + EVIL + '-----\n' + Buffer.from(EVIL).toString('base64') + '\n-----END PUBLIC KEY-----';
        for (const [label, key, completes] of [['decodable hostile key', decodable, true], ['non-base64 hostile key', EVIL, false]]) {
            const f = fixtures();
            f.key = { key_id: EVIL, public_key: key, keys: [{ key_id: EVIL, public_key: key }] };
            const { page } = await open(browser, PAGE + '?jti=vat_root_x#jwt=' + encodeURIComponent(kidJwt), 'view', f);
            const r = await inspect(page);
            const sig = await page.evaluate(() => (document.getElementById('sigCheckResult') || {}).innerText || '');
            await page.close();
            if (completes) {
                assert.ok(r.shownLiterally, label + ': page completed its render with hostile values shown as text');
                assert.ok(sig.length > 0, label + ': signature result rendered');
            }
            assert.equal(r.pwned, 0, label);
            assert.equal(r.injected, 0, label);
            assert.equal(r.handlers, 0, label);
            assert.equal(r.badHref, 0, label);
        }
    } finally {
        await browser.close();
    }
});

test('the vouch-success view escapes the email and drops unsafe links', { skip: !chromium && 'playwright not installed' }, async () => {
    const browser = await chromium.launch(launchOpts());
    try {
        for (const back of ['javascript:window.__pwned=1', 'data:text/html,x', '//evil.example/', '/\\evil.example/', '/\t/evil.example/']) {
            const { page } = await open(browser, PAGE + '?jti=vat_root_x', 'view', fixtures());
            await page.evaluate(([evil, url]) => {
                _vouchEmail = evil + '@x.example';
                showOtpStep();
                showVouchSuccess({ is_mutual: false, vouch_back_url: url, trust_edge: { state: evil } });
            }, [EVIL, back]);
            const r = await inspect(page);
            const backHref = await page.evaluate(() => { const a = document.querySelector('.vouch-back-btn'); return a ? a.getAttribute('href') : null; });
            await page.close();
            assert.equal(r.pwned, 0, back);
            assert.equal(r.injected, 0, back);
            assert.equal(r.handlers, 0, back);
            assert.equal(r.badHref, 0, 'no unsafe link for ' + JSON.stringify(back) + ': ' + backHref);
        }
    } finally {
        await browser.close();
    }
});
