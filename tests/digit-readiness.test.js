'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'vac-reauth-ceremony.js'), 'utf8');
function section(start, end) { return src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start))); }
function harness() {
  let now = 100;
  const instances = [];
  class Recognition {
    constructor() { instances.push(this); this.aborted = false; }
    start() {}
    abort() { this.aborted = true; }
    serviceReady() { if (this.onstart) this.onstart(); }
    audioReady() { if (this.onaudiostart) this.onaudiostart(); }
    audioEnd() { if (this.onaudioend) this.onaudioend(); }
    ready() { this.serviceReady(); this.audioReady(); }
    result(text) {
      const result = [{transcript:text, confidence:1}]; result.isFinal = true;
      this.onresult({resultIndex:0, results:[result]});
    }
  }
  const c = vm.createContext({window:{SpeechRecognition:Recognition}, performance:{now:()=>now}, vacDebug:()=>{},
    _contentTranscriptHasDigit:(t,d)=>String(t)===String(d), NO_MATCH_FALLBACK_MS:4000, CONTENT_GATE_LOW_CONF_THR:0.5});
  vm.runInContext(`var recordingStopped=false, _speechMode='vad', _contentGate=null, _contentGateDigit=-1;
    var currentDigitIndex=0, digits=[2,3,3], speechReady=[false,false,false], _sessionGateAvail=true;
    var speechWindowStart=200, _vadEnergyDetected=false, _lastVbRatio=0, VOICE_BAND_MIN_RATIO=.45;
    var _voiceFiredAt=0, _acceptArmed=false, _contentReadyDigit=-1, _contentGateGeneration=0;
    var _digitVoiceEvidence=null, _digitGestureEvidence=null, _provisionalSpeech=[false,false,false];
    var _voiceOnsetAt=0, DIGIT_VOICE_MIN_MS=200;`, c);
  vm.runInContext(section('function _startDigitContentGate(', '// Starts a content gate for the greeting phrase.'), c);
  vm.runInContext(section('    function _refreshContentGate()', '    function _startSpeechGate()'), c);
  vm.runInContext('var CaptureFeedback = {' + section('    coachHintMsg: function(', '    // Render finger-phase UI') + '};', c);
  vm.runInContext('var DIGIT_COOCCUR_MS=700, DIGIT_COOCCUR_MAX_MS=2000;' + section('function _cooccurAdvanceDecision(', '// S155 POSITIVE-EVIDENCE FLOOR'), c);
  const els = new Map();
  function byId(id) {
    if (!els.has(id)) els.set(id, {textContent:'', style:{}, querySelector(){return null;}});
    return els.get(id);
  }
  c.captureCtx = {byId};
  function render() {
    vm.runInContext(`CaptureFeedback.renderGuided(captureCtx, {
      digit:digits[currentDigitIndex], voiceOn:true, handNear:true, gestureLive:true,
      voiceDone:speechReady[currentDigitIndex],
      voicePreparing:_contentReadyDigit !== currentDigitIndex && !speechReady[currentDigitIndex]
    });`, c);
    return {prompt:byId('vacGuidedPrompt').textContent, number:byId('vacGuidedNumber')};
  }
  // Execute the actual full-path VAD-qualified branch, after its unchanged floor
  // predicate has fired. This includes the real proof-recording call, not a fake
  // implementation of the new empty-transcript acceptance callback.
  const fireAt=src.indexOf("_vadDiag('FIRED: '", src.indexOf('    function _startSpeechGate()'));
  const branchAt=src.indexOf('if (_sessionGateAvail)',fireAt);
  const qualifiedBranch=src.slice(branchAt,src.indexOf('voiced = 0;',branchAt));
  function gesture(at,live=true) {
    vm.runInContext(`_digitGestureEvidence={digitIndex:currentDigitIndex,at:${at},live:${live}}`,c);
  }
  function voice(at,duration=236,rms=.237) {
    now=at;
    vm.runInContext(`var _now=${at}, rms=${rms}; _voiceOnsetAt=${at-duration};`+qualifiedBranch,c);
  }
  function advance() {return vm.runInContext(`_cooccurAdvanceDecision({speechMode:_speechMode,
    voiceArmed:speechReady[currentDigitIndex],voiceFiredAt:_voiceFiredAt,
    liveGestureOk:true,now:performance.now(),handDown:false,escapePending:false}).advance`,c);}
  return {c, instances, render, gesture, voice, advance, time(t){now=t;}, run(s){return vm.runInContext(s,c);}};
}
test('does not start digit recognition during grace or prior-digit confirmation',()=>{
  const h=harness(); h.run('_refreshContentGate()');
  assert.equal(h.instances.length,0);
  h.time(200); h.run('_refreshContentGate()'); assert.equal(h.instances.length,1);
});
test('first ready in-window number counts once; repeated digit still needs new recognition',()=>{
  const h=harness(); h.time(200); h.run('_refreshContentGate()');
  const rec=h.instances[0]; rec.ready(); rec.result('2');
  assert.equal(h.c.speechReady[0],true); assert.equal(rec.aborted,true);
  h.run('currentDigitIndex=1; speechWindowStart=400; _voiceFiredAt=0; _refreshContentGate()');
  assert.equal(h.instances.length,1); rec.result('3'); assert.equal(h.c.speechReady[1],false);
  h.time(400); h.run('_refreshContentGate()'); h.instances[1].ready(); h.instances[1].result('3');
  assert.equal(h.c.speechReady[1],true);
  h.run('currentDigitIndex=2; speechWindowStart=600; _voiceFiredAt=0; _refreshContentGate()');
  h.time(600); h.run('_refreshContentGate()'); h.instances[2].ready(); h.instances[2].result('3');
  assert.deepEqual(Array.from(h.c.speechReady),[true,true,true]);
});
test('rejected callback does not consume recognizer or cache early content for later',()=>{
  const h=harness(); h.run('var accepted=false; var count=0; var gate=_startDigitContentGate(2, function(){ if(!accepted) return false; count++; return true; });');
  const rec=h.instances[0]; rec.ready(); rec.result('2'); assert.equal(rec.aborted,false);
  h.run('accepted=true'); assert.equal(h.c.count,0);
  rec.result('2'); assert.equal(h.c.count,1); assert.equal(rec.aborted,true);
});
test('wrong content and stale callback cannot satisfy current digit',()=>{
  const h=harness(); h.time(200); h.run('_refreshContentGate()');
  const rec=h.instances[0]; rec.ready(); rec.result('5'); assert.equal(h.c.speechReady[0],false);
  h.run('currentDigitIndex=1; speechWindowStart=200'); rec.result('2');
  assert.equal(h.c.speechReady[1],false);
});
test('readiness begins after service and audio capture start, not recognizer construction',()=>{
  const h=harness(); h.time(200); h.run('_refreshContentGate()');
  assert.equal(h.c._contentReadyDigit,-1); h.instances[0].ready(); assert.equal(h.c._contentReadyDigit,0);
});
test('retired same-digit recognizer cannot clear new readiness or disable its provider',()=>{
  const h=harness(); h.time(200); h.run('_refreshContentGate()');
  const old=h.instances[0];old.ready();old.result('2');
  h.time(3000);h.run('speechReady[0]=false; _refreshContentGate()');
  const current=h.instances[1];current.ready();assert.equal(h.c._contentReadyDigit,0);
  old.onend();assert.equal(h.c._contentReadyDigit,0);
  old.onerror({error:'network'});assert.equal(h.c._sessionGateAvail,true);
  assert.equal(h.c._contentGateDigit,0);current.result('2');assert.equal(h.c.speechReady[0],true);
});

