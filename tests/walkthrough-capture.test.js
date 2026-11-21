'use strict';
// Synthetic browser-message/Blob harness. No browser, camera, network or person.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'vac-walkthrough-capture.js'), 'utf8');
const STATE = 's'.repeat(43), ORIGIN = 'https://api.athenapilot.ai';
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };

function harness(search = '?handoff=vac-walkthrough-record&state=' + STATE, options = {}) {
  let now = 1000000, next = 1;
  const elements = [], handlers = {}, timers = new Map(), sent = [];
  let receive;
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.events = {}; this.disabled = false; this.checked = false; elements.push(this); }
    append(...items) { for (const e of items) { this.children.push(e); e.parent = this; } }
    appendChild(e) { this.append(e); }
    setAttribute(k, v) { this[k] = v; }
    addEventListener(k, fn) { this.events[k] = fn; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    remove() { this.removed = true; }
    alive() { return !this.removed && (!this.parent || this.parent.alive()); }
    click() { if (!this.disabled && this.events.click) return this.events.click({preventDefault(){}}); }
  }
  const document = {readyState:'complete', body:new Element('body'), createElement:t=>new Element(t),
    addEventListener:(k, fn)=>{handlers['document:' + k] = fn;}};
  const peer = {postMessage(m, origin, transfer) {
    assert.equal(origin, ORIGIN);
    // Browser transfer semantics: detach the original ArrayBuffer.
    const copy = structuredClone(m, {transfer:transfer || []}); sent.push(copy);
    if (receive) queueMicrotask(() => receive(copy));
  }, focus(){}};
  const window = {location:{search}, opener:options.noOpener ? null : peer,
    addEventListener:(k, fn)=>{handlers[k] = fn;}, close(){}};
  const context = vm.createContext({window, document, URLSearchParams, Blob, ArrayBuffer, Uint8Array,
    TextEncoder, crypto:webcrypto, performance:{now:()=>now - 1000000},
    Date:{now:()=>now}, console,
    setTimeout:(fn, ms)=>{let id=next++;timers.set(id,{fn,at:now+ms});return id;},
    clearTimeout:id=>timers.delete(id),
    setInterval:(fn, ms)=>{let id=next++;timers.set(id,{fn,at:now+ms,interval:ms});return id;},
    clearInterval:id=>timers.delete(id)});
  vm.runInContext(source, context);
  const h = {window, context, sent, peer, elements, handlers,
    find:(tag, text)=>elements.filter(e=>e.alive() && e.tag === tag && (!text || e.textContent === text)).at(-1),
    words:()=>elements.filter(e=>e.alive()).map(e=>e.textContent || '').join(' '),
    message:async(m, origin=ORIGIN, sender=peer)=>{if(handlers.message)await handlers.message({origin,source:sender,data:{state:STATE,...m}});},
    onSend:fn=>{receive=fn;},
    advance:async(ms)=>{now+=ms;const due=[...timers].filter(([,t])=>t.at<=now);for(const [id,t]of due){timers.delete(id);if(t.interval)timers.set(id,{...t,at:now+t.interval});t.fn();}await flush();}};
  return h;
}
async function linked(h) {
  await h.message({type:'vac-walkthrough-init',notice_version:'vac-walkthrough-private-v1',expires_at:1600});
  h.find('button','Continue to the real VAC check').click();
}
function offer(h, data = new Blob(['synthetic clip'], {type:'video/webm'}), result = {authenticated:true,walkthrough_receipt:'header.claims.signature'}) {
  const bridge = h.window.VACWalkthroughCapture;
  for(const stage of ['camera_ready','capture_started','greeting_prompt','digit_prompt','capture_stopped','verification_submitted']) bridge.event(stage);
  bridge.completed(data, result);
}
async function consent(h) {
  const checkbox = h.find('input'); checkbox.checked = true; checkbox.events.change();
  const promise = h.find('button','Save this genuine clip privately').click();
  await flush(); return {promise};
}

