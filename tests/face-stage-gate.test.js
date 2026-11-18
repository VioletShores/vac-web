'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm');
const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','vac-reauth-ceremony.js'),'utf8');
function gate(){
  const start=src.indexOf('function _createVaultFaceStageGate(');
  assert.ok(start>=0,'face step must have an observation-driven gate, not only a countdown');
  const end=src.indexOf('\nfunction _runVaultFaceStage(',start);
  assert.ok(end>start);
  const c=vm.createContext({}); vm.runInContext(src.slice(start,end),c);
  return c._createVaultFaceStageGate(0);
}
const clear=(t)=>({frameTime:t/1000,faceVisible:true,handAbsent:true});
test('face step waits for explicit readiness, even with clear observations',()=>{
  const g=gate(); for(let t=250;t<=5000;t+=250) assert.equal(g.observe(t,clear(t)).status,'waiting');
});
test('hand present gives truthful guidance and cannot finish after the old3.2s timer',()=>{
  const g=gate();g.ready();
  for(let t=250;t<=5000;t+=250) assert.equal(g.observe(t,{...clear(t),handAbsent:false}).status,'lower_hands');
});
test('requires fresh clear observations throughout the full3.2s interval',()=>{
  const g=gate();g.ready();
  for(let t=250;t<3500;t+=250) assert.equal(g.observe(t,clear(t)).status,'hold');
  assert.equal(g.observe(3500,clear(3500)).status,'complete');
});
test('hand re-entry resets stability; no-face and unknown sensors never pass',()=>{
  const g=gate();g.ready();
  for(let t=250;t<=3000;t+=250)g.observe(t,clear(t));
  assert.equal(g.observe(3250,{...clear(3250),handAbsent:false}).status,'lower_hands');
  assert.equal(g.observe(3500,clear(3500)).status,'hold');
  assert.equal(g.observe(3750,{...clear(3750),faceVisible:false}).status,'face_missing');
  assert.equal(g.observe(4000,{...clear(4000),handAbsent:null}).status,'sensor_wait');
});
test('frozen camera cannot satisfy stability and timeout is a refusal',()=>{
  const g=gate();g.ready();g.observe(250,clear(250));
  for(let t=500;t<20000;t+=250) assert.notEqual(g.observe(t,clear(250)).status,'complete');
  assert.equal(g.observe(20000,clear(250)).status,'timeout');
});
test('a suspended sampling loop cannot count elapsed unobserved time as clear face footage',()=>{
  const g=gate();g.ready();
  for(const t of [250,500,750,5000]) assert.equal(g.observe(t,clear(t)).status,'hold');
});
test('Vault finish waits on the face stage and retains authoritative post-capture identity check',()=>{
  const start=src.indexOf('    function finishFingerPhase()');
  const end=src.indexOf('    function _refreshContentGate()',start);
  const body=src.slice(start,end);
  assert.match(body,/_runVaultFaceStage\(.*\)\.then/);
  assert.doesNotMatch(body,/const _vaultFaceTailMs = window\.VACVaultHandoff \? 3200 : 1500/);
  assert.match(src,/window\.VACVaultHandoff && !window\.__vacEnrollEmbedding/);
  assert.match(src,/const _EARLY_FACE_AUTH_ADMISSION = false/);
});
function runner() {
  let now=0,nextTimer=0,hand=-1;
  const timers=new Map(), listeners={};
  const ready={disabled:false,focus(){},addEventListener(k,v){listeners[k]=v;},removeEventListener(k){delete listeners[k];}};
  const hint={textContent:''}, recorder={state:'recording'};
  const video={paused:false,ended:false,readyState:4,videoWidth:640,videoHeight:480,currentTime:0};
  const c=vm.createContext({Promise,Error,Number,Math,window:{},mediaRecorder:recorder,
    document:{getElementById(id){return id==='vacFaceStageReady'?ready:hint;}},performance:{now:()=>now},
    setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
    FingerDetector:{ready:true,failed:false,detect(){return hand;}},
    _FaceAnchorDetector:{ready:true,failed:false,detect(){return {cx:.5};}}});
  const start=src.indexOf('function _createVaultFaceStageGate(');
  const end=src.indexOf('// DIAGNOSTIC ONLY: mean/max luminance',start);
  vm.runInContext(src.slice(start,end),c);
  const promise=c._runVaultFaceStage(video,recorder);
  return {c,promise,ready,hint,video,recorder,click(){listeners.click();},setHand(v){hand=v;},
    step(){now+=250;video.currentTime=now/1000;const fns=Array.from(timers.values());timers.clear();for(const fn of fns)fn();}};
}
test('actual stage runner waits for user and live hand absence before resolving',async()=>{
  const h=runner();let complete=false;h.promise.then(()=>{complete=true;});
  for(let i=0;i<16;i++)h.step();await Promise.resolve();assert.equal(complete,false);
  h.click();h.setHand(2);
  for(let i=0;i<16;i++)h.step();await Promise.resolve();assert.equal(complete,false);
  assert.match(h.hint.textContent,/hand is still visible/);
  h.setHand(-1);for(let i=0;i<14;i++)h.step();await h.promise;
  assert.equal(complete,true);assert.equal(h.recorder.state,'recording','runner does not independently stop or submit');
});
test('actual runner refuses replaced recorder and missing sensors',async()=>{
  const h=runner();const rejected=assert.rejects(h.promise,/face_stage_incomplete/);
  h.c.mediaRecorder={state:'recording'};h.step();await rejected;
  const missing=runner();const timeout=assert.rejects(missing.promise,/face_stage_incomplete/);
  missing.click();missing.c.FingerDetector.failed=true;
  for(let i=0;i<80;i++)missing.step();await timeout;
});
