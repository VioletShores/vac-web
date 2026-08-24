// grant-page.test.js — task-grant-page-permit-v1
//
// grant.html is a plain HTML page (no bundler, no framework), so this follows the same
// source-extract pattern as confirmed-behaviors.test.js: pull the named top-level functions
// out of the shipped inline <script> by brace-counting, eval them standalone (no DOM needed —
// the functions under test are pure), and assert against fixtures.
//
// Run: node --test tests/grant-page.test.js

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SRC_PATH = path.join(__dirname, '..', 'grant.html');
const html = fs.readFileSync(SRC_PATH, 'utf8');

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
assert.ok(inlineScripts.length >= 1, 'grant.html must have at least one inline <script>');
const src = inlineScripts.join('\n');

// Helper: extract a named top-level function body by brace-counting (same as
// tests/confirmed-behaviors.test.js's extractNamedFnBody).
function extractNamedFnBody(fnName) {
    const fnStart = src.indexOf('function ' + fnName + '(');
    assert.ok(fnStart >= 0, fnName + ' not found in grant.html inline script');
    let depth = 0, i = fnStart;
    while (i < src.length && depth === 0) { if (src[i] === '{') depth++; i++; }
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (!depth) { i++; break; } }
        i++;
    }
    return src.slice(fnStart, i);
}

function loadFn(fnName, ...deps) {
    const bodies = [fnName, ...deps].map(extractNamedFnBody).join('\n');
    const wrapper = `${bodies}\nreturn ${fnName};`;
    return new Function(wrapper)();
}

test('page loads without a JS syntax error (static check — no browser/jsdom available)', () => {
    const tmp = path.join(require('node:os').tmpdir(), 'grant-inline.js');
    fs.writeFileSync(tmp, src);
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', tmp]));
});

test('buildIssueBody matches the /v1/vat/issue IssueVATReq schema', () => {
    const buildIssueBody = loadFn('buildIssueBody');
    const user = { email: 'rob@example.com' };
    const token = 'tok_should_never_be_logged';
    const body = buildIssueBody(user, token);

    assert.equal(body.human_identity, 'rob@example.com');
    assert.equal(body.agent_id, 'athena-merge-lane');
    assert.deepEqual(body.resources, ['repo:VioletShores/athena']);
    assert.deepEqual(body.actions, ['merge']);
    assert.equal(body.verification_method, 'multi_modal');
    assert.equal(body.expiry_seconds, 86400);
    assert.equal(body.max_depth, 1);
    assert.equal(body.sensitivity, 'high');
    assert.deepEqual(body.context, { surface: 'grant', purpose: 'athena permit v1 merge scope' });
    assert.equal(body.authorising_session_token, token);
});

test('buildIssueBody never renders the session token — grant.html source must not interpolate it into innerHTML', () => {
    // Structural guard: the mint flow reads VAC.getToken() once and passes it straight into
    // fetch()'s JSON body; the *identifier* `token` must never appear as live code (only as
    // prose inside string literals, e.g. the explain-note copy) in any render*() function.
    const stripStrings = s => s.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '');
    const renderFns = ['renderGate', 'renderMintCard', 'renderResult', 'renderMintError']
        .map(fn => stripStrings(extractNamedFnBody(fn))).join('\n');
    assert.ok(!/\btoken\b/.test(renderFns), 'a render function uses the bare `token` identifier outside of string literals — session token must never reach the DOM as live code');
});

test('isServerAttestedFull: server + full attestation is trusted', () => {
    const isServerAttestedFull = loadFn('isServerAttestedFull');
    assert.equal(isServerAttestedFull({ attested_by: 'server', auth_level: 'full' }), true);
});

test('isServerAttestedFull: client_asserted attestation renders the warning path (not trusted)', () => {
    const isServerAttestedFull = loadFn('isServerAttestedFull');
    assert.equal(isServerAttestedFull({ attested_by: 'client_asserted', auth_level: 'full' }), false);
});