test('each digit stays hidden after service start until microphone capture really starts',()=>{
  const h=harness(); h.run('digits=[5,2,4]');
  for (let i=0; i<3; i++) {
    h.time(200+i*10000);
    h.run(`currentDigitIndex=${i}; speechWindowStart=${200+i*10000}; _voiceFiredAt=0; _refreshContentGate()`);
    const rec=h.instances[i];
    rec.serviceReady();
    const waiting=h.render();
    assert.equal(waiting.number.style.display,'none',`digit ${i}: service start is not capture readiness`);
    assert.equal(waiting.prompt,'Preparing microphone');
    // Empty first-final results were observed on all three digits of the reported run.
    // They must never become permission to accept speech or reveal an uncaptured prompt.
    rec.result('');
    assert.equal(h.c.speechReady[i],false);
    assert.equal(h.render().number.style.display,'none');
    rec.audioReady();
    assert.equal(h.render().number.style.display,'block');
    assert.match(h.render().prompt,new RegExp('Show '+h.c.digits[i]+' and say'));
    rec.result(String(h.c.digits[i])); // one actual matching utterance; no repeat required
    assert.equal(h.c.speechReady[i],true);
    assert.equal(h.run(`_cooccurAdvanceDecision({speechMode:_speechMode,
      voiceArmed:speechReady[currentDigitIndex],voiceFiredAt:_voiceFiredAt,
      liveGestureOk:true,now:performance.now(),handDown:false,escapePending:false}).advance`),true);
  }
});

