// grant-page.test.js — task-grant-page-content-bound (F-1205 slice 3)
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
// at claims.vac_context.vac_authorisation and assurance level at claims.vac_assurance_level.
const FIXTURES = {
    serverFull: {
        jti: 'vat_grant_fixture_server_full',
        compact_jwt: 'eyJhbGciOiJFUzI1NiJ9.fixture.sig',
        verify_url: '/vat/verify/vat_grant_fixture_server_full',
        claims: {
            vac_assurance_level: 'L3',
            vac_context: {
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
            vac_context: {
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
            vac_context: {
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

test('fixture: server/full attestation nested at claims.vac_context.vac_authorisation is the trusted case', () => {
    const isServerAttestedFull = loadFn('isServerAttestedFull');
    const vacAuth = FIXTURES.serverFull.claims.vac_context.vac_authorisation;
    const assuranceLevel = FIXTURES.serverFull.claims.vac_assurance_level;
    assert.equal(isServerAttestedFull(vacAuth, assuranceLevel), true);
});

test('fixture: client_asserted attestation must trip the warning path', () => {
    const isServerAttestedFull = loadFn('isServerAttestedFull');
    const vacAuth = FIXTURES.clientAsserted.claims.vac_context.vac_authorisation;
    const assuranceLevel = FIXTURES.clientAsserted.claims.vac_assurance_level;
    assert.equal(isServerAttestedFull(vacAuth, assuranceLevel), false);
});

test('fixture: server/full attestation at a non-L3 assurance level must trip the warning path', () => {
    const isServerAttestedFull = loadFn('isServerAttestedFull');
    const vacAuth = FIXTURES.serverFullNotL3.claims.vac_context.vac_authorisation;
    const assuranceLevel = FIXTURES.serverFullNotL3.claims.vac_assurance_level;
    assert.equal(isServerAttestedFull(vacAuth, assuranceLevel), false);
});

test('renderResult only emits a copy button when server-attested full (source-level check)', () => {
    const body = extractNamedFnBody('renderResult');
    assert.ok(/if\s*\(\s*trusted\s*&&\s*jti\s*\)/.test(body), 'copy button must be gated on the trusted (server+full) check');
    assert.ok(/not L3 - re-run the full ceremony/.test(body), 'warning copy must match the spec text exactly');
});

test('renderResult reads vac_authorisation from claims.vac_context, falling back to claims.context then top-level (source-level check)', () => {
    // Two conflicting claims exist about the real /v1/vat/issue response shape (see the comment
    // above renderResult in grant.html) — this checks both nested shapes are tried, not just one.
    const body = extractNamedFnBody('renderResult');
    assert.ok(
        /claims\.vac_context\s*&&\s*claims\.vac_context\.vac_authorisation/.test(body),
        'renderResult must read the attestation from claims.vac_context.vac_authorisation'
    );
    assert.ok(
        /claims\.context\s*&&\s*claims\.context\.vac_authorisation/.test(body),
        'renderResult must fall back to claims.context.vac_authorisation (the previously evidenced shape)'
    );
    assert.ok(
        /\|\|\s*data\.vac_authorisation/.test(body),
        'renderResult must fall back to a top-level vac_authorisation for older response shapes'
    );
});

test('fixture: attestation nested at claims.context (the older-evidenced shape) still resolves as trusted', () => {
    const isServerAttestedFull = loadFn('isServerAttestedFull');
    const legacyShape = {
        claims: {
            vac_assurance_level: 'L3',
            context: { vac_authorisation: { attested_by: 'server', auth_level: 'full' } }
        }
    };
    const vacAuth = (legacyShape.claims.vac_context && legacyShape.claims.vac_context.vac_authorisation) ||
        (legacyShape.claims.context && legacyShape.claims.context.vac_authorisation);
    assert.equal(isServerAttestedFull(vacAuth, legacyShape.claims.vac_assurance_level), true);
});

test('renderResult renders vac_assurance_level and, when present, assurance_basis (source-level check)', () => {
    const body = extractNamedFnBody('renderResult');
    assert.ok(/vac_assurance_level/.test(body), 'renderResult must render vac_assurance_level');
    assert.ok(/assurance_basis/.test(body), 'renderResult must render assurance_basis when present');
});

// ============================================================
// Second tap: by-vat merge permit, content-bound to merge-candidates (F-1205 slice 3)
// ============================================================

// Real response from GET https://api.athenapilot.ai/v1/mac/merge-candidates?repo=VioletShores/athena
// (curled 2026-08-25, live shape this fixture set is coded against):
// {"repo":"VioletShores/athena","candidates":[{"name":"task-alert-hygiene-verdict-s173",
//   "sha":"2d9eb66a705678923edfb64274aa2b23215aa3a4","pr":148,
//   "title":"alert hygiene: dedupe+recovery, orphan≠stall, calibration grace, outcome-class pushes",
//   "gates":{"status":"passed","source":"pr-comment"},"updated_at":"2026-08-25T02:55:54Z","ready":true},
//  {"name":"task-wa-parity-sentinel-s173","sha":"138568b0ee9d59634b25ac47e96b272dbf0bd7a0","pr":146,
//   "title":"F-1207 WA parity sentinel — live WA answer vs best frontier-with-search, nightly, alarmed",
//   "gates":{"status":"passed","source":"pr-comment"},"updated_at":"2026-08-25T02:57:19Z","ready":true}]}
const CANDIDATE_FIXTURES = {
    ready: {
        name: 'task-alert-hygiene-verdict-s173',
        sha: '2d9eb66a705678923edfb64274aa2b23215aa3a4',
        pr: 148,
        title: 'alert hygiene: dedupe+recovery, orphan≠stall, calibration grace, outcome-class pushes',
        gates: { status: 'passed', source: 'pr-comment' },
        updated_at: '2026-08-25T02:55:54Z',
        ready: true
    },
    unknown: {
        name: 'feature/risky-refactor',
        sha: '9f8e7d6c5b4a3928170695847362514031201f0',
        pr: 43,
        title: 'Refactor auth core',
        gates: { status: 'unknown', reason: 'checks still running' },
        ready: false
    },
    failed: {
        name: 'feature/broken-thing',
        sha: 'deadbeefcafefeed1234567890abcdef1234567',
        pr: 44,
        title: 'WIP: do not merge',
        gates: { status: 'failed', reason: 'CI red' },
        ready: false
    },
    // Older/alternate shape: no top-level `pr`/`ready` fields, name under `branch`, gate
    // status under `verdict` — must still resolve via the fallbacks.
    legacyShape: {
        branch: 'feature/oauth-fix',
        sha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
        gates: { verdict: 'passed' }
    }
};

test('gatesStatus: reads gates.status, falling back to gates.verdict, then "unknown"', () => {
    const gatesStatus = loadFn('gatesStatus');
    assert.equal(gatesStatus({ status: 'passed' }), 'passed');
    assert.equal(gatesStatus({ verdict: 'passed' }), 'passed');
    assert.equal(gatesStatus({ status: 'failed', verdict: 'passed' }), 'failed');
    assert.equal(gatesStatus({}), 'unknown');
    assert.equal(gatesStatus(undefined), 'unknown');
});

test('isCandidateReady: ready:true preselects regardless of gate status', () => {
    const isCandidateReady = loadFn('isCandidateReady', 'gatesStatus');
    assert.equal(isCandidateReady({ ready: true, gates: { status: 'unknown' } }), true);
});

test('isCandidateReady: falls back to gates.status/verdict === "passed" when ready is absent', () => {
    const isCandidateReady = loadFn('isCandidateReady', 'gatesStatus');
    assert.equal(isCandidateReady({ gates: { status: 'passed' } }), true);
    assert.equal(isCandidateReady({ gates: { verdict: 'passed' } }), true);
    assert.equal(isCandidateReady({ gates: { status: 'unknown' } }), false);
    assert.equal(isCandidateReady({ gates: { status: 'failed' } }), false);
    assert.equal(isCandidateReady({}), false);
    assert.equal(isCandidateReady(undefined), false);
});

test('isCandidateReady: ready:false does not override a passing gate status', () => {
    const isCandidateReady = loadFn('isCandidateReady', 'gatesStatus');
    assert.equal(isCandidateReady({ ready: false, gates: { status: 'passed' } }), true);
});

test('shortSha truncates to 7 characters', () => {
    const shortSha = loadFn('shortSha');
    assert.equal(shortSha('a1b2c3d4e5f6'), 'a1b2c3d');
    assert.equal(shortSha(''), '');
    assert.equal(shortSha(undefined), '');
});

test('candidateRowHtml: a ready candidate is preselected (checked) and not greyed', () => {
    const candidateRowHtml = loadFn('candidateRowHtml', 'isCandidateReady', 'gatesStatus', 'shortSha', 'escapeHtml');
    const html = candidateRowHtml(CANDIDATE_FIXTURES.ready, 0);
    assert.ok(html.includes('checked'), 'ready candidate must be preselected');
    assert.ok(!html.includes('candidate-row-greyed'), 'ready candidate must not be greyed');
    assert.ok(html.includes('task-alert-hygiene-verdict-s173'), 'must render the name');
    assert.ok(html.includes('2d9eb66'), 'must render the short sha');
    assert.ok(html.includes('#148'), 'must render the PR number');
    assert.ok(html.includes('alert hygiene: dedupe+recovery'), 'must render the PR title');
    assert.ok(html.includes('passed'), 'must render the gates status');
});

test('candidateRowHtml: unknown/failed candidates are unchecked, greyed, and show the reason', () => {
    const candidateRowHtml = loadFn('candidateRowHtml', 'isCandidateReady', 'gatesStatus', 'shortSha', 'escapeHtml');
    for (const key of ['unknown', 'failed']) {
        const html = candidateRowHtml(CANDIDATE_FIXTURES[key], 0);
        assert.ok(!html.includes('checked'), key + ' candidate must not be preselected');
        assert.ok(html.includes('candidate-row-greyed'), key + ' candidate must be greyed');
        assert.ok(html.includes(CANDIDATE_FIXTURES[key].gates.reason), key + ' candidate must show its reason');
    }
});

test('candidateRowHtml: data-name/data-sha carry the exact name/sha for the POST body, not the shortened sha', () => {
    const candidateRowHtml = loadFn('candidateRowHtml', 'isCandidateReady', 'gatesStatus', 'shortSha', 'escapeHtml');
    const html = candidateRowHtml(CANDIDATE_FIXTURES.ready, 0);
    assert.ok(html.includes('data-name="task-alert-hygiene-verdict-s173"'));
    assert.ok(html.includes('data-sha="' + CANDIDATE_FIXTURES.ready.sha + '"'));
});

test('candidateRowHtml: falls back to `branch` for the name and `gates.verdict` for the status (legacy shape)', () => {
    const candidateRowHtml = loadFn('candidateRowHtml', 'isCandidateReady', 'gatesStatus', 'shortSha', 'escapeHtml');
    const html = candidateRowHtml(CANDIDATE_FIXTURES.legacyShape, 0);
    assert.ok(html.includes('data-name="feature/oauth-fix"'), 'must fall back to `branch` for the name');
    assert.ok(html.includes('checked'), 'must preselect via the gates.verdict fallback');
    assert.ok(html.includes('(no PR)'), 'must show (no PR) when `pr` is absent');
});

test('renderCandidateListHtml: renders a row per candidate from a stubbed response', () => {
    const renderCandidateListHtml = loadFn('renderCandidateListHtml', 'candidateRowHtml', 'isCandidateReady', 'gatesStatus', 'shortSha', 'escapeHtml');
    const html = renderCandidateListHtml([CANDIDATE_FIXTURES.ready, CANDIDATE_FIXTURES.unknown, CANDIDATE_FIXTURES.failed]);
    assert.ok(html.includes('task-alert-hygiene-verdict-s173'));
    assert.ok(html.includes('feature/risky-refactor'));
    assert.ok(html.includes('feature/broken-thing'));
    assert.equal((html.match(/candidate-checkbox/g) || []).length, 3);
});

test('renderCandidateListHtml: an empty candidate list renders a "no candidates" message and no checkboxes', () => {
    const renderCandidateListHtml = loadFn('renderCandidateListHtml', 'candidateRowHtml', 'isCandidateReady', 'gatesStatus', 'shortSha', 'escapeHtml');
    const html = renderCandidateListHtml([]);
    assert.ok(!html.includes('candidate-checkbox'));
    assert.ok(/no merge candidates/i.test(html));
});

test('buildGrantBody carries `vat` (not `vat_jti`) plus repo/branches/reason per the by-vat schema, content-bound to the given branches', () => {
    const buildGrantBody = loadFn('buildGrantBody');
    const user = { email: 'rob@example.com' };
    const vat = 'eyJhbGciOiJFUzI1NiJ9.fixture.sig';
    const nowIso = '2026-08-25T12:00:00.000Z';
    const branches = [{ name: 'feature/oauth-fix', sha: CANDIDATE_FIXTURES.legacyShape.sha }];
    const body = buildGrantBody(user, vat, branches, nowIso);

    assert.equal(body.vat, vat);
    assert.equal(body.vat_jti, undefined);
    assert.equal(body.repo, 'VioletShores/athena');
    assert.deepEqual(body.branches, branches);
    assert.equal(body.reason, 'granted from /grant by rob@example.com 2026-08-25T12:00:00.000Z');
});

test('buildGrantBody never silently defaults branches to an empty/wildcard list', () => {
    const buildGrantBody = loadFn('buildGrantBody');
    const user = { email: 'rob@example.com' };
    const branches = [{ name: 'a', sha: '1'.repeat(40) }, { name: 'b', sha: '2'.repeat(40) }];
    const body = buildGrantBody(user, 'vat', branches, '2026-08-25T12:00:00.000Z');
    assert.deepEqual(body.branches, branches);
    assert.equal(body.branches.length, 2);
});

test('isHumanRootedAuthority: the canonical hyphenated "human-rooted" class (the live /v1/mac/authorizations/by-vat shape) is trusted', () => {
    const isHumanRootedAuthority = loadFn('isHumanRootedAuthority');
    assert.equal(isHumanRootedAuthority('human-rooted'), true);
});

test('isHumanRootedAuthority: the underscored "human_rooted" class is accepted for compatibility with older shapes', () => {
    const isHumanRootedAuthority = loadFn('isHumanRootedAuthority');
    assert.equal(isHumanRootedAuthority('human_rooted'), true);
});

test('isHumanRootedAuthority: anything else (service-issued, shared-secret, empty, missing) is not trusted', () => {
    const isHumanRootedAuthority = loadFn('isHumanRootedAuthority');
    assert.equal(isHumanRootedAuthority('service_issued'), false);
    assert.equal(isHumanRootedAuthority('shared-secret'), false);
    assert.equal(isHumanRootedAuthority(''), false);
    assert.equal(isHumanRootedAuthority(undefined), false);
});

test('renderResult only shows the second (grant) card after a trusted mint (source-level check)', () => {
    const body = extractNamedFnBody('renderResult');
    assert.ok(
        /if\s*\(\s*trusted\s*&&\s*data\.compact_jwt\s*\)\s*\{\s*renderGrantCard\(/.test(body),
        'renderGrantCard must be gated on the trusted (server+full+L3) check, not called unconditionally'
    );
});

test('renderGrantCard fetches merge-candidates and starts with Grant disabled (source-level check)', () => {
    const cardBody = extractNamedFnBody('renderGrantCard');
    assert.ok(/id="grantBtn"[^>]*\bdisabled\b/.test(cardBody), 'Grant button must start disabled, before any candidates have loaded');
    assert.ok(/loadMergeCandidates\(\)/.test(cardBody), 'renderGrantCard must kick off the merge-candidates fetch');

    const loadBody = extractNamedFnBody('loadMergeCandidates');
    assert.ok(/ATHENA_API\s*\+\s*'\/v1\/mac\/merge-candidates\?repo='/.test(loadBody), 'must fetch ATHENA_API + /v1/mac/merge-candidates?repo=...');
    assert.ok(/VioletShores%2Fathena|VioletShores\/athena/.test(loadBody), 'must scope the request to VioletShores/athena');
});

test('unwrapCandidates: unwraps {candidates: [...]} (the live shape), falling back to a bare array', () => {
    const unwrapCandidates = loadFn('unwrapCandidates');
    assert.deepEqual(unwrapCandidates({ repo: 'VioletShores/athena', candidates: [CANDIDATE_FIXTURES.ready] }), [CANDIDATE_FIXTURES.ready]);
    assert.deepEqual(unwrapCandidates([CANDIDATE_FIXTURES.ready]), [CANDIDATE_FIXTURES.ready]);
    assert.deepEqual(unwrapCandidates({}), []);
    assert.deepEqual(unwrapCandidates(null), []);
});

test('loadMergeCandidates unwraps the response via unwrapCandidates rather than reading data.candidates directly (source-level check)', () => {
    const loadBody = extractNamedFnBody('loadMergeCandidates');
    assert.ok(/unwrapCandidates\(data\)/.test(loadBody), 'loadMergeCandidates must unwrap the response through unwrapCandidates');
});

test('a 404 (or any failure) from merge-candidates disables Grant and shows the unavailable message, never falling back to all-branches (source-level check)', () => {
    const loadBody = extractNamedFnBody('loadMergeCandidates');
    assert.ok(/r\.status\s*===\s*404/.test(loadBody), 'must special-case a 404 from the route');
    assert.ok(/renderCandidatesUnavailable/.test(loadBody), 'must route both 404 and other failures to renderCandidatesUnavailable');

    const unavailableBody = extractNamedFnBody('renderCandidatesUnavailable');
    assert.ok(/no candidate list available yet/.test(unavailableBody), 'unavailable message must match the spec text');
    assert.ok(/btn\.disabled\s*=\s*true/.test(unavailableBody), 'Grant must be disabled when candidates are unavailable');
});

test('updateGrantButtonState disables Grant unless at least one candidate checkbox is checked (source-level check)', () => {
    const body = extractNamedFnBody('updateGrantButtonState');
    assert.ok(/candidate-checkbox:checked/.test(body));
    assert.ok(/length\s*===\s*0/.test(body));
});

test('grantAuthority reads checked candidate checkboxes into {name, sha} pairs from data-name/data-sha and posts them as branches (source-level check)', () => {
    assert.ok(/ATHENA_API\s*=\s*'https:\/\/api\.athenapilot\.ai'/.test(src), 'ATHENA_API must be set to https://api.athenapilot.ai');
    const body = extractNamedFnBody('grantAuthority');
    assert.ok(/ATHENA_API\s*\+\s*'\/v1\/mac\/authorizations\/by-vat'/.test(body), 'grantAuthority must POST to ATHENA_API + /v1/mac/authorizations/by-vat');
    assert.ok(/candidate-checkbox/.test(body), 'grantAuthority must read the checked candidate checkboxes');
    assert.ok(/getAttribute\('data-name'\)/.test(body) && /getAttribute\('data-sha'\)/.test(body), 'grantAuthority must build branches from data-name/data-sha, not re-derive them');
    assert.ok(/if\s*\(\s*!branches\.length\s*\)\s*return/.test(body), 'grantAuthority must no-op (never POST) when no valid branch is selected, i.e. never send branches:[]');
});

test('grantAuthority drops any checked candidate whose data-name/data-sha is empty before counting it toward the never-empty guard (source-level check)', () => {
    const body = extractNamedFnBody('grantAuthority');
    assert.ok(
        /\.filter\(function\s*\(b\)\s*\{\s*return\s*b\.name\s*&&\s*b\.sha;\s*\}\)/.test(body),
        'grantAuthority must filter out branches with an empty name or sha, not just count checked boxes, so a malformed candidate response cannot slip an empty pair into the POST'
    );
});

test('the compact_jwt/vat never reaches localStorage — grant-flow functions must not reference storage', () => {
    const fns = ['renderGrantCard', 'grantAuthority', 'renderGrantResult', 'buildGrantBody', 'loadMergeCandidates']
        .map(fn => extractNamedFnBody(fn)).join('\n');
    assert.ok(!/localStorage/.test(fns), 'a grant-flow function references localStorage — the vat must stay in memory only');
});

test('the compact_jwt/vat is never rendered — grant-flow render functions must not interpolate it into innerHTML', () => {
    // renderGrantCard legitimately holds `vat` as a parameter so its click handler can forward
    // it to grantAuthority(user, vat) — that's the "in memory only" plumbing, not rendering.
    // What must never happen is `vat` being interpolated into the HTML string it builds, and
    // renderGrantResult/renderGrantError (which only ever see the server's response/an error
    // message) must not reference it at all.
    const stripStrings = s => s.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '');
    const noVatFns = ['renderGrantResult', 'renderGrantError']
        .map(fn => stripStrings(extractNamedFnBody(fn))).join('\n');
    assert.ok(!/\bvat\b/.test(noVatFns), 'renderGrantResult/renderGrantError must not reference `vat` — the server response never round-trips it');

    const cardBody = extractNamedFnBody('renderGrantCard');
    const htmlBuildSection = cardBody.slice(cardBody.indexOf('el.innerHTML'), cardBody.indexOf('stageEl.appendChild'));
    assert.ok(!/\bvat\b/.test(stripStrings(htmlBuildSection)), 'renderGrantCard must not interpolate `vat` into the card HTML it builds');
});

test('renderGrantResult renders permit id, authority_class, expires_at, the granted branch@sha list, and the exact explain line', () => {
    const body = extractNamedFnBody('renderGrantResult');
    assert.ok(/permit\.id/.test(body), 'must render the permit id from the nested permit object');
    assert.ok(/authority_class/.test(body), 'must render authority_class');
    assert.ok(/permit\.expires_at/.test(body), 'must render expires_at from the nested permit object');
    assert.ok(/!humanRooted/.test(body), 'a non-human-rooted authority_class must trip a warning');
    assert.ok(/grantedBranches\.map/.test(body), 'must render the list of granted branches');
    assert.ok(
        /'These ' \+ grantedBranches\.length \+ ' branches at these exact SHAs may be merged by the fleet before ' \+ expiresAt \+ '; any new commit on them needs a new grant\.'/.test(body),
        'explain line must match the spec text exactly'
    );
});

// Real response from POST https://api.athenapilot.ai/v1/mac/authorizations/by-vat
// (backend/main.py mac_authorizations_by_vat, backend/permits.py create_permit/
// _authority_class): {permit: {id, expires_at, branches, authority_class, ...},
// authority_class, vac_verdict, receipt} — id/expires_at/vac_verdict exist ONLY nested under
// `permit`, never top-level; authority_class is duplicated at both the top level and inside
// `permit` (L-2609/L-2610).
test('renderGrantResult reads id/expires_at/vac_verdict/branches from the nested `permit` object (source-level check)', () => {
    const body = extractNamedFnBody('renderGrantResult');
    assert.ok(/permit\s*&&\s*permit\.id/.test(body), 'must read the permit id from data.permit');
    assert.ok(/permit\s*&&\s*permit\.expires_at/.test(body), 'must read expires_at from data.permit');
    assert.ok(/permit\s*&&\s*permit\.vac_verdict/.test(body), 'must read vac_verdict from data.permit');
    assert.ok(/permit\s*&&\s*permit\.branches/.test(body), 'must prefer the server-recorded branches from data.permit.branches');
});

test('renderGrantResult shows the actual response keys, not a guessed message, when `permit` is entirely absent (source-level check)', () => {
    const body = extractNamedFnBody('renderGrantResult');
    assert.ok(/!permit/.test(body), 'must special-case a response with no permit');
    assert.ok(/Object\.keys\(data\)/.test(body), 'must render the actual top-level response keys when permit is missing');
});

test('renderGrantResult renders the server\'s receipt string under the branch list (source-level check)', () => {
    const body = extractNamedFnBody('renderGrantResult');
    const branchListIdx = body.indexOf('grantedBranchList');
    const receiptIdx = body.indexOf('data.receipt');
    assert.ok(branchListIdx >= 0 && receiptIdx > branchListIdx, 'receipt must render after (under) the branch list');
});

test('fixture: the live by-vat response shape (nested permit.{id,expires_at,authority_class}, top-level authority_class/vac_verdict/receipt) resolves human-rooted with a real permit id', () => {
    // Mirrors renderGrantResult's own fallback logic against the exact specimen shape (Rob
    // specimen, 2026-08-26), without requiring a DOM (renderGrantResult itself touches
    // document.getElementById).
    const isHumanRootedAuthority = loadFn('isHumanRootedAuthority');
    const data = {
        permit: {
            id: 'permit_9f3a2b1c',
            expires_at: '2026-08-27T04:00:00Z',
            authority_class: 'human-rooted',
            branches: [{ name: 'task-alert-hygiene-verdict-s173', sha: '2d9eb66a705678923edfb64274aa2b23215aa3a4' }]
        },
        authority_class: 'human-rooted',
        vac_verdict: 'approved',
        receipt: 'receipt_7e21'
    };
    const permit = data.permit || null;
    const authorityClass = (permit && permit.authority_class) || data.authority_class || '';
    const permitId = permit && permit.id != null ? permit.id : data.id;
    const expiresAt = (permit && permit.expires_at != null ? permit.expires_at : data.expires_at) || '(unknown)';
    const vacVerdict = permit && permit.vac_verdict != null ? permit.vac_verdict : data.vac_verdict;

    assert.equal(isHumanRootedAuthority(authorityClass), true, 'humanRooted must be true for the live response shape');
    assert.notEqual(String(permitId || '(none)'), '(none)', 'permit id must resolve to the real id, not the (none) placeholder');
    assert.equal(permitId, 'permit_9f3a2b1c');
    assert.equal(expiresAt, '2026-08-27T04:00:00Z');
    assert.equal(vacVerdict, 'approved');
    assert.equal(data.receipt, 'receipt_7e21');
});

test('fixture: a shared-secret permit trips the not-human-rooted warning', () => {
    const isHumanRootedAuthority = loadFn('isHumanRootedAuthority');
    const data = {
        permit: { id: 513, expires_at: '2026-08-25T16:00:00Z', authority_class: 'shared-secret' },
        authority_class: 'shared-secret'
    };
    const permit = data.permit || null;
    const authorityClass = (permit && permit.authority_class) || data.authority_class || '';
    assert.equal(isHumanRootedAuthority(authorityClass), false);
});

test('vercel.json has a rewrite for /grant -> /grant.html', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
    const match = vercel.rewrites.find(r => r.source === '/grant');
    assert.ok(match, '/grant rewrite missing from vercel.json');
    assert.equal(match.destination, '/grant.html');
});
