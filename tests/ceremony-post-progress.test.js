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
    const cover = body.indexOf("getElementById('vacPostCapture'); if (_pc) _pc.style.display = window.VACVaultHandoff ? 'none' : 'flex';");
    const stage = body.indexOf("_renderAuthorityStages('verifying');");
    const processing = body.indexOf('challengeEl.textContent = window.VACVaultHandoff');
    assert.ok(clear > 0 && cover > 0 && stage > 0 && processing > 0, 'all four steps present');
    assert.ok(clear < cover && cover < stage && stage < processing, 'order: clear -> choose cover -> stage for normal -> closing face instruction for Vault');
});

test('TC-PP-07: the full verify success path narrates minting then done, then hands off; failure and capture-death hide the list', () => {
    const i = src.indexOf("stepEl.textContent = 'Human verified ✓';");
    const block = src.slice(i, i + 700);
    const a = block.indexOf("_renderAuthorityStages('minting')"), b = block.indexOf("_renderAuthorityStages('done', { result: authResult })"), c = block.indexOf('_finish();');
    assert.ok(a > 0 && b > a && c > b, 'minting -> done -> _finish');
    assert.ok(/function showRetry\(result\) \{\n\s*try \{ _renderAuthorityStages\('fail'\); \}/.test(src), 'showRetry hides the stages');
    assert.ok(/function _showCaptureDiedRecovery\(\) \{[\s\S]{0,800}?try \{ _renderAuthorityStages\('fail'\); \}/.test(src), 'capture death hides the stages');
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
        extractFn('_vaultFaceRecoveryCopy') + '\n' + extractFn('_vaultFaceEvidenceHtml') + '\n' +
        extractFn('_showVaultFaceCaptureRecovery') +
        '\nreturn _showVaultFaceCaptureRecovery;')(
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
    const submit = src.slice(j, src.indexOf('// STEP 3: Upload to backend, show real results', j));
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


test('TC-PP-13: early face candidate is live-recording-bound, single-use, and Vault-only', () => {
    const w = { VACVaultHandoff: {} };
    const active = { state: 'recording' };
    const other = { state: 'recording' };
    const still = { width: 640, height: 480 };
    const guards = Function('window', 'mediaRecorder', '_recorderStartMs',
        extractFn('_recordVaultEarlyIdentityFrame') + '\n' +
        extractFn('_takeVaultEarlyIdentityFrame') + '\n' +
        'return {record:_recordVaultEarlyIdentityFrame, take:_takeVaultEarlyIdentityFrame};')(
        w, active, 1000);
    assert.equal(guards.record(other, 1800, still), false, 'never accept another recorder');
    assert.equal(guards.record(active, 800, still), false, 'never take a pre-recording frame');
    assert.equal(guards.record(active, 6500, still), false, 'never take a late gesture frame');
    assert.equal(guards.record(active, 1800, still), true, 'one early frame during actual recording');
    assert.equal(guards.take(other, 1000, 6500), null, 'wrong recorder must not reuse early face');
    assert.equal(guards.take(active, 1000, 6500), null, 'mismatch consumes the candidate');
    assert.equal(guards.record(active, 1900, still), true);
    assert.equal(guards.take(active, 900, 6500), null, 'different recording epoch must refuse');
    assert.equal(guards.record(active, 1950, still), true);
    assert.equal(guards.take(active, 1000, 6500), still, 'same recording can consume one fresh frame');
    assert.equal(guards.take(active, 1000, 6500), null, 'no cross-attempt replay');
    active.state = 'inactive';
    assert.equal(guards.record(active, 2000, still), false, 'no post-recording capture');
    active.state = 'recording';
    w.VACVaultHandoff = null;
    assert.equal(guards.record(active, 2000, still), false, 'other VAC journeys unchanged');
});

test('TC-PP-14: early face is sampled from the SAME early liveness canvas, and server gate stays', () => {
    const early = src.slice(src.indexOf('const FACE_STILL_DELAY_MS = 800'), src.indexOf('// Show combined capture info'));
    assert.match(early, /_recordVaultEarlyIdentityFrame\(_boundIdentityRecorder, performance\.now\(\), c\)/,
        'the face candidate must be the already recorded 800ms liveness still, not a separate webcam');
    const final = src.slice(src.indexOf('async function onRecordingComplete()'),
        src.indexOf('// STEP 3: Upload to backend, show real results'));
    assert.match(final, /_takeVaultEarlyIdentityFrame\(\s*mediaRecorder, _recorderStartMs, _clipElapsed\)/,
        'must validate recorder and recording epoch before using saved frame');
    assert.match(final, /window\.VACFaceEmbed\.compute\(_earlyCanvas\)/,
        'early frame must pass the SAME identity model');
    assert.match(final, /if \(window\.VACVaultHandoff && !window\.__vacEnrollEmbedding\)/,
        'no valid identity descriptor remains a hard pre-upload refusal');
    assert.match(src, /formData\.append\('face_embedding', JSON\.stringify\(window\.__vacEnrollEmbedding\)\)/,
        'server still receives an identity vector for its existing continuity check');
    assert.match(src, /await runRealVerification\(videoBlob\)/,
        'full video verification remains obligatory');
});


test('TC-PP-15: Vault keeps a recorded face-only closing window; unbound early frames cannot authenticate', () => {
    const finish = src.slice(src.indexOf('function finishFingerPhase()'),
        src.indexOf('// ── F-561 voice-pacing gate', src.indexOf('function finishFingerPhase()')));
    assert.match(finish, /const _vaultFaceTailMs = window\.VACVaultHandoff \? 3200 : 1500;/,
        'Vault must film a separate natural face-only closing beat, not rely on the last digit');
    assert.match(finish, /Face check — lower your hand and look at the screen/,
        'instruction never asks the owner to pose precisely while holding fingers');
    assert.match(finish, /_pc\.style\.display\s*=\s*window\.VACVaultHandoff \? 'none' : 'flex'/,
        'face preview stays visible during the dedicated closing beat');
    assert.match(finish, /setTimeout\(function\(\) \{ try \{ mediaRecorder\.stop\(\); \} catch\(_\)\{\} \}, _vaultFaceTailMs\)/,
        'same original full-video recorder includes the face-only closing beat');
    const finishFull = src.slice(src.indexOf('async function onRecordingComplete()'),
        src.indexOf('// STEP 3: Upload to backend, show real results'));
    assert.match(finishFull, /const _EARLY_FACE_AUTH_ADMISSION = false;/,
        'early ID must be disabled until independently reviewed same-actor backend binding exists');
    assert.match(finishFull, /if \(_EARLY_FACE_AUTH_ADMISSION && _earlyCanvas/,
        'a stored earlier frame alone is never enough to grant identity');
    assert.match(finishFull, /if \(window\.VACVaultHandoff && !window\.__vacEnrollEmbedding\)/,
        'missing accepted post-gesture identity still refuses before any POST');
});


test('TC-PP-16: Vault accurately discloses continuing final face recording until recorder stops', () => {
    const finish = src.slice(src.indexOf('function finishFingerPhase()'),
        src.indexOf('// ── F-561 voice-pacing gate', src.indexOf('function finishFingerPhase()')));
    assert.match(finish, /recording final face check/, 'Vault face-only beat must say recording, not analysing');
    assert.match(finish, /if \(!window\.VACVaultHandoff\)\s*\{\s*try \{ document\.querySelectorAll\('\.rec-dot'\)/,
        'Vault recording indicator must remain visible during its 3.2s tail');
    assert.match(finish, /window\.VACVaultHandoff \? 3400 : 1700/,
        'Vault preview cannot freeze before the 3.2s recording tail ends');
    const complete = src.slice(src.indexOf('async function onRecordingComplete()'),
        src.indexOf('// STEP 3: Upload to backend, show real results'));
    assert.match(complete, /document\.querySelectorAll\('\.rec-dot'\)/,
        'Vault recording indicators are hidden after actual recorder completion');
    assert.match(complete, /Analysing your recording/, 'analysis message starts only after recorder completion');
    const died = src.slice(src.indexOf('function _showCaptureDiedRecovery()'),
        src.indexOf('function _showCaptureDiedRecovery()') + 700);
    assert.match(died, /recIndicator/, 'abnormal recorder stop must clear REC indicator');
});


test('TC-PP-17: a frame with no camera picture is named as such, never as an engine timeout', () => {
    const copy = Function(extractFn('_vaultFaceRecoveryCopy') +
        '\nreturn _vaultFaceRecoveryCopy;')();
    const none = copy('no_camera_picture');
    assert.match(none.title, /no camera picture/i);
    assert.match(none.hint, /check camera permission or use a device with a camera/i);
    assert.doesNotMatch(none.title + none.hint, /timed out|engine/i);

    // The blank-frame probe: near-black frames are "no picture"; any real
    // brightness, or a read error, is not (a real frame is never misreported).
    function fakeCanvas(lum) {
        return { getContext: () => ({ drawImage() {}, getImageData: (x, y, w, h) => {
            const d = new Uint8ClampedArray(w * h * 4);
            for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = lum; d[i + 3] = 255; }
            return { data: d };
        } }) };
    }
    const doc = { createElement: () => fakeCanvas(globalThis.__lum) };
    const probe = Function('document', extractFn('_vacFrameHasNoPicture') +
        '\nreturn _vacFrameHasNoPicture;')(doc);
    globalThis.__lum = 0;   assert.equal(probe({}), true);
    globalThis.__lum = 8;   assert.equal(probe({}), true);
    globalThis.__lum = 40;  assert.equal(probe({}), false);
    const broken = Function('document', extractFn('_vacFrameHasNoPicture') +
        '\nreturn _vacFrameHasNoPicture;')({ createElement: () => { throw new Error('x'); } });
    assert.equal(broken({}), false);

    // The probe runs before compute() and still ends in the pre-upload refusal.
    const j = src.indexOf('async function onRecordingComplete()');
    const submit = src.slice(j, src.indexOf('// STEP 3: Upload to backend, show real results', j));
    assert.match(submit, /if \(_vacFrameHasNoPicture\(ec\)\) \{ _fullEmbedReason = 'no_camera_picture'; _faceEvidence\.push\(\{ reason: 'no_camera_picture', luma: _luma \}\); break; \}/);
    assert.ok(submit.indexOf('_vacFrameHasNoPicture(ec)') < submit.indexOf('window.VACFaceEmbed.compute(ec)'));
});

test('TC-PP-18: the face engine warms every net once during load (first capture runs warm)', () => {
    const emb = require('fs').readFileSync(require('path').join(__dirname, '..', 'vac-face-embed.js'), 'utf8');
    const load = emb.slice(emb.indexOf('function _load()'), emb.indexOf('async function compute('));
    const iRec = load.indexOf('faceRecognitionNet.loadFromUri');
    const iReady = load.indexOf('_ready = true');
    for (const call of ['detectAllFaces(_wc', 'detectFaceLandmarks(_wc)', 'computeFaceDescriptor(_wc)']) {
        const k = load.indexOf(call);
        assert.ok(k > iRec && k < iReady, call + ' must run after the models load and before ready');
    }
    // Warm-up errors are swallowed; compute() keeps its own fail-closed contract.
    assert.match(emb, /return \{ ok: false, faceCount: -1, reason: 'embedder_error' \}/);
});


test('TC-PP-19: a refused Vault face check says which check failed and why (no pixels, no identity data)', () => {
    const html = Function(extractFn('_vaultFaceEvidenceHtml') + '\nreturn _vaultFaceEvidenceHtml;')()([
        { reason: 'no_face', faces: 0, best_score: 0.31, min_confidence: 0.5, luma: { mean: 102, max: 240 } },
        { reason: 'no_face', faces: 0, best_score: null, min_confidence: 0.5, luma: { mean: 20, max: 60 } },
        { reason: 'no_camera_picture', luma: { mean: 0, max: 3 } },
    ]);
    assert.match(html, /Failed check: face identification, on this device, before upload/);
    assert.match(html, /Frame 1: brightness 40% · faces found 0 · best face score 0\.31 \(needs 0\.50\)/);
    assert.match(html, /Frame 2: brightness 8% · faces found 0 · no face-like shape seen \(needs score 0\.50\)/);
    assert.match(html, /Frame 3: brightness 0% · no camera picture/);
    assert.equal(Function(extractFn('_vaultFaceEvidenceHtml') + '\nreturn _vaultFaceEvidenceHtml;')()([]), '');
    const rec = extractFn('_showVaultFaceCaptureRecovery');
    assert.match(rec, /_vaultFaceEvidenceHtml\(evidence\)/, 'evidence is rendered in the refusal panel');
    assert.match(rec, /getElementById\('vacStepVU'\)[^;]*;\s*if \(_svr\) _svr\.remove\(\)/, 'voice meter never drawn over the refusal');
});

test('TC-PP-20: the step voice meter ends with the capture and shows raw numbers only with ?qa=1', () => {
    const finish = src.slice(src.indexOf('function finishFingerPhase()'),
        src.indexOf('// ── F-561 voice-pacing gate', src.indexOf('function finishFingerPhase()')));
    assert.match(finish, /window\.__vacGateArmed = false; var _svf = document\.getElementById\('vacStepVU'\); if \(_svf\) _svf\.remove\(\);/);
    assert.match(src, /if \(_st\) _st\.textContent = \(typeof _qaFlag !== 'undefined' && _qaFlag\) \? \(rms\.toFixed\(2\)/,
        'level/threshold readout is a developer-only overlay');
});

test('TC-PP-21: face-engine diagnostics never change the identity decision', () => {
    const fe = fs.readFileSync(path.join(__dirname, '..', 'vac-face-embed.js'), 'utf8');
    assert.match(fe, /var MIN_DETECT_CONFIDENCE = 0\.5;/, 'detector threshold unchanged');
    const compute = fe.slice(fe.indexOf('async function compute(input)'), fe.indexOf('function euclidean('));
    assert.match(compute, /detectAllFaces\(input, opts\)\.withFaceLandmarks\(\)\.withFaceDescriptors\(\)/, 'decision still from the 0.5 detector');
    const probeAt = compute.indexOf('DIAG_PROBE_CONFIDENCE');
    const noFaceReturn = compute.indexOf("reason: 'no_face',", probeAt);
    assert.ok(probeAt > 0 && noFaceReturn > probeAt, 'low-threshold probe only inside the no-face branch');
    assert.ok(!/withFaceDescriptors/.test(compute.slice(probeAt, noFaceReturn)), 'probe never builds a descriptor');
    assert.ok(!/ok: true/.test(compute.slice(probeAt, noFaceReturn)), 'probe can never accept a face');
    assert.match(fe, /var DIAG_PROBE_BUDGET_MS = 1200;/, 'probe is time-bounded');
    assert.match(compute, /Promise\.race\(\[\s*_faceapi\.detectAllFaces\(input, new _faceapi\.SsdMobilenetv1Options\(\{ minConfidence: DIAG_PROBE_CONFIDENCE \}\)\)/,
        'a slow probe cannot turn a no_face refusal into a timeout');
});


test('TC-PP-22: the Vault face check is a full stage with a visible 3-2-1 countdown, presentation only', () => {
    const finish = src.slice(src.indexOf('function finishFingerPhase()'),
        src.indexOf('// ── F-561 voice-pacing gate', src.indexOf('function finishFingerPhase()')));
    assert.match(finish, /if \(window\.VACVaultHandoff\) \{ try \{ _vacFaceStageShow\(\); \} catch\(_\) \{\} \}/);
    assert.match(finish, /const _vaultFaceTailMs = window\.VACVaultHandoff \? 3200 : 1500;/, 'filmed face-only tail timing unchanged');
    const nodes = new Map(); const timers = [];
    const box = { children: [], appendChild(n) { this.children.push(n); nodes.set(n.id, n); } };
    nodes.set('cameraBoxRec', box);
    const count = { textContent: '' };
    const document = {
        getElementById: id => nodes.get(id) || null,
        createElement: () => ({ id: '', style: {}, setAttribute() {}, set innerHTML(h) { this._h = h; count.textContent = '3'; },
            get innerHTML() { return this._h; }, querySelector: () => count, remove() { nodes.delete(this.id); } }),
    };
    const window = {};
    const [show, hide] = Function('document', 'window', 'setTimeout', 'clearTimeout',
        extractFn('_vacFaceStageShow') + '\n' + extractFn('_vacFaceStageHide') + '\nreturn [_vacFaceStageShow, _vacFaceStageHide];')(
        document, window, (f, ms) => { timers.push([ms, f]); return timers.length; }, () => {});
    assert.equal(show(), true);
    const stage = nodes.get('vacFaceStage');
    assert.ok(stage, 'stage mounted in the camera box');
    assert.match(stage.innerHTML, /FACE CHECK/);
    assert.match(stage.innerHTML, /Lower your hand and look at the screen/);
    assert.equal(count.textContent, '3');
    assert.deepEqual(timers.map(t => t[0]), [1000, 2000, 3000], 'countdown spans the 3.2 s filmed tail');
    timers.forEach(t => t[1]());
    assert.equal(count.textContent, '\u2713');
    hide();
    assert.equal(nodes.get('vacFaceStage'), undefined, 'removed before analysis / refusal');
    assert.match(src.slice(src.indexOf('async function onRecordingComplete()'), src.indexOf('async function onRecordingComplete()') + 2600), /_vacFaceStageHide\(\)/);
    assert.match(extractFn('_showVaultFaceCaptureRecovery'), /_vacFaceStageHide\(\)/);
});
