'use strict';
// S207 (Rob approved, 24 Nov; independent review of #82): the health check sends the admin
// token ONLY over https to an allow-listed backend host, and reports NOT CHECKED (never OK)
// for no token, a refused token, a disallowed URL, an odd 200 body or zero events.
// Session ids are aliased. No network: pure functions + a spawned run that never connects.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'ceremony-health-check.js');
const HC = require(SCRIPT);
const run = (env) => spawnSync(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 10000 });

test('token goes only to https on an allow-listed backend host', () => {
    assert.equal(HC.DEFAULT_API, 'https://vac-system-production.up.railway.app/v1/auth/debug');
    assert.equal(HC.tokenAllowedFor(HC.DEFAULT_API), true);
    for (const bad of [
        'https://vacprotocol.org/v1/auth/debug',                              // the frontend host (Vercel)
        'http://vac-system-production.up.railway.app/v1/auth/debug',          // not https
        'https://vac-system-production.up.railway.app.evil.example/v1/auth/debug',
        'https://evil.example/?h=vac-system-production.up.railway.app',
        'https://user:pw@vac-system-production.up.railway.app/v1/auth/debug', // credentials in the URL
        'https://vac-system-production.up.railway.app:8443/v1/auth/debug',    // non-default port
        'http://127.0.0.1:8080/v1/auth/debug', 'not a url', '',
    ]) assert.equal(HC.tokenAllowedFor(bad), false, bad);
});

test('a disallowed URL is refused before any request: NOT CHECKED, token never sent', () => {
    const r = run({ VAC_ADMIN_INSPECT_TOKEN: 'tok-123', VAC_DEBUG_API: 'https://vacprotocol.org/v1/auth/debug' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /NOT CHECKED: VAC_DEBUG_API must be https on an allow-listed backend host/);
    assert.doesNotMatch(r.stdout, /healthy\.|OK/);
});

test('no token: NOT CHECKED, nothing fetched', () => {
    const r = run({});
    assert.equal(r.status, 0);
    assert.match(r.stdout, /NOT CHECKED: VAC_ADMIN_INSPECT_TOKEN is not set/);
});

test('an odd or empty 200 body is NOT CHECKED: no data, never OK', () => {
    for (const body of [null, {}, [], 'x', 42, { events: null }, { events: {} }, { events: 'list' },
                        { events: [] }, { count: 0 }, { events: [{ event: 'mic_timing', context_json: '{}' }] }]) {
        const r = HC.report(null, body);
        assert.equal(r.code, 0);
        assert.equal(r.lines.length, 1, JSON.stringify(body));
        assert.match(r.lines[0], /NOT CHECKED: no data/, JSON.stringify(body));
        assert.doesNotMatch(r.lines.join('\n'), /healthy\.|OK/);
    }
});

test('refused token and transport errors are NOT CHECKED', () => {
    const e = new Error('unauthorized (HTTP 401)'); e.unauthorized = true;
    assert.match(HC.report(e, null).lines[0], /NOT CHECKED: the backend refused the token/);
    assert.match(HC.report(new Error('HTTP 502'), null).lines[0], /NOT CHECKED: the backend could not be read \(HTTP 502\)/);
});

test('real backend rows (context_json) are analysed, filtered to greeting_audible, with aliased sessions', () => {
    const rows = [
        { session_id: 'secret-session-AAA', event: 'greeting_audible', context_json: JSON.stringify({ context: { analyser_frames: 0 } }), created_at: '2026-11-24 02:00:00' },
        { session_id: 'secret-session-BBB', event: 'greeting_audible', context_json: JSON.stringify({ context: { analyser_frames: 9 } }), created_at: '2026-11-24 02:01:00' },
        { session_id: 'secret-session-AAA', event: 'mic_timing', context_json: '{}', created_at: '2026-11-24 02:02:00' },
    ];
    const r = HC.report(null, { events: rows });
    const out = r.lines.join('\n');
    assert.match(out, /2 greeting_audible events/);
    assert.match(out, /D-GREETING-ANALYSER-SILENT-ADVANCE/);
    assert.match(out, /session: s1/);
    assert.doesNotMatch(out, /secret-session/);
});

test('CI uses the backend URL and passes the repo secret; the frontend host is gone', () => {
    const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ceremony-selftest.yml'), 'utf8');
    assert.match(wf, /VAC_ADMIN_INSPECT_TOKEN: \$\{\{ secrets\.VAC_ADMIN_INSPECT_TOKEN \}\}/);
    assert.match(wf, /'https:\/\/vac-system-production\.up\.railway\.app\/v1\/auth\/debug'/);
    assert.doesNotMatch(wf, /vacprotocol\.org\/v1\/auth\/debug/);
    const src = fs.readFileSync(SCRIPT, 'utf8');
    assert.doesNotMatch(src, /require\('http'\)/, 'plain http is not used at all');
});
