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