test('ordinary auth is inert and creates no film globals, messages or UI', () => {
  for(const search of ['', '?handoff=narration-capture&state=' + STATE, '?handoff=critic-review']) {
    const h=harness(search);assert.equal(h.window.VACWalkthroughCapture,undefined);assert.equal(h.sent.length,0);assert.equal(h.find('dialog'),undefined);
  }
});
test('dedicated flow requires the exact opener, origin, state and notice before camera readiness', async () => {
  const h=harness(), b=h.window.VACWalkthroughCapture;
  assert.equal(b.canStart(true,true),false);assert.throws(()=>b.challengeFields());
  const init={type:'vac-walkthrough-init',notice_version:'vac-walkthrough-private-v1',expires_at:1600};
  await h.message(init,'https://attacker.invalid');await h.message(init,ORIGIN,{});await h.message({...init,state:'x'.repeat(43)});
  await h.message({...init,notice_version:'wrong'});await h.message({...init,expires_at:999999});
  assert.equal(b.canStart(true,true),false);
  await h.message(init);assert.equal(b.canStart(true,true),false); // explicit continue still required
  h.find('button','Continue to the real VAC check').click();
  assert.equal(b.canStart(true,true),true);assert.equal(b.canStart(false,true),false);assert.equal(b.canStart(true,false),false);
  assert.match(b.challengeFields().walkthrough_state_sha256,/^[a-f0-9]{64}$/);
});
test('malformed or shortcut URL, duplicate state and absent opener never become ready', async () => {
  for(const suffix of ['&greeting=skip','&mode=fast','&state=' + STATE,'&handoff=other']) {
    const h=harness('?handoff=vac-walkthrough-record&state='+STATE+suffix);
    await h.message({type:'vac-walkthrough-init',notice_version:'vac-walkthrough-private-v1',expires_at:1600});
    assert.equal(h.window.VACWalkthroughCapture.canStart(true,true),false);assert.equal(h.sent.length,0);
  }
  assert.equal(harness(undefined,{noOpener:true}).window.VACWalkthroughCapture.canStart(true,true),false);
});
test('a genuine result is not save consent; no bytes or receipt leave before second checkbox and click', async () => {
  const h=harness();await linked(h);offer(h);
  const save=h.find('button','Save this genuine clip privately');assert.equal(save.disabled,true);save.click();
  assert.equal(h.sent.filter(m=>m.type==='vac-walkthrough-save'||m.type==='vac-walkthrough-chunk').length,0);
  h.find('button','Do not save this clip').click();
  assert.equal(h.sent.at(-1).type,'vac-walkthrough-declined');assert.equal(h.window.VACWalkthroughCapture.canStart(true,true),false);
});
test('failed result, missing receipt and non-video Blob cannot offer private save', async () => {
  for(const [blob,result] of [[new Blob(['x'],{type:'video/webm'}),{authenticated:false,walkthrough_receipt:'a.b.c'}],
    [new Blob(['x'],{type:'video/webm'}),{authenticated:true}],
    [new Blob(['x'],{type:'audio/webm'}),{authenticated:true,walkthrough_receipt:'a.b.c'}]]) {
    const h=harness();await linked(h);offer(h,blob,result);assert.equal(h.find('button','Save this genuine clip privately'),undefined);assert.match(h.words(),/No private clip/);
  }
});
test('save transfers exact bytes sequentially; only final saved ACK displays success', async () => {
  const h=harness();await linked(h);const bytes=new Uint8Array(524300);bytes.fill(19);bytes[bytes.length-1]=42;offer(h,new Blob([bytes],{type:'video/webm'}));
  h.onSend(async m=>{
    if(m.type==='vac-walkthrough-save') {assert.equal(m.save_consented,true);assert.equal(m.save_notice_version,'vac-walkthrough-save-v1');await h.message({type:'vac-walkthrough-ack',phase:'begin'});}
    if(m.type==='vac-walkthrough-chunk') await h.message({type:'vac-walkthrough-ack',phase:'chunk',seq:m.seq});
  });
  const {promise}=await consent(h);
  assert.deepEqual(h.sent.filter(m=>m.type==='vac-walkthrough-chunk').map(m=>m.seq),[0,1]);
  const saved=Buffer.concat(h.sent.filter(m=>m.type==='vac-walkthrough-chunk').map(m=>Buffer.from(m.data)));assert.deepEqual(saved,Buffer.from(bytes));
  assert.match(h.words(),/Saving your original/);assert.doesNotMatch(h.words(),/Saved privately in Athena/);
  await h.message({type:'vac-walkthrough-saved'},'https://attacker.invalid');assert.match(h.words(),/Saving your original/);
  await h.message({type:'vac-walkthrough-saved'});await promise;assert.match(h.words(),/Saved privately in Athena/);
  const timeline=h.sent.find(m=>m.type==='vac-walkthrough-save').timeline;
  assert.ok(timeline.every(e=>Object.keys(e).sort().join(',')==='at_ms,stage'));
  assert.equal(timeline.at(-1).stage,'private_save_consented');
});
test('lost chunk ACK retries the same original bytes after transferable buffer detachment', async () => {
  const h=harness();await linked(h);offer(h);let chunks=0;
  h.onSend(async m=>{if(m.type==='vac-walkthrough-save')await h.message({type:'vac-walkthrough-ack',phase:'begin'});
    if(m.type==='vac-walkthrough-chunk'&&++chunks>1)await h.message({type:'vac-walkthrough-ack',phase:'chunk',seq:m.seq});
    if(m.type==='vac-walkthrough-finish')await h.message({type:'vac-walkthrough-saved'});});
  const {promise}=await consent(h);assert.equal(chunks,1);await h.advance(12001);await promise;
  const messages=h.sent.filter(m=>m.type==='vac-walkthrough-chunk');assert.equal(messages.length,2);assert.deepEqual(Buffer.from(messages[0].data),Buffer.from(messages[1].data));
});
test('wrong numbered chunk ACK does not move to finish', async () => {
  const h=harness();await linked(h);offer(h);
  h.onSend(async m=>{if(m.type==='vac-walkthrough-save')await h.message({type:'vac-walkthrough-ack',phase:'begin'});});
  const {promise}=await consent(h);await h.message({type:'vac-walkthrough-ack',phase:'chunk',seq:1});await flush();assert.equal(h.sent.some(m=>m.type==='vac-walkthrough-finish'),false);
  await h.message({type:'vac-walkthrough-ack',phase:'chunk',seq:0});await flush();await h.message({type:'vac-walkthrough-saved'});await promise;
});
test('generic ack phase saved cannot replace the distinct durable-save confirmation', async () => {
  const h=harness();await linked(h);offer(h);
  h.onSend(async m=>{if(m.type==='vac-walkthrough-save')await h.message({type:'vac-walkthrough-ack',phase:'begin'});
    if(m.type==='vac-walkthrough-chunk')await h.message({type:'vac-walkthrough-ack',phase:'chunk',seq:m.seq});});
  const {promise}=await consent(h);await h.message({type:'vac-walkthrough-ack',phase:'saved'});await flush();
  assert.match(h.words(),/Saving your original/);assert.doesNotMatch(h.words(),/Saved privately in Athena/);
  await h.message({type:'vac-walkthrough-saved'});await promise;assert.match(h.words(),/Saved privately in Athena/);
});
test('user retry after three lost final ACKs resumes finish without new chunks or verification', async () => {
  const h=harness();await linked(h);offer(h);let finishCount=0;
  h.onSend(async m=>{if(m.type==='vac-walkthrough-save')await h.message({type:'vac-walkthrough-ack',phase:'begin'});
    if(m.type==='vac-walkthrough-chunk')await h.message({type:'vac-walkthrough-ack',phase:'chunk',seq:m.seq});
    if(m.type==='vac-walkthrough-finish')finishCount++;});
  const initial=await consent(h);
  for(let i=0;i<3;i++)await h.advance(12001);
  await initial.promise;assert.equal(finishCount,3);assert.match(h.words(),/Saving could not be confirmed/);
  const chunkCount=h.sent.filter(m=>m.type==='vac-walkthrough-chunk').length;
  const retry=await consent(h);assert.equal(finishCount,4);assert.equal(h.sent.filter(m=>m.type==='vac-walkthrough-chunk').length,chunkCount);
  assert.equal(h.sent.filter(m=>m.type==='vac-walkthrough-save').length,1);
  await h.message({type:'vac-walkthrough-saved'});await retry.promise;assert.match(h.words(),/Saved privately in Athena/);
});
test('expiry and page exit clear film readiness and cannot cause another verification', async () => {
  const h=harness();await linked(h);offer(h);await h.advance(600001);
  assert.equal(h.window.VACWalkthroughCapture.canStart(true,true),false);assert.throws(()=>h.window.VACWalkthroughCapture.challengeFields());assert.match(h.words(),/window ended/);
  const p=harness();await linked(p);p.handlers.pagehide();assert.equal(p.window.VACWalkthroughCapture.canStart(true,true),false);
});
test('retry timeline records the new clip only and never actual prompt data', async () => {
  const h=harness();await linked(h);const b=h.window.VACWalkthroughCapture;
  for(const x of ['camera_ready','capture_started','greeting_prompt','digit_prompt','capture_stopped','verification_submitted'])b.event(x);
  b.event('capture_started');b.event('my actual secret phrase');b.event('digit_prompt');b.event('capture_stopped');b.event('verification_submitted');
  b.completed(new Blob(['clip'],{type:'video/webm'}),{authenticated:true,walkthrough_receipt:'a.b.c'});
  h.onSend(async m=>{if(m.type==='vac-walkthrough-save')await h.message({type:'vac-walkthrough-ack',phase:'begin'});
    if(m.type==='vac-walkthrough-chunk')await h.message({type:'vac-walkthrough-ack',phase:'chunk',seq:m.seq});if(m.type==='vac-walkthrough-finish')await h.message({type:'vac-walkthrough-saved'});});
  const {promise}=await consent(h);await promise;const ev=h.sent.find(m=>m.type==='vac-walkthrough-save').timeline;
  assert.equal(ev.filter(e=>e.stage==='capture_started').length,1);assert.equal(ev.filter(e=>e.stage==='greeting_prompt').length,0);assert.equal(JSON.stringify(ev).includes('secret'),false);
});
test('auth session copy removes only film receipt and preserves ordinary fields without mutating result', () => {
  const auth=fs.readFileSync(path.join(root,'auth.html'),'utf8');
  const fn=auth.match(/function authResultForSession\(result\) \{[\s\S]*?\n\}/)[0];const c=vm.createContext({});vm.runInContext(fn,c);
  const original={authenticated:true,session_token:'synthetic',session:{auth_level:'full'},biometric_verification:{overall_score:9},walkthrough_receipt:'film-only'};
  const copy=c.authResultForSession(original);assert.equal(copy.walkthrough_receipt,undefined);assert.equal(original.walkthrough_receipt,'film-only');
  const expected={...original};delete expected.walkthrough_receipt;assert.equal(JSON.stringify(copy),JSON.stringify(expected));
  assert.equal(c.authResultForSession(expected),expected);assert.match(auth,/authResult: authResultForSession\(authResult\)/);
});
test('FULL challenge hook cannot override name, risk or profile with bridge data', () => {
  const ceremony=fs.readFileSync(path.join(root,'vac-reauth-ceremony.js'),'utf8');
  const fn=ceremony.match(/buildBody: function\(d\)\{([\s\S]*?)\n            \},/)[1];
  const context=vm.createContext({CTX:{riskLevel:'medium',profile:{num_digits:3}},window:{VACWalkthroughCapture:{challengeFields:()=>({walkthrough_state_sha256:'a'.repeat(64),name:'forged',risk_level:'low',num_digits:0})}}});
  const body=vm.runInContext('(function(d){'+fn+'})({name:"owner"})',context);
  assert.equal(body.name,'owner');assert.equal(body.risk_level,'medium');assert.equal(body.num_digits,3);assert.equal(body.walkthrough_state_sha256,'a'.repeat(64));
  context.window.VACWalkthroughCapture.challengeFields=()=>({walkthrough_state_sha256:'invalid'});assert.throws(()=>vm.runInContext('(function(d){'+fn+'})({name:"owner"})',context));
});
test('dedicated camera guard refuses missing bridge before existing camera/audio code', async () => {
  const ceremony=fs.readFileSync(path.join(root,'vac-reauth-ceremony.js'),'utf8');
  const prefix=ceremony.slice(ceremony.indexOf('async function requestCamera() {'),ceremony.indexOf('    // t732 TAP-TRACE'));
  const err={style:{}};const full={};const context=vm.createContext({URLSearchParams,document:{getElementById:()=>err},window:{location:{search:'?handoff=vac-walkthrough-record'}},MODE_CONFIG:{full},modeConfig:()=>full,skipGreeting:false});
  vm.runInContext(prefix+'return "camera-code-reached";}',context);
  assert.equal(await context.requestCamera(),undefined);assert.match(err.textContent,/owner page/);
  context.window.VACWalkthroughCapture={canStart:()=>false};assert.equal(await context.requestCamera(),undefined);
  context.window.VACWalkthroughCapture={canStart:()=>true};assert.equal(await context.requestCamera(),'camera-code-reached');
  context.window.location.search='';delete context.window.VACWalkthroughCapture;assert.equal(await context.requestCamera(),'camera-code-reached');
});