test('audio-before-service ordering also keeps the number hidden until both are ready',()=>{
  const h=harness(); h.time(200); h.run('_refreshContentGate()');
  const rec=h.instances[0]; rec.audioReady();
  assert.equal(h.render().number.style.display,'none');
  rec.serviceReady(); assert.equal(h.render().number.style.display,'block');
});

test('audio capture ending clears the prompt but does not reject its valid delayed final result',()=>{
  const h=harness(); h.time(200); h.run('_refreshContentGate()');
  const rec=h.instances[0]; rec.ready(); assert.equal(h.render().number.style.display,'block');
  rec.audioEnd(); assert.equal(h.render().number.style.display,'none');
  rec.result('2'); assert.equal(h.c.speechReady[0],true);
});

test('retired audio callbacks cannot alter the next digit capture readiness',()=>{
  const h=harness(); h.time(200); h.run('_refreshContentGate()');
  const old=h.instances[0]; old.ready(); old.result('2');
  h.time(1000); h.run('currentDigitIndex=1; speechWindowStart=1000; _refreshContentGate()');
  const current=h.instances[1]; current.serviceReady();
  old.audioReady(); assert.equal(h.render().number.style.display,'none');
  current.audioReady(); assert.equal(h.render().number.style.display,'block');
  old.audioEnd(); assert.equal(h.render().number.style.display,'block');
});

test('empty final after both readiness signals never advances; first matching result advances once',()=>{
  const h=harness(); h.time(200); h.run('_refreshContentGate()');
  const rec=h.instances[0]; rec.ready();
  assert.equal(h.render().number.style.display,'block');
  rec.result('');
  assert.equal(h.c.speechReady[0],false);
  assert.equal(rec.aborted,false);
  rec.result('2');
  assert.equal(h.c.speechReady[0],true);
  assert.equal(rec.aborted,true);
  const acceptedAt=h.c._voiceFiredAt;
  h.time(500); rec.result('2');
  assert.equal(h.c._voiceFiredAt,acceptedAt,'duplicate results cannot rearm the accepted digit');
});

test('observed three-digit first-empty sequence advances on each single captured utterance',()=>{
  // Actual event order: ready -> stable gesture -> VAD fired -> final empty text.
  // Existing records: first VAD durations236/228/220ms, then empty finals about
  // one server-clock second later. Clock offsets here are synthetic; source
  // telemetry did not record the original performance.now() for each VAD fire.
  const h=harness(); h.run('digits=[5,2,4]');
  for(const [i,duration] of [236,228,220].entries()) {
    const base=1000+i*10000;
    h.time(base); h.run(`currentDigitIndex=${i};speechWindowStart=${base};_voiceFiredAt=0;_refreshContentGate()`);
    const rec=h.instances[i];rec.ready();
    h.gesture(base+2000);h.voice(base+2010,duration);
    h.time(base+3010);h.gesture(base+3000);rec.result('');
    assert.equal(h.c.speechReady[i],true,`digit ${i}: first empty final with real voice proof must not demand repetition`);
    assert.equal(h.c._voiceFiredAt,base+2010,'retain observed voice time, never result-arrival time');
    assert.equal(h.c._provisionalSpeech[i],true,'local content is unavailable, not browser-verified');
    assert.equal(h.advance(),true);
    assert.equal(rec.aborted,true);
  }
});

test('empty interim, wrong content, silence and untied VAD health cannot use provisional progression',()=>{
  for(const scenario of ['empty_interim','wrong_then_empty','same_batch_wrong','silence','health_only']) {
    const h=harness();h.time(1000);h.run('speechWindowStart=1000;_refreshContentGate()');
    const rec=h.instances[0];rec.ready();h.gesture(2000);
    if(!['silence','health_only'].includes(scenario))h.voice(2010);
    if(scenario==='health_only')h.run('_vadEnergyDetected=true;_lastVbRatio=1');
    h.time(2500);h.gesture(2490);
    if(scenario==='empty_interim') {
      const result=[{transcript:'',confidence:0}];result.isFinal=false;
      rec.onresult({resultIndex:0,results:[result]});
    } else if(scenario==='same_batch_wrong') {
      const empty=[{transcript:'',confidence:0}];empty.isFinal=true;
      const wrong=[{transcript:'five',confidence:1}];wrong.isFinal=true;
      rec.onresult({resultIndex:0,results:[empty,wrong]});
    } else {
      if(scenario==='wrong_then_empty')rec.result('5');
      rec.result('');
    }
    assert.equal(h.c.speechReady[0],false,scenario);
    assert.equal(rec.aborted,false,scenario);
  }
});

