'use strict';
// ceremony-post-progress.test.js — s182 ceremony UX bundle: post-capture authority progress screen
//
// The frozen last camera frame with the hand skeleton (dots + lines) used to sit on screen from the
// last digit until the server verdict — read by users as "stuck". s182 clears the skeleton canvas,
// covers the frozen feed, and narrates three honest stages: verifying -> minting authority ->
// done + what it grants. This harness extracts the PURE renderer pieces (AUTHORITY_STAGES,
// _authorityGrantsText, _authorityStagesHtml) and anchors the wiring by source regex.
//
// Run: node --test tests/ceremony-post-progress.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '..', 'vac-reauth-ceremony.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

function extractFn(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name + ' not found');
    let depth = 0, i = start;
    while (i < src.length && depth === 0) { if (src[i] === '{') depth++; i++; }
    while (i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) { i++; break; } } i++; }
    return src.slice(start, i);
}
const stagesConst = (() => { const i = src.indexOf('const AUTHORITY_STAGES = ['); const j = src.indexOf('];', i); return src.slice(i, j + 2); })();
const pure = Function(stagesConst + '\n' + extractFn('_authorityGrantsText') + '\n' + extractFn('_authorityStagesHtml') + '\nreturn { AUTHORITY_STAGES, _authorityGrantsText, _authorityStagesHtml };')();

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
const FULL = { authenticated: true, session_token: 't', session: { token: 't', auth_level: 'full' }, biometric_verification: { overall_score: 0.93 } };

test('TC-PP-01: three stages, in order, with plain copy and no emoji', () => {
    assert.deepEqual(pure.AUTHORITY_STAGES.map(s => s.key), ['verifying', 'minting', 'done']);
    assert.equal(pure.AUTHORITY_STAGES[0].title, 'Verifying your ceremony');
    assert.equal(pure.AUTHORITY_STAGES[1].title, 'Minting your authority');
    assert.equal(pure.AUTHORITY_STAGES[2].title, 'Done');
    for (const s of pure.AUTHORITY_STAGES) assert.ok(!EMOJI.test(s.title + s.sub), 'no emoji in stage copy: ' + s.title);
});

test('TC-PP-02: grants text — grant return path names the merge-authority use', () => {
    const t = pure._authorityGrantsText(FULL, { email: 'rob@example.com', returnPath: '/grant' });
    assert.match(t, /^A full-tier verified session for rob@example\.com, valid for 24 hours on this device\./);
    assert.match(t, /mint merge authority for VioletShores\/athena on the grant page\.$/);
    assert.ok(!EMOJI.test(t));
});

test('TC-PP-03: grants text — tribunal/financial return paths name sealing; no path names the generic uses', () => {
    assert.match(pure._authorityGrantsText(FULL, { email: 'a@b.c', returnPath: '/tribunal-demo' }), /seal matters on the demo you came from/);
    assert.match(pure._authorityGrantsText(FULL, { email: 'a@b.c', returnPath: '/financial-demo#matters' }), /seal matters/);
    const generic = pure._authorityGrantsText(FULL, { email: 'a@b.c', returnPath: '' });
    assert.match(generic, /authorise agents acting in your name, mint scoped authority and seal decisions/);
    assert.match(pure._authorityGrantsText(FULL, {}), /^A full-tier verified session, valid for 24 hours/, 'no email -> no dangling "for"');
});

test('TC-PP-04: grants text reads the tier from the nested server session (S126) and never crashes on a bad result', () => {
    assert.match(pure._authorityGrantsText({ session: { auth_level: 'quick' } }, {}), /^A quick-tier verified session/);
    assert.match(pure._authorityGrantsText(null, {}), /^A full-tier verified session/);
    assert.match(pure._authorityGrantsText('garbage', undefined), /^A full-tier/);
});