test('successful film verification hands off original once then purges ordinary retry media and receipt', async () => {
  const ceremony = fs.readFileSync(path.join(root, 'vac-reauth-ceremony.js'), 'utf8');
  const marker = '// The normal genuine result has rendered. The separate film bridge';
  const from = ceremony.indexOf('            try {\n                if (window.VACWalkthroughCapture)', ceremony.indexOf(marker));
  const to = ceremony.indexOf('\n        } else {', from);
  assert.ok(from > ceremony.indexOf(marker) && to > from, 'runRealVerification success handoff must be present');
  const successHandoff = ceremony.slice(from, to);
  const original = new Blob(['private synthetic original'], {type:'video/webm'});
  for (const outcome of ['success', 'bridge_reject', 'ordinary_auth']) {
    const response = {authenticated:true, session_token:'synthetic-ordinary-session', walkthrough_receipt:'synthetic.receipt.sig'};
    let handed = null;
    const window = {__vacLastVerifyBlob:original};
    if (outcome !== 'ordinary_auth') {
      window.VACWalkthroughCapture = {async completed(blob, result) {
        handed = {blob, receipt:result.walkthrough_receipt};
        if (outcome === 'bridge_reject') throw new Error('synthetic failure');
      }};
    }
    const context = vm.createContext({window, authResult:response, recordedChunks:[original], videoBlob:original});
    await vm.runInContext('(async function(){' + successHandoff + '})()', context);
    if (outcome === 'ordinary_auth') {
      assert.equal(window.__vacLastVerifyBlob, original);
      assert.equal(response.walkthrough_receipt, 'synthetic.receipt.sig');
      assert.equal(vm.runInContext('recordedChunks.length', context), 1);
    } else {
      assert.equal(handed.blob, original);
      assert.equal(handed.receipt, 'synthetic.receipt.sig');
      assert.equal(window.__vacLastVerifyBlob, null);
      assert.equal(Object.hasOwn(response, 'walkthrough_receipt'), false);
      assert.equal(vm.runInContext('recordedChunks.length', context), 0);
      assert.equal(response.session_token, 'synthetic-ordinary-session');
    }
  }
});