test('empty final rejects stale voice, closed window, stale generation and absent or stale gesture',()=>{
  for(const scenario of ['stale_voice','closed_window','stale_generation','hand_down','stale_gesture','pre_window_onset']) {
    const h=harness();h.time(1000);h.run('speechWindowStart=1000;_refreshContentGate()');
    const rec=h.instances[0];rec.ready();h.gesture(2000);h.voice(2010);
    h.time(2500);h.gesture(2490);
    if(scenario==='stale_voice'){h.time(4011);h.gesture(4001);}
    if(scenario==='closed_window')h.run('speechWindowStart=3000');
    if(scenario==='stale_generation')h.run('_contentGateGeneration++');
    if(scenario==='hand_down')h.gesture(2490,false);
    if(scenario==='stale_gesture')h.gesture(1700);
    if(scenario==='pre_window_onset'){
      h.run('_digitVoiceEvidence=null');h.gesture(1100);h.voice(1110,236);h.time(1500);h.gesture(1490);
    }
    rec.result('');assert.equal(h.c.speechReady[0],false,scenario);
    assert.equal(rec.aborted,false,scenario);
  }
});

test('old proof cannot satisfy a repeated next digit and provisional confirmation stays honest',()=>{
  const h=harness();h.run('digits=[2,2,2]');h.time(1000);h.run('speechWindowStart=1000;_refreshContentGate()');
  const old=h.instances[0];old.ready();h.gesture(2000);h.voice(2010);
  h.time(2500);h.gesture(2490);old.result('');assert.equal(h.c.speechReady[0],true);
  h.run('CaptureFeedback.renderGuided(captureCtx,{beat:true,provisional:_provisionalSpeech[0]})');
  assert.equal(h.c.captureCtx.byId('vacGuidedPrompt').textContent,'Audio captured');
  assert.match(h.c.captureCtx.byId('vacGuidedSub').textContent,/server/i);
  h.time(3500);h.run('currentDigitIndex=1;speechWindowStart=3500;_refreshContentGate()');
  const current=h.instances[1];current.ready();h.gesture(3500);old.result('');current.result('');
  assert.equal(h.c.speechReady[1],false);
});

test('existing no-match fallback keeps its recognizer if the current owner declines',()=>{
  const h=harness();h.run('var allow=false;var accepted=0;var gate=_startDigitContentGate(2,()=>false,null,()=>{if(!allow)return false;accepted++;return true;},()=>true)');
  const rec=h.instances[0];rec.ready();h.time(1000);rec.result('wrong');h.time(5001);rec.result('wrong');
  assert.equal(rec.aborted,false,'closed or stale owner must not consume the current recognizer');
  h.run('allow=true');h.time(5002);rec.result('wrong');assert.equal(h.c.accepted,1);assert.equal(rec.aborted,true);
});

test('natural recognition restart cannot reuse proof from the previous audio capture',()=>{
  const h=harness();h.time(1000);h.run('speechWindowStart=1000;_refreshContentGate()');
  const rec=h.instances[0];rec.ready();h.gesture(2000);h.voice(2010);
  rec.onend();rec.ready();h.time(2500);h.gesture(2490);rec.result('');
  assert.equal(h.c.speechReady[0],false);
  h.gesture(3000);h.voice(3010);h.time(3500);h.gesture(3490);rec.result('');
  assert.equal(h.c.speechReady[0],true,'new capture requires its own qualified voice proof');
});

test('audio-end retains qualified proof for an in-flight empty final without renewing its time',()=>{
  const h=harness();h.time(1000);h.run('speechWindowStart=1000;_refreshContentGate()');
  const rec=h.instances[0];rec.ready();h.gesture(2000);h.voice(2010);
  rec.audioEnd();h.time(2500);h.gesture(2490);rec.result('');
  assert.equal(h.c.speechReady[0],true);
  assert.equal(h.c._voiceFiredAt,2010);
});