test('TC-PP-05: stage HTML — verifying/minting/done states render the right markers and the done sub-line carries the grants text', () => {
    const v = pure._authorityStagesHtml('verifying', '');
    assert.ok(/data-stage="verifying"[^>]*>/.test(v) && /vac-stage active" data-stage="verifying"/.test(v));
    assert.ok(/vac-stage pending" data-stage="minting"/.test(v) && /vac-stage pending" data-stage="done"/.test(v));
    assert.ok(v.includes('What it grants'), 'pending done row previews its purpose');
    const m = pure._authorityStagesHtml('minting', '');
    assert.ok(/vac-stage done" data-stage="verifying"/.test(m) && /vac-stage active" data-stage="minting"/.test(m));
    const d = pure._authorityStagesHtml('done', 'GRANTS-TEXT');
    assert.equal((d.match(/vac-stage done"/g) || []).length, 3, 'all three rows done');
    assert.ok(d.includes('GRANTS-TEXT'));
    assert.ok(!EMOJI.test(v + m + d));
});

test('TC-PP-06: finishFingerPhase clears the skeleton canvas, covers the frozen feed and renders stage 1 BEFORE "Processing"', () => {
    const i = src.indexOf('function finishFingerPhase()');
    const body = src.slice(i, i + 4000);
    const clear = body.indexOf("getElementById('handOverlay'); if (_ho && _ho.getContext) _ho.getContext('2d').clearRect(0, 0, _ho.width, _ho.height);");
    const cover = body.indexOf("getElementById('vacPostCapture'); if (_pc) _pc.style.display='flex';");
    const stage = body.indexOf("_renderAuthorityStages('verifying');");
    const processing = body.indexOf("challengeEl.textContent = 'Processing");
    assert.ok(clear > 0 && cover > 0 && stage > 0 && processing > 0, 'all four steps present');
    assert.ok(clear < cover && cover < stage && stage < processing, 'order: clear -> cover -> stage -> Processing');
});

test('TC-PP-07: the full verify success path narrates minting then done, then hands off; failure and capture-death hide the list', () => {
    const i = src.indexOf("stepEl.textContent = 'Human verified ✓';");
    const block = src.slice(i, i + 700);
    const a = block.indexOf("_renderAuthorityStages('minting')"), b = block.indexOf("_renderAuthorityStages('done', { result: authResult })"), c = block.indexOf('_finish();');
    assert.ok(a > 0 && b > a && c > b, 'minting -> done -> _finish');
    assert.ok(/function showRetry\(result\) \{\n\s*try \{ _renderAuthorityStages\('fail'\); \}/.test(src), 'showRetry hides the stages');
    assert.ok(/function _showCaptureDiedRecovery\(\) \{\n\s*try \{ _renderAuthorityStages\('fail'\); \}/.test(src), 'capture death hides the stages');
});

test('TC-PP-08: fast tier — verifying after goToStep(3); verdict renders done/fail before the modal', () => {
    assert.ok(/goToStep\(3\);\n\s*try \{ _renderAuthorityStages\('verifying'\); \}/.test(src), 'fast still-capture path');
    assert.ok(/try \{ _renderAuthorityStages\(_ok \? 'done' : 'fail', \{ result: authResult \}\); \} catch\(_\) \{\}[^\n]*\n\s*renderQuickReauthVerdict\(authResult\);/.test(src));
});

test('TC-PP-09: DOM + CSS — cover in step 2, stage list in step 3, gold #C9A227 accent, reset hides both, public display-only hook', () => {
    assert.ok(/<div id="vacPostCapture" style="display:none;position:absolute;inset:0;z-index:8;/.test(src), 'opaque cover above the skeleton canvas (z4)');
    assert.ok(/<div id="vacPostCaptureStages" class="vac-stages"/.test(src));
    assert.ok(/<div id="vacAuthorityStages" class="vac-stages" style="display:none;[^"]*"><\/div>\n\s*<div class="progress-container">/.test(src), 'stage list sits above the verify ring');
    assert.ok(/\.vac-stage\.active \.vac-stage-mark \{ border-color: #C9A227;/.test(src));
    assert.ok(/\.vac-stage-sub a \{ color: #C9A227; \}/.test(src), 'links gold');
    assert.ok(/\['vacGuided', 'vacSayView', 'digitStrip', 'vacEqGreeting', 'vacPostCapture', 'vacAuthorityStages'\]/.test(src), 'resetGuidedUI hides the cover + list');
    assert.ok(/renderAuthorityStages: function\(stage, opts\)\{ _renderAuthorityStages\(stage, opts\); \}/.test(src), 'QA hook');
    const r = extractFn('_renderAuthorityStages');
    assert.ok(/_escapeStageText\(_authorityGrantsText\(/.test(r), 'grants text is escaped before innerHTML');
    assert.ok(!/authenticated\s*=/.test(r) && !/authResult\s*=/.test(r), 'display-only: never writes the verdict');
});


test('TC-PP-10: Vault face descriptor refusal terminates the spinner, processing copy and stale finger coaching', () => {
    const nodes = new Map();
    const node = (id, extras) => Object.assign({ id, style: { display: 'block' }, textContent: '', innerHTML: '' }, extras || {});
    nodes.set('vacPostCapture', node('vacPostCapture', { style: { display: 'flex' } }));
    nodes.set('vacPostCaptureStages', node('vacPostCaptureStages'));
    nodes.set('vacAuthorityStages', node('vacAuthorityStages'));
    nodes.set('challengeText', node('challengeText', { textContent: 'Processing…' }));
    nodes.set('vacLiveDetect', node('vacLiveDetect', { textContent: 'Keep showing 5 — say “5”' }));
    nodes.set('recIndicator', node('recIndicator'));
    const parent = { insertBefore(el) { nodes.set(el.id, el); } };
    nodes.set('challengePanel', node('challengePanel', { parentElement: parent, nextSibling: null }));
    const document = {
        getElementById(id) { return nodes.get(id) || null; },
        createElement(tag) { assert.equal(tag, 'div'); return node(''); },
    };
    const renderer = Function('document', 'vacDebug', stagesConst + '\n' +
        extractFn('_authorityStagesHtml') + '\n' + extractFn('_renderAuthorityStages') +
        '\nreturn _renderAuthorityStages;')(document, () => {});
    renderer('verifying');
    assert.match(nodes.get('vacPostCaptureStages').innerHTML, /vac-stage active/);
    let reloads = 0;
    const recover = Function('document', '_renderAuthorityStages', 'vacDebug', 'VACReauth', 'retryAttempts',
        extractFn('_showVaultFaceCaptureRecovery') + '\nreturn _showVaultFaceCaptureRecovery;')(
        document, renderer, () => {}, { reload() { reloads++; } }, 1);
    recover('no_face');
    assert.equal(nodes.get('vacPostCapture').style.display, 'none', 'no verifying overlay after refusal');
    assert.equal(nodes.get('vacPostCaptureStages').innerHTML, '', 'no active spinner');
    assert.equal(nodes.get('vacAuthorityStages').innerHTML, '', 'no misleading pending authority stage');
    assert.match(nodes.get('challengeText').textContent, /not submitted/i);
    assert.equal(nodes.get('vacLiveDetect').textContent, '', 'stale finger coaching cleared');
    assert.notEqual(nodes.get('vacLiveDetect').style.display, 'none', 'reuse the coach element on in-place retries');
    assert.equal(nodes.get('recIndicator').style.display, 'none');
    assert.ok(nodes.get('vacVaultFaceCaptureRecovery'), 'restart panel remains available');
    assert.equal(reloads, 0, 'no automatic restart or bypass');
    recover('no_face');
    assert.equal(nodes.get('vacVaultFaceCaptureRecovery').id, 'vacVaultFaceCaptureRecovery');
});


test('TC-PP-11: Vault post-capture face sampling keeps the live preview moving', () => {
    // Actual three face-descriptor attempts are 350ms apart *after* the
    // recorder's 1500ms tail. Pausing the video at 1700ms freezes all but
    // the first frame, so a last-digit hand occlusion can never recover.
    const maybePause = Function(extractFn('_pausePostCapturePreview') +
        '\nreturn _pausePostCapturePreview;')();
    let pauses = 0;
    const preview = { paused: false, pause() { pauses++; this.paused = true; } };
    assert.equal(maybePause(preview, true), false, 'Vault handoff needs live face frames');
    assert.equal(pauses, 0, 'must not freeze camera before descriptor capture');
    assert.equal(maybePause(preview, false), true, 'normal non-Vault privacy pause preserved');
    assert.equal(pauses, 1);
    assert.equal(maybePause(preview, false), false, 'idempotent after pause');

    const i = src.indexOf('function finishFingerPhase()');
    const body = src.slice(i, i + 4400);
    assert.match(body, /_pausePostCapturePreview\(v, !!window\.VACVaultHandoff\)/,
        'actual timer must consult the Vault-specific guard');
    const j = src.indexOf('async function onRecordingComplete()');
    const submit = src.slice(j, j + 4200);
    assert.match(submit, /if \(window\.VACVaultHandoff && !window\.__vacEnrollEmbedding\)/,
        'no face descriptor still refuses before any network submission');
});


test('TC-PP-12: Vault pre-upload face refusal names its real non-sensitive cause', () => {
    const copy = Function(extractFn('_vaultFaceRecoveryCopy') +
        '\nreturn _vaultFaceRecoveryCopy;')();
    const noFace = copy('no_face');
    assert.match(noFace.title, /clearer capture/i);
    assert.match(noFace.hint, /centred/i);

    const many = copy('multiple_faces');
    assert.match(many.title, /more than one face/i);
    assert.doesNotMatch(many.title, /clearer capture/i);

    const timeout = copy('embed_timeout');
    assert.match(timeout.title, /timed out/i);
    assert.doesNotMatch(timeout.title + timeout.hint, /poor light|clearer capture/i);

    const engine = copy('embedder_error');
    assert.match(engine.title, /unavailable/i);
    assert.doesNotMatch(engine.title, /clearer capture/i);

    assert.match(copy('unexpected_private_error').title, /could not complete/i);
    const handler = extractFn('_showVaultFaceCaptureRecovery');
    assert.match(handler, /_vaultFaceRecoveryCopy\(reason\)/,
        'user-facing panel must use the reason-specific copy');
    assert.match(handler, /No identity check was submitted or authorised/,
        'a stopped attempt must never imply verification or a store grant');
});
