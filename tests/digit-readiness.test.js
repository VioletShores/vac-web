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
    ready() { if (this.onstart) this.onstart(); }
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
    var _voiceFiredAt=0, _acceptArmed=false, _contentReadyDigit=-1, _contentGateGeneration=0;`, c);
  vm.runInContext(section('function _startDigitContentGate(', '// Starts a content gate for the greeting phrase.'), c);
  vm.runInContext(section('    function _refreshContentGate()', '    function _startSpeechGate()'), c);
  return {c, instances, time(t){now=t;}, run(s){return vm.runInContext(s,c);}};
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
test('readiness begins on provider start, not recognizer construction',()=>{
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
