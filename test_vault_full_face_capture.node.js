/* Node regression — run: node test_vault_full_face_capture.node.js
 * Exercise the actual onRecordingComplete() function with DOM/camera mocks.
 * No biometric images or API requests. Fail closed for Vault handoff only.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync(require('node:path').join(__dirname, 'vac-reauth-ceremony.js'), 'utf8');
const a = src.indexOf('async function onRecordingComplete() {');
const b = src.indexOf('// STEP 3: Upload to backend, show real results', a);
assert.ok(a >= 0 && b > a, 'extract full capture function');
const compile = new Function(
  'document','recordedChunks','mediaRecorder','performance','stopAudioMonitor',
  'mediaStream','goToStep','_showVaultFaceCaptureRecovery','runRealVerification',
  'window','setTimeout','vacDebug','_recorderStartMs','_showCaptureDiedRecovery',
  'Blob','console', src.slice(a,b) + ';return onRecordingComplete');

function session(responses, handoff = true) {
  const events = { compute:0, uploaded:0, recovery:[], steps:[], stopped:0 };
  const elements = {
    recIndicator:{style:{}},
    cameraBoxRec:{classList:{remove(){}}},
    videoPreviewRec:{videoWidth:640,videoHeight:480}
  };
  const document = {
    getElementById:k=>elements[k],
    createElement:()=>({getContext:()=>({drawImage(){}})})
  };
  const window = {
    VACVaultHandoff:handoff ? {} : null,
    VACFaceEmbed:{
      compute: async()=>responses[Math.min(events.compute++,responses.length-1)]
    }
  };
  const run = compile(
    document,[{size:25000}],{mimeType:'video/webm'},{now:()=>4000},()=>{},
    {getTracks:()=>[{stop:()=>events.stopped++}]},
    step=>events.steps.push(step),reason=>events.recovery.push(reason),
    async()=>{events.uploaded++},window,setTimeout,()=>{},1000,()=>{},
    class Blob { constructor(){this.size=25000;} },{log(){},warn(){}});
  return {run,events};
}
(async()=>{
  let t = session([{ok:false,reason:'no_face'}]);
  await t.run();
  assert.equal(t.events.compute,3);
  assert.equal(t.events.uploaded,0);
  assert.deepEqual(t.events.recovery,['no_face']);
  assert.deepEqual(t.events.steps,[2]);

  t = session([{ok:false,reason:'multiple_faces'}]);
  await t.run();
  assert.equal(t.events.compute,1);
  assert.equal(t.events.uploaded,0);
  assert.deepEqual(t.events.recovery,['multiple_faces']);

  t = session([{ok:true,embedding:Array.from({length:128},()=>0.001)}]);
  await t.run();
  assert.equal(t.events.compute,1);
  assert.equal(t.events.uploaded,1);
  assert.deepEqual(t.events.recovery,[]);
  assert.deepEqual(t.events.steps,[3]);

  // Outside handoff, legacy full-enrolment behaviour is unchanged.
  t = session([{ok:false,reason:'no_face'}], false);
  await t.run();
  assert.equal(t.events.uploaded,1);

  console.log('Vault full face-capture gate: 4 regression cases passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