test('isServerAttestedFull: server attestation at a non-full auth_level is not trusted', () => {
    const isServerAttestedFull = loadFn('isServerAttestedFull');
    assert.equal(isServerAttestedFull({ attested_by: 'server', auth_level: 'quick' }), false);
});

test('isServerAttestedFull: missing/undefined block is not trusted', () => {
    const isServerAttestedFull = loadFn('isServerAttestedFull');
    assert.equal(isServerAttestedFull(undefined), false);
    assert.equal(isServerAttestedFull({}), false);
});

test('isServerAttestedFull: server + full + explicit vac_assurance_level "L3" is trusted', () => {
    const isServerAttestedFull = loadFn('isServerAttestedFull');
    assert.equal(isServerAttestedFull({ attested_by: 'server', auth_level: 'full' }, 'L3'), true);
});

test('isServerAttestedFull: server + full + a non-L3 vac_assurance_level is not trusted', () => {
    const isServerAttestedFull = loadFn('isServerAttestedFull');
    assert.equal(isServerAttestedFull({ attested_by: 'server', auth_level: 'full' }, 'L2'), false);
});

test('isServerAttestedFull: server + full + no vac_assurance_level field at all is still trusted (older response shape)', () => {
    const isServerAttestedFull = loadFn('isServerAttestedFull');
    assert.equal(isServerAttestedFull({ attested_by: 'server', auth_level: 'full' }, undefined), true);
});

// Fixture-driven: stubbed /v1/vat/issue responses, mirroring the real shape the endpoint
// returns — {jti, compact_jwt, claims, verify_url} — with the ceremony attestation nested
// at claims.context.vac_authorisation and assurance level at claims.vac_assurance_level.
const FIXTURES = {
    serverFull: {
        jti: 'vat_grant_fixture_server_full',
        compact_jwt: 'eyJhbGciOiJFUzI1NiJ9.fixture.sig',
        verify_url: '/vat/verify/vat_grant_fixture_server_full',
        claims: {
            vac_assurance_level: 'L3',
            context: {
                vac_authorisation: { attested_by: 'server', auth_level: 'full', assurance_basis: 'live_biometric' }
            }
        }
    },
    clientAsserted: {
        jti: 'vat_grant_fixture_client_asserted',
        compact_jwt: 'eyJhbGciOiJFUzI1NiJ9.fixture.sig',
        verify_url: '/vat/verify/vat_grant_fixture_client_asserted',
        claims: {
            vac_assurance_level: 'L3',
            context: {
                vac_authorisation: { attested_by: 'client_asserted', auth_level: 'full' }
            }
        }
    },
    serverFullNotL3: {
        jti: 'vat_grant_fixture_server_full_not_l3',
        compact_jwt: 'eyJhbGciOiJFUzI1NiJ9.fixture.sig',
        verify_url: '/vat/verify/vat_grant_fixture_server_full_not_l3',
        claims: {
            vac_assurance_level: 'L2',
            context: {
                vac_authorisation: { attested_by: 'server', auth_level: 'full' }
            }
        }
    }
};

test('sanitizeHref rejects javascript: and other non-http(s) schemes', () => {
    const sanitizeHref = loadFn('sanitizeHref', 'escapeHtml');
    assert.equal(sanitizeHref('javascript:alert(document.cookie)'), '');
    assert.equal(sanitizeHref('data:text/html,<script>alert(1)</script>'), '');
    assert.equal(sanitizeHref('vbscript:msgbox(1)'), '');
});

test('sanitizeHref allows same-origin relative paths and http(s) URLs', () => {
    const sanitizeHref = loadFn('sanitizeHref', 'escapeHtml');
    assert.equal(sanitizeHref('/vat/verify/vat_abc?intent=verify'), '/vat/verify/vat_abc?intent=verify');
    assert.equal(sanitizeHref('https://vac-system-production.up.railway.app/vat/verify/vat_abc'),
        'https://vac-system-production.up.railway.app/vat/verify/vat_abc');
    assert.equal(sanitizeHref('http://example.com/x'), 'http://example.com/x');
});

