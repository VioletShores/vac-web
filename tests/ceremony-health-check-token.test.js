'use strict';
// S207 (Rob approved, 24 Nov): reading /v1/auth/debug needs ADMIN_INSPECT_TOKEN. The health
// check sends it as X-Admin-Token, and without it (or when refused) reports NOT CHECKED, never
// "healthy". Runs against a local stub server; no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'ceremony-health-check.js');

function stub(handler) {
    return new Promise((resolve) => {
        const seen = [];
        const srv = http.createServer((req, res) => { seen.push(req.headers); handler(req, res); });
        srv.listen(0, '127.0.0.1', () => resolve({ srv, seen, url: `http://127.0.0.1:${srv.address().port}/v1/auth/debug` }));
    });
}

function runScript(env) {
    return new Promise((resolve) => {
        const p = spawn(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH, ...env } });
        let out = '';
        p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
        p.on('close', (code) => resolve({ code, out }));
    });
}

test('no token: nothing is fetched, and the result says NOT CHECKED (not healthy)', async () => {
    const s = await stub((req, res) => { res.end('{"events":[]}'); });
    const r = await runScript({ VAC_DEBUG_API: s.url });
    s.srv.close();
    assert.equal(r.code, 0);
    assert.match(r.out, /NOT CHECKED: VAC_ADMIN_INSPECT_TOKEN is not set/);
    assert.doesNotMatch(r.out, /healthy\./i);
    assert.equal(s.seen.length, 0, 'no request without a token');
});

test('token sent as X-Admin-Token; a 401 is NOT CHECKED, not healthy', async () => {
    const s = await stub((req, res) => { res.statusCode = 401; res.end('{"detail":"unauthorized"}'); });
    const r = await runScript({ VAC_DEBUG_API: s.url, VAC_ADMIN_INSPECT_TOKEN: 'tok-123' });
    s.srv.close();
    assert.equal(s.seen[0]['x-admin-token'], 'tok-123');
    assert.equal(r.code, 0);
    assert.match(r.out, /NOT CHECKED: the backend refused the token \(unauthorized \(HTTP 401\)\)/);
    assert.doesNotMatch(r.out, /All \d+ sessions healthy/);
});

test('with an accepted token the existing analysis runs unchanged', async () => {
    const events = [{ session_id: 's1', context: { analyser_frames: 0 } }, { session_id: 's2', context: { analyser_frames: 5 } }];
    const s = await stub((req, res) => { res.end(JSON.stringify({ events })); });
    const r = await runScript({ VAC_DEBUG_API: s.url, VAC_ADMIN_INSPECT_TOKEN: 'tok-123', ALERT_THRESHOLD: '3' });
    s.srv.close();
    assert.equal(r.code, 0);
    assert.match(r.out, /2 greeting_audible events/);
    assert.match(r.out, /D-GREETING-ANALYSER-SILENT-ADVANCE/);
});

test('CI passes the repo secret to the health check', () => {
    const wf = require('node:fs').readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ceremony-selftest.yml'), 'utf8');
    assert.match(wf, /VAC_ADMIN_INSPECT_TOKEN: \$\{\{ secrets\.VAC_ADMIN_INSPECT_TOKEN \}\}/);
});
