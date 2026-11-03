/* Node regression — run: node test_identity_frame.node.js
 * VAC capture-frame fix (athena lane vac-ceremony, 4 Nov 2026).
 *
 * The FULL ceremony computed the 128-D identity descriptor from the LAST frame
 * of the recording: the finger-gesture tail (hand raised for the final digit,
 * eyes on the on-screen prompt). That same descriptor is stored as the owner's
 * re-auth template on a pass and is compared (server-side, euclidean,
 * threshold unchanged) against the existing template on every later full auth.
 * The quick re-auth path, by contrast, uses a face-forward <=640 still.
 *
 * Fix: the descriptor is computed FIRST from the face-forward bound still that
 * captureBoundStill() already grabs ~800 ms into the read-the-phrase phase (the
 * same pixels sent as face_still_b64 for liveness). The tail frames remain only
 * as a fallback when that still has no face. Single-face enforcement, the
 * fail-closed Vault gate, and every server threshold are unchanged.
 *
 * Exercises the real source functions with DOM/camera mocks. No biometric
 * images, no network.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, 'vac-reauth-ceremony.js'), 'utf8');

// ── onRecordingComplete (same extraction as test_vault_full_face_capture) ──
const a = src.indexOf('async function onRecordingComplete() {');
const b = src.indexOf('// STEP 3: Upload to backend, show real results', a);
assert.ok(a >= 0 && b > a, 'extract full capture function');
const compileComplete = new Function(
  'document','recordedChunks','mediaRecorder','performance','stopAudioMonitor',
  'mediaStream','goToStep','_showVaultFaceCaptureRecovery','runRealVerification',
  'window','setTimeout','vacDebug','_recorderStartMs','_showCaptureDiedRecovery',
  'Blob','console', src.slice(a, b) + ';return onRecordingComplete');

const EMB_FRAME = Array.from({length: 128}, () => 0.002);
const EMB_LIVE = Array.from({length: 128}, () => 0.009);

function session(opts) {
  const events = { inputs: [], liveGrabs: 0, uploaded: 0, recovery: [], steps: [] };
  const identityFrame = { tag: 'face-forward-bound-still' };
  const elements = {
    recIndicator: {style: {}},
    cameraBoxRec: {classList: {remove() {}}},
    videoPreviewRec: {videoWidth: 640, videoHeight: 480},
  };
  const document = {
    getElementById: k => elements[k],
    createElement: () => {
      const c = { tag: 'live-tail-frame', getContext: () => ({ drawImage() { events.liveGrabs++; } }) };
      return c;
    },
  };
  const window = {
    VACVaultHandoff: opts.handoff === false ? null : {},
    __vacIdentityFrame: opts.noFrame ? null : identityFrame,
    VACFaceEmbed: {
      compute: async (input) => {
        events.inputs.push(input && input.tag);
        const r = opts.responses[Math.min(events.inputs.length - 1, opts.responses.length - 1)];
        return typeof r === 'function' ? r(input) : r;
      },
    },
  };
  const run = compileComplete(
    document, [{size: 25000}], {mimeType: 'video/webm'}, {now: () => 4000}, () => {},
    {getTracks: () => [{stop() {}}]},
    step => events.steps.push(step), reason => events.recovery.push(reason),
    async () => { events.uploaded++; }, window, setTimeout, () => {}, 1000, () => {},
    class Blob { constructor() { this.size = 25000; } }, {log() {}, warn() {}});
  return { run, events, window };
}

// ── captureBoundStill (extracted by brace matching from the real source) ──
function extractFunction(source, header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, 'missing ' + header);
  let i = source.indexOf('{', start), depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  return source.slice(start, i + 1);
}

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

test('descriptor comes from the face-forward bound still, not the gesture-tail frame', async () => {
  const t = session({ responses: [{ok: true, embedding: EMB_FRAME}] });
  await t.run();
  assert.deepEqual(t.events.inputs, ['face-forward-bound-still']);
  assert.equal(t.events.liveGrabs, 0, 'no tail frame was needed');
  assert.equal(t.window.__vacEnrollEmbedding, EMB_FRAME);
  assert.equal(t.events.uploaded, 1);
  assert.deepEqual(t.events.steps, [3]);
});

test('bound still with no face falls back to fresh tail frames (bounded)', async () => {
  const t = session({ responses: [
    {ok: false, faceCount: 0, reason: 'no_face'},
    {ok: true, embedding: EMB_LIVE},
  ] });
  await t.run();
  assert.deepEqual(t.events.inputs, ['face-forward-bound-still', 'live-tail-frame']);
  assert.equal(t.window.__vacEnrollEmbedding, EMB_LIVE);
  assert.equal(t.events.uploaded, 1);
});

test('two faces in the bound still fails closed at once (no fallback hunt for a cleaner frame)', async () => {
  const t = session({ responses: [{ok: false, faceCount: 2, reason: 'multiple_faces'}] });
  await t.run();
  assert.deepEqual(t.events.inputs, ['face-forward-bound-still']);
  assert.equal(t.events.uploaded, 0);
  assert.deepEqual(t.events.recovery, ['multiple_faces']);
});

test('no face anywhere still blocks the Vault handoff submit (eabeabe gate intact)', async () => {
  const t = session({ responses: [{ok: false, faceCount: 0, reason: 'no_face'}] });
  await t.run();
  assert.equal(t.events.inputs.length, 4, '1 bound still + 3 tail frames');
  assert.equal(t.events.uploaded, 0);
  assert.deepEqual(t.events.recovery, ['no_face']);
});

test('the retained frame is released after use (no biometric frame lingers)', async () => {
  const t = session({ responses: [{ok: true, embedding: EMB_FRAME}] });
  await t.run();
  assert.equal(t.window.__vacIdentityFrame, null);
});

test('captureBoundStill retains the exact canvas it encoded as face_still_b64', () => {
  const body = extractFunction(src, 'function captureBoundStill()');
  const fn = new Function('mediaRecorder', 'document', 'window', 'performance', '__recStartMs', 'console',
    'return (' + body + ')');
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage() {} }),
    toDataURL: () => 'data:image/jpeg;base64,QUJD',
  };
  const window = { __vacIdentityFrame: null };
  const run = fn({state: 'recording'},
    { getElementById: () => ({videoWidth: 1280, videoHeight: 960}), createElement: () => canvas },
    window, {now: () => 900}, 100, {log() {}, warn() {}});
  run();
  assert.equal(window.__vacFaceStillB64, 'QUJD');
  assert.equal(window.__vacIdentityFrame, canvas, 'identity descriptor source == liveness still pixels');
  assert.equal(canvas.width, 640);
});

test('a stale frame from a previous attempt is cleared when a new recording starts', () => {
  // The reset sits with the face_still reset, right before the bound-still timer is armed.
  const rs = src.indexOf('const FACE_STILL_DELAY_MS');
  assert.ok(rs > 0, 'recording-start reset block');
  const block = src.slice(src.lastIndexOf('const __recStartMs', rs), rs);
  assert.match(block, /window\.__vacFaceStillB64 = '';/);
  assert.match(block, /window\.__vacIdentityFrame = null;/);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log('ok   - ' + name); }
    catch (e) { failed++; console.log('FAIL - ' + name + '\n       ' + (e && e.message)); }
  }
  console.log(`identity-frame: ${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exitCode = 1;
})();