test('sanitizeHref rejects protocol-relative and double-slash paths', () => {
    const sanitizeHref = loadFn('sanitizeHref', 'escapeHtml');
    assert.equal(sanitizeHref('//evil.example.com/steal'), '');
});

test('errorMessageFromBody unwraps a FastAPI-style object/array detail instead of stringifying to [object Object]', () => {
    const errorMessageFromBody = loadFn('errorMessageFromBody');
    assert.equal(errorMessageFromBody({ detail: 'plain string' }, 400), 'plain string');
    assert.equal(errorMessageFromBody({ detail: { message: 'nested reason' } }, 400), 'nested reason');
    const arrayDetail = [{ loc: ['body', 'actions'], msg: 'field required', type: 'value_error' }];
    assert.equal(errorMessageFromBody({ detail: arrayDetail }, 422), JSON.stringify(arrayDetail));
    assert.equal(errorMessageFromBody({}, 500), 'HTTP 500');
});

test('fixture: server/full attestation nested at claims.context.vac_authorisation is the trusted case', () => {
    const isServerAttestedFull = loadFn('isServerAttestedFull');
    const vacAuth = FIXTURES.serverFull.claims.context.vac_authorisation;
    const assuranceLevel = FIXTURES.serverFull.claims.vac_assurance_level;
    assert.equal(isServerAttestedFull(vacAuth, assuranceLevel), true);
});

test('fixture: client_asserted attestation must trip the warning path', () => {
    const isServerAttestedFull = loadFn('isServerAttestedFull');
    const vacAuth = FIXTURES.clientAsserted.claims.context.vac_authorisation;
    const assuranceLevel = FIXTURES.clientAsserted.claims.vac_assurance_level;
    assert.equal(isServerAttestedFull(vacAuth, assuranceLevel), false);
});

test('fixture: server/full attestation at a non-L3 assurance level must trip the warning path', () => {
    const isServerAttestedFull = loadFn('isServerAttestedFull');
    const vacAuth = FIXTURES.serverFullNotL3.claims.context.vac_authorisation;
    const assuranceLevel = FIXTURES.serverFullNotL3.claims.vac_assurance_level;
    assert.equal(isServerAttestedFull(vacAuth, assuranceLevel), false);
});

test('renderResult only emits a copy button when server-attested full (source-level check)', () => {
    const body = extractNamedFnBody('renderResult');
    assert.ok(/if\s*\(\s*trusted\s*&&\s*jti\s*\)/.test(body), 'copy button must be gated on the trusted (server+full) check');
    assert.ok(/not L3 - re-run the full ceremony/.test(body), 'warning copy must match the spec text exactly');
});

test('renderResult reads vac_authorisation from claims.context, falling back to top-level (source-level check)', () => {
    const body = extractNamedFnBody('renderResult');
    assert.ok(
        /claims\.context\s*&&\s*claims\.context\.vac_authorisation/.test(body),
        'renderResult must read the attestation from claims.context.vac_authorisation'
    );
    assert.ok(
        /\|\|\s*data\.vac_authorisation/.test(body),
        'renderResult must fall back to a top-level vac_authorisation for older response shapes'
    );
});

test('renderResult renders vac_assurance_level and, when present, assurance_basis (source-level check)', () => {
    const body = extractNamedFnBody('renderResult');
    assert.ok(/vac_assurance_level/.test(body), 'renderResult must render vac_assurance_level');
    assert.ok(/assurance_basis/.test(body), 'renderResult must render assurance_basis when present');
});

test('vercel.json has a rewrite for /grant -> /grant.html', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
    const match = vercel.rewrites.find(r => r.source === '/grant');
    assert.ok(match, '/grant rewrite missing from vercel.json');
    assert.equal(match.destination, '/grant.html');
});
