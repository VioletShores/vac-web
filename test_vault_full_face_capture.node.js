/* Direct full ceremony function regressions. Real source, synthetic frames.
 * Run: node test_vault_full_face_capture.node.js
 * No video or biometric data, no real API calls, no claim that iPad passed.
 * These checks are mandatory in the owner handoff CI workflow.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync(require('node:path').join(__dirname, 'vac-reauth-ceremony.js'), 'utf8');

function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' missing');
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      if (!--depth) return src.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced function ' + name);
}

const start = src.indexOf('async function onRecordingComplete() {');
const end = src.indexOf('// STEP 3: Upload to backend, show real results', start);
assert.ok(start >= 0 && end > start, 'full onRecordingComplete source');
const compile = new Function(
  'document', 'recordedChunks', 'mediaRecorder', 'performance',
  'stopAudioMonitor', 'mediaStream', 'goToStep',
  '_showVaultFaceCaptureRecovery', 'runRealVerification',
  'window', 'setTimeout', 'vacDebug', '_recorderStartMs',
  '_showCaptureDiedRecovery', 'Blob', 'console',
  extractFn('_takeVaultEarlyIdentityFrame') + '\n' +
  src.slice(start, end) + ';return onRecordingComplete;'
);

// Shorten non-blocking synthetic retry delays; leave timeout callbacks
// pending/unref'ed, allowing a resolved embedding to win as in the browser.
function schedule(cb, ms) {
  // Synthetic 350ms frame-refresh delays MUST stay event-loop-referenced,
  // otherwise Node exits with code 0 before all awaited tests execute.
  // Only the unused long embedding-timeout branch may be unref'ed.
  const t = setTimeout(cb, ms >= 2500 ? ms : 0);
  if (ms >= 2500 && t && t.unref) t.unref();
  return t;
}
function V() { return Array.from({ length:128 }, () => 0.001); }

function session(responses, opts = {}) {
  const events = { compute:0, canvases:[], uploaded:0, recovery:[],
                   steps:[], stopped:0, captureAbort:0 };
  const mediaRecorder = { mimeType:'video/webm', state:'inactive' };
  const earlyFrame = { width:640, height:480, type:'same-recording-opening-frame' };
  const window = {
    VACVaultHandoff: opts.handoff === false ? null : {},
    __vacEarlyFaceCandidate: opts.early ? {
      recorder: opts.wrongRecorder ? {} : mediaRecorder,
      startedAtMs: opts.wrongEpoch ? 500 : 1000,
      ageMs: opts.futureFrame ? 5000 : 800,
      canvas: earlyFrame,
    } : null,
    VACFaceEmbed: {
      compute: async (c) => {
        events.canvases.push(c);
        return responses[Math.min(events.compute++, responses.length-1)];
      }
    }
  };
  const elements = {
    recIndicator: { style:{} },
    cameraBoxRec: { classList:{remove(){} } },
    videoPreviewRec: {videoWidth:640, videoHeight:480},
  };
  const document = {
    getElementById: k => elements[k],
    createElement: () => ({width:0,height:0,getContext:()=>({drawImage(){}})}),
  };
  const run = compile(
    document, [{size:25000}], mediaRecorder, {now:()=>4000}, () => {},
    {getTracks:()=>[{stop:()=>events.stopped++}]},
    step=>events.steps.push(step), reason=>events.recovery.push(reason),
    async()=>{events.uploaded++;},window,schedule,()=>{},1000,
    ()=>{events.captureAbort++;},
    class Blob {constructor(){this.size=25000;}},{log(){},warn(){}}
  );
  return {run,events,window,earlyFrame};
}
(async()=>{
  let t = session([{ok:false,reason:'no_face'}]);
  await t.run();
  assert.equal(t.events.compute,3, 'missing early frame uses existing three late attempts');
  assert.equal(t.events.uploaded,0);
  assert.deepEqual(t.events.recovery,['no_face']);
  assert.deepEqual(t.events.steps,[2]);

  t = session([{ok:true,embedding:V()}], {early:true});
  await t.run();
  assert.equal(t.events.compute,1, 'the recorded face-only closing frame is assessed');
  assert.notStrictEqual(t.events.canvases[0],t.earlyFrame,
      'early face must NOT authenticate until server same-person clip gate exists');
  assert.equal(t.events.uploaded,1, 'only a valid descriptor reaches existing server verification');
  assert.deepEqual(t.events.steps,[3]);
  assert.equal(t.window.__vacEarlyFaceCandidate,null, 'pixels discarded from client cache');

  t = session([{ok:false,reason:'no_face'}, {ok:true,embedding:V()}], {early:true});
  await t.run();
  assert.equal(t.events.compute,2, 'the face-only closing beat can retry fresh late frames');
  assert.equal(t.events.uploaded,1);

  t = session([{ok:false,reason:'multiple_faces'}, {ok:true,embedding:V()}], {early:true});
  await t.run();
  assert.equal(t.events.compute,1, 'do not mask multiple faces with a later clear frame');
  assert.equal(t.events.uploaded,0);
  assert.deepEqual(t.events.recovery,['multiple_faces']);

  t = session([{ok:false,reason:'no_face'}], {early:true,wrongEpoch:true});
  await t.run();
  assert.equal(t.events.compute,3, 'past recording must never supply face identity');
  assert.equal(t.events.uploaded,0);
  assert.equal(t.window.__vacEarlyFaceCandidate,null);

  t = session([{ok:false,reason:'no_face'}], {early:true,wrongRecorder:true});
  await t.run();
  assert.equal(t.events.compute,3, 'different recorder must never supply identity');
  assert.equal(t.events.uploaded,0);

  t = session([{ok:false,reason:'no_face'}], {early:true,futureFrame:true});
  await t.run();
  assert.equal(t.events.compute,3, 'late/future frame is not an opening-face candidate');

  t = session([{ok:true,embedding:V()}], {early:true,handoff:false});
  await t.run();
  assert.notStrictEqual(t.events.canvases[0],t.earlyFrame,
      'existing non-Vault full ceremony continues its original post-capture path');
  assert.equal(t.events.uploaded,1);

  t = session([{ok:true,embedding:V().slice(0,127)}], {early:true});
  await t.run();
  assert.equal(t.events.uploaded,0, 'malformed 127D face cannot be used');
  assert.deepEqual(t.events.recovery,['embedder_error']);

  console.log('Vault late face-only closing gate (early identity held): 9 synthetic source-function cases passed');
})().catch(e=>{console.error(e); process.exitCode=1;});
