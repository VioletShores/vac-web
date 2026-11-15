// vault-handoff.test.js — vac-vault-handoff.js (athena PKT-S204-VAULT-MOBILE-HANDOFF).
//
// Runs the shipped module in a vm sandbox with a stub window/document/fetch,
// and asserts: inert without params; only a SERVER-authenticated full result
// with an opener mints; delivery is a postMessage pinned to the allow-listed
// Vault origin; the ack is origin-, source- and state-checked; it never
// navigates. The cross-browser run is athena's Playwright e2e.
//
// Run: node --test tests/vault-handoff.test.js

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'vac-vault-handoff.js'), 'utf8');
const VAULT = 'https://api.athenapilot.ai';
const STATE = 'S'.repeat(43);
const JWT = 'aaa.bbb.ccc';

function el() {
  return { style: {}, attrs: {}, children: [], textContent: '', listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, f) { this.listeners[t] = f; } };
}

function load(search, { opener = 'present', authFetch } = {}) {
  const posted = [];
  const fetches = [];
  const listeners = {};
  const byId = {};
  let closed = false;
  const navigations = [];
  const op = opener === 'present' ? { closed: false, postMessage: (m, o) => posted.push({ m, o }) } : null;
  const document = {
    body: el(),
    createElement() { return el(); },
    getElementById(id) { return byId[id] || null; },
  };
  document.body.appendChild = (c) => { const walk = (n) => { if (n.id) byId[n.id] = n; n.children.forEach(walk); }; walk(c); return c; };
  const location = {};
  Object.defineProperty(location, 'search', { get: () => search });
  for (const k of ['href', 'hash']) Object.defineProperty(location, k, { get: () => '', set: (v) => navigations.push(v) });
  const window = {
    location, opener: op, closed: false,
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    close() { closed = true; },
  };
  const fetch = (url, init) => {
    fetches.push({ url, body: JSON.parse(init.body) });
    const r = authFetch ? authFetch(url, init) : { ok: true, status: 200, body: { compact_jwt: JWT, claims: { exp: Date.now() / 1000 + 120 } } };
    return Promise.resolve({ ok: r.ok, status: r.status, json: () => Promise.resolve(r.body) });
  };
  const timers = [];
  const ctx = { window, document, fetch, URLSearchParams, Promise, JSON, Date, String, Object, Error,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: () => {},
    history: { pushState: (...a) => navigations.push(a), replaceState: (...a) => navigations.push(a) } };
  ctx.window.window = ctx.window;
  vm.runInNewContext(SRC, Object.assign(ctx, { self: window }));
  return { window, posted, fetches, listeners, byId, op, timers, navigations, get closed() { return closed; } };
}

const FULL = { authenticated: true, session_token: 'sess.sig', session: { auth_level: 'full', email: 'Owner@Example.invalid', token: 'sess.sig' } };
const flush = () => new Promise((r) => setImmediate(r));

function continuation() {
  const now = Date.now() / 1000;
  return {status:'identity_check_required',purpose:'decision_receipt',action:'confirm',
    subject:'owner@example.invalid',public_ref:'decision-fixture',payload_sha256:'a'.repeat(64),
    expires_at:now+120,handoff:{audience:'athena:decisions:confirm',nonce:STATE},
    challenge:{challenge_id:'challenge-fixture',phrase:'fixture digits',
      ceremony_policy:{version:'full-ceremony-1',sha256:'b'.repeat(64),
        binding:{challenge_id:'challenge-fixture',created_at:new Date().toISOString(),expires_seconds:120},
        verification:{version:'full-auth-1'},capture:{include_greeting:true}}}};
}
function offer(h,c=continuation(),origin=VAULT,source=h.op) {
  for (const fn of h.listeners.message || []) fn({origin,source,data:{type:'vac-continuation-challenge',state:STATE,continuation:c}});
}
test('Decisions consumes only the trusted opener challenge once and signs its separate audience',async()=>{
  const h=load('?handoff=decisions-confirm&state='+STATE);
  assert.deepEqual(JSON.parse(JSON.stringify(h.posted[0])),{m:{type:'vac-continuation-ready',state:STATE},o:VAULT});
  offer(h);
  const c=h.window.VACVaultHandoff.consumeChallenge({email:'OWNER@example.invalid'},true,false);
  assert.equal(c.challenge_id,'challenge-fixture');
  assert.throws(()=>h.window.VACVaultHandoff.consumeChallenge({email:'owner@example.invalid'},true,false));
  h.window.VACVaultHandoff.onVerified(FULL,{});
  await flush();await flush();
  assert.equal(h.fetches.length,1);
  assert.deepEqual(h.fetches[0].body.handoff,{audience:'athena:decisions:confirm',nonce:STATE});
  assert.equal(h.posted[1].m.assertion,JWT);
  assert.equal('session_token' in h.posted[1].m,false);
});
for (const fault of ['origin','source','nonce','audience','purpose','action','subject','policy','challenge','expired','future','payload','capture']) {
  test('Decisions rejects malformed or untrusted continuation: '+fault,()=>{
    const h=load('?handoff=decisions-confirm&state='+STATE);
    const c=continuation();
    if(fault==='nonce')c.handoff.nonce='x'.repeat(43);
    if(fault==='audience')c.handoff.audience='athena:vault:store';
    if(fault==='purpose')c.purpose='store_grant';
    if(fault==='action')c.action='delete';
    if(fault==='subject')c.subject='other@example.invalid';
    if(fault==='policy')c.challenge.ceremony_policy.version='future';
    if(fault==='challenge')c.challenge.challenge_id='other';
    if(fault==='expired')c.expires_at=Date.now()/1000-1;
    if(fault==='future'){c.expires_at=Date.now()/1000+1000;c.challenge.ceremony_policy.binding.expires_seconds=1000;}
    if(fault==='payload')c.payload_sha256='bad';
    if(fault==='capture')c.challenge.ceremony_policy.capture.include_greeting=false;
    offer(h,c,fault==='origin'?'https://evil.invalid':VAULT,fault==='source'?{}:h.op);
    assert.throws(()=>h.window.VACVaultHandoff.consumeChallenge({email:'owner@example.invalid'},true,false));
    assert.equal(h.fetches.length,0);
  });
}
test('Decisions cancellation and wrong result identity refuse mint',async()=>{
  for(const cancel of [false,true]){
    const h=load('?handoff=decisions-confirm&state='+STATE);offer(h);
    h.window.VACVaultHandoff.consumeChallenge({email:'owner@example.invalid'},true,false);
    if(cancel)for(const fn of h.listeners.message)fn({origin:VAULT,source:h.op,data:{type:'vac-continuation-cancel',state:STATE}});
    h.window.VACVaultHandoff.onVerified(cancel?FULL:{...FULL,session:{...FULL.session,email:'other@example.invalid'}},{});
    await flush(); assert.equal(h.fetches.length,0);
  }
});
test('Decisions ceremony uses supplied challenge with no alternate backend fetch',async()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','vac-reauth-ceremony.js'),'utf8');
  const start=src.indexOf('            const _chOpts = { method: _chCfg.method };');
  const end=src.indexOf('// F-624 Rung 2 (codex P2)',start);
  assert.ok(start>0&&end>start);
  const block=src.slice(start,end);
  const h=load('?handoff=decisions-confirm&state='+STATE);offer(h);
  const full={};let fetched=0;
  const run=vm.runInNewContext('(async()=>{'+block+';return challengeData;})',
    {window:h.window,_chCfg:{method:'POST',url:()=>'/must-not-fetch'},
     challengeBody:{},d:{email:'owner@example.invalid'},modeConfig:()=>full,MODE_CONFIG:{full},
     skipGreeting:false,JSON,fetch:()=>{fetched++;throw Error('wrong challenge');}});
  assert.equal((await run()).challenge_id,'challenge-fixture');
  assert.equal(fetched,0);
  await assert.rejects(run()); assert.equal(fetched,0,'replay never falls back to another challenge');
});


test('without handoff params the module defines nothing and listens to nothing', () => {
  for (const search of ['', '?return=/tribunal-demo', '?state=' + STATE]) {
    const h = load(search);
    assert.equal(h.window.VACVaultHandoff, undefined);
    assert.deepEqual(h.listeners, {});
    assert.equal(h.fetches.length, 0);
  }
});

test('a full server verdict with an opener mints a handoff VAT and posts it to the pinned Vault origin', async () => {
  const h = load('?handoff=vault-store&state=' + STATE + '&origin=https://evil.example');
  h.window.VACVaultHandoff.onVerified(FULL, { email: 'x@y' });
  await flush(); await flush();
  assert.equal(h.fetches.length, 1);
  assert.match(h.fetches[0].url, /\/v1\/vat\/issue$/);
  assert.deepEqual(h.fetches[0].body.handoff, { audience: 'athena:vault:store', nonce: STATE });
  assert.equal(h.fetches[0].body.authorising_session_token, 'sess.sig');
  assert.equal(h.fetches[0].body.human_identity, 'email:owner@example.invalid');
  assert.ok(h.fetches[0].body.expiry_seconds <= 120);
  assert.equal(h.posted.length, 1);
  assert.equal(h.posted[0].o, VAULT, 'targetOrigin must be the pinned Vault origin, never * or the URL');
  assert.deepEqual(JSON.parse(JSON.stringify(h.posted[0].m)), { type: 'vac-vault-handoff', state: STATE, assertion: JWT });
  assert.equal(h.navigations.length, 0, 'the handoff never navigates');
});

test('a failed or partial ceremony delivers nothing', async () => {
  for (const r of [{ authenticated: false, session_token: 's', session: { auth_level: 'full' } }, null, {}]) {
    const h = load('?handoff=vault-store&state=' + STATE);
    h.window.VACVaultHandoff.onVerified(r, { email: 'a@b' });
    await flush();
    assert.equal(h.fetches.length, 0);
    assert.equal(h.posted.length, 0);
  }
});

test('below full is not handed off', async () => {
  for (const level of ['quick', 'otp', undefined]) {
    const h = load('?handoff=vault-store&state=' + STATE);
    h.window.VACVaultHandoff.onVerified({ authenticated: true, session_token: 's', session: { auth_level: level, email: 'a@b' } }, {});
    await flush();
    assert.equal(h.fetches.length, 0);
    assert.equal(h.posted.length, 0);
  }
});

test('no opener: nothing is minted or sent, and the page says to return to the Vault tab', async () => {
  const h = load('?handoff=vault-store&state=' + STATE, { opener: null });
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush();
  assert.equal(h.fetches.length, 0);
  assert.match(h.byId.vacVaultHandoffMsg.textContent, /Return to the Vault tab/);
});

test('an unknown target or a malformed state sends nothing', async () => {
  for (const search of ['?handoff=evil&state=' + STATE, '?handoff=vault-store&state=short', '?handoff=vault-store']) {
    const h = load(search);
    h.window.VACVaultHandoff.onVerified(FULL, {});
    await flush();
    assert.equal(h.fetches.length, 0);
    assert.equal(h.posted.length, 0);
  }
});

test('the ack is accepted only from the Vault origin, from the opener, for this state', async () => {
  const h = load('?handoff=vault-store&state=' + STATE);
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush(); await flush();
  const [onMsg] = h.listeners.message;
  const ack = { type: 'vac-vault-handoff-ack', state: STATE };
  onMsg({ origin: 'https://evil.example', source: h.op, data: ack });
  onMsg({ origin: VAULT, source: {}, data: ack });
  onMsg({ origin: VAULT, source: h.op, data: { type: 'vac-vault-handoff-ack', state: 'T'.repeat(43) } });
  h.timers.forEach((t) => t.ms === 1200 && t.f());
  assert.equal(h.closed, false);
  assert.notEqual(h.byId.vacVaultHandoff.attrs['data-tone'], 'ok');
  onMsg({ origin: VAULT, source: h.op, data: ack });
  assert.equal(h.byId.vacVaultHandoff.attrs['data-tone'], 'ok');
  h.timers.filter((t) => t.ms === 1200).forEach((t) => t.f());
  assert.equal(h.closed, true);
});

test('send again re-posts the same assertion while it is fresh, and re-mints once it is not', async () => {
  let exp = Date.now() / 1000 + 120;
  const h = load('?handoff=vault-store&state=' + STATE, {
    authFetch: () => ({ ok: true, status: 200, body: { compact_jwt: JWT, claims: { exp } } }) });
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush(); await flush();
  h.byId.vacVaultHandoffResend.listeners.click();
  await flush(); await flush();
  assert.equal(h.fetches.length, 1);
  assert.equal(h.posted.length, 2);
  exp = Date.now() / 1000 - 1;
  const h2 = load('?handoff=vault-store&state=' + STATE, {
    authFetch: () => ({ ok: true, status: 200, body: { compact_jwt: JWT, claims: { exp } } }) });
  h2.window.VACVaultHandoff.onVerified(FULL, {});
  await flush(); await flush();
  h2.byId.vacVaultHandoffResend.listeners.click();
  await flush(); await flush();
  assert.equal(h2.fetches.length, 2);
});

test('a VAC refusal sends nothing and says so', async () => {
  const h = load('?handoff=vault-store&state=' + STATE, {
    authFetch: () => ({ ok: false, status: 403, body: { detail: { error: 'handoff_biometric_stale', message: 'too old' } } }) });
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush(); await flush();
  assert.equal(h.posted.length, 0);
  assert.match(h.byId.vacVaultHandoffMsg.textContent, /too old/);
});

test('the module source never writes the assertion to a URL, storage or the console', () => {
  assert.doesNotMatch(SRC, /localStorage|sessionStorage|console\.|location\.(href|hash|assign|replace)\s*=|history\./);
  assert.doesNotMatch(SRC, /postMessage\([^)]*['"]\*['"]/);
});


test('Athena owner Collaborate handoff has a distinct verified audience and one fixed origin', async () => {
  const h = load('?handoff=owner-collaborate&state=' + STATE +
                 '&origin=https://attacker.example&return=https://attacker.example');
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush(); await flush();
  assert.equal(h.fetches.length, 1);
  assert.deepEqual(h.fetches[0].body.handoff,
                   { audience: 'athena:owner:collaborate', nonce: STATE });
  assert.deepEqual(h.fetches[0].body.resources, ['athena:owner:collaborate']);
  assert.deepEqual(h.fetches[0].body.actions, ['owner_signin']);
  assert.equal(h.posted.length, 1);
  assert.equal(h.posted[0].o, VAULT);
  assert.deepEqual(JSON.parse(JSON.stringify(h.posted[0].m)),
                   { type: 'vac-vault-handoff', state: STATE, assertion: JWT });
  assert.equal(h.navigations.length, 0);
});

test('Athena owner handoff rejects an unverified or weakened ceremony', async () => {
  for (const r of [null, { authenticated: false }, {
    authenticated: true, session_token: 's', session: { auth_level: 'quick', email: 'x@y' }
  }]) {
    const h = load('?handoff=owner-collaborate&state=' + STATE);
    h.window.VACVaultHandoff.onVerified(r, {});
    await flush();
    assert.equal(h.fetches.length, 0);
    assert.equal(h.posted.length, 0);
  }
});

test('Athena owner handoff requires the initiating tab, not a pasted URL', async () => {
  const h = load('?handoff=owner-collaborate&state=' + STATE, { opener: null });
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush();
  assert.equal(h.fetches.length, 0);
  assert.equal(h.posted.length, 0);
  assert.match(h.byId.vacVaultHandoffMsg.textContent, /Return to the Athena tab/);
});

test('Athena owner handoff ack is bound to real opener, pinned origin and nonce', async () => {
  const h = load('?handoff=owner-collaborate&state=' + STATE);
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush(); await flush();
  const [onMessage] = h.listeners.message;
  const ack = { type: 'vac-vault-handoff-ack', state: STATE };
  onMessage({ origin: 'https://attacker.example', source: h.op, data: ack });
  onMessage({ origin: VAULT, source: {}, data: ack });
  onMessage({ origin: VAULT, source: h.op, data: { type: ack.type, state: 'x'.repeat(43) } });
  assert.notEqual(h.byId.vacVaultHandoff.attrs['data-tone'], 'ok');
  onMessage({ origin: VAULT, source: h.op, data: ack });
  assert.equal(h.byId.vacVaultHandoff.attrs['data-tone'], 'ok');
});


// athena PKT-S204-VAC-NARRATION-CAPTURE (#1532): Rob's narration recording page.
test('Athena narration capture handoff mints for its own audience and posts only to Athena', async () => {
  const h = load('?handoff=narration-capture&state=' + STATE +
                 '&origin=https://attacker.example&return=https://attacker.example');
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush(); await flush();
  assert.equal(h.fetches.length, 1);
  assert.match(h.fetches[0].url, /\/v1\/vat\/issue$/);
  assert.deepEqual(h.fetches[0].body.handoff, { audience: 'athena:narration:capture', nonce: STATE });
  assert.deepEqual(h.fetches[0].body.resources, ['athena:narration:capture']);
  assert.deepEqual(h.fetches[0].body.actions, ['narration_capture']);
  assert.equal(h.fetches[0].body.agent_id, 'athena-narration-capture-handoff');
  assert.ok(h.fetches[0].body.expiry_seconds <= 120);
  assert.equal(h.posted.length, 1);
  assert.equal(h.posted[0].o, 'https://api.athenapilot.ai', 'targetOrigin is pinned to Athena, never * or the URL');
  assert.deepEqual(JSON.parse(JSON.stringify(h.posted[0].m)),
                   { type: 'vac-vault-handoff', state: STATE, assertion: JWT });
  assert.equal(h.navigations.length, 0);
  assert.match(h.byId.vacVaultHandoffMsg.textContent, /Sent to Athena\. Return to that tab to finish recording\./);
  assert.equal(h.byId.vacVaultHandoffResend.textContent, 'Send to Athena again');
});

test('Athena narration handoff refuses a weakened ceremony and needs the recording tab', async () => {
  for (const r of [null, { authenticated: false }, {
    authenticated: true, session_token: 's', session: { auth_level: 'quick', email: 'x@y' }
  }]) {
    const h = load('?handoff=narration-capture&state=' + STATE);
    h.window.VACVaultHandoff.onVerified(r, {});
    await flush();
    assert.equal(h.fetches.length, 0);
    assert.equal(h.posted.length, 0);
  }
  const h = load('?handoff=narration-capture&state=' + STATE, { opener: null });
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush();
  assert.equal(h.fetches.length, 0);
  assert.equal(h.posted.length, 0);
  assert.match(h.byId.vacVaultHandoffMsg.textContent, /Return to the Athena tab/);
});

test('Athena narration handoff ack is bound to the opener, the Athena origin and the state', async () => {
  const h = load('?handoff=narration-capture&state=' + STATE);
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush(); await flush();
  const [onMessage] = h.listeners.message;
  const ack = { type: 'vac-vault-handoff-ack', state: STATE };
  onMessage({ origin: 'https://attacker.example', source: h.op, data: ack });
  onMessage({ origin: 'https://api.athenapilot.ai', source: {}, data: ack });
  onMessage({ origin: 'https://api.athenapilot.ai', source: h.op, data: { type: ack.type, state: 'x'.repeat(43) } });
  assert.notEqual(h.byId.vacVaultHandoff.attrs['data-tone'], 'ok');
  // no ack yet: the reminder names Athena, never the Vault
  h.timers.filter((t) => t.ms === 6000).forEach((t) => t.f());
  assert.doesNotMatch(h.byId.vacVaultHandoffMsg.textContent, /Vault/);
  onMessage({ origin: 'https://api.athenapilot.ai', source: h.op, data: ack });
  assert.equal(h.byId.vacVaultHandoff.attrs['data-tone'], 'ok');
});

test('successful narration handoff does not dismiss the verification screen on a timer', async () => {
  const h = load('?handoff=narration-capture&state=' + STATE);
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush(); await flush();
  h.listeners.message[0]({ origin: VAULT, source: h.op,
    data: { type: 'vac-vault-handoff-ack', state: STATE } });
  h.timers.forEach((t) => t.f());
  assert.equal(h.closed, false, 'the user needs time to inspect the verification report');
});

test('narration results stay open after a real ack until the user explicitly closes the tab', async () => {
  const h = load('?handoff=narration-capture&state=' + STATE);
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush(); await flush();
  const actions = h.byId.vacVaultHandoffActions;
  assert.match(actions.style.cssText, /display:none/);
  h.byId.vacVaultHandoffClose.listeners.click();
  assert.equal(h.closed, false, 'completion controls are inert before an authenticated ack');
  h.listeners.message[0]({ origin: VAULT, source: h.op,
    data: { type: 'vac-vault-handoff-ack', state: STATE } });
  assert.equal(actions.style.display, 'flex');
  assert.match(h.byId.vacVaultHandoffMsg.textContent, /return to Athena to record/);
  assert.equal(h.byId.vacVaultHandoffResend.style.display, 'none');
  h.timers.forEach((t) => t.f());
  assert.equal(h.closed, false, 'no completion timer may remove narration results');
  h.byId.vacVaultHandoffResend.listeners.click();
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush();
  assert.equal(h.fetches.length, 1);
  assert.equal(h.posted.length, 1, 'reviewing results must not reissue or resend authority');
  const rendered = Object.values(h.byId).map((node) => node.textContent).join(' ');
  assert.doesNotMatch(rendered, /aaa\.bbb\.ccc|sess\.sig|Owner@Example\.invalid/);
  h.byId.vacVaultHandoffClose.listeners.click();
  assert.equal(h.closed, true);
  assert.equal(h.navigations.length, 0);
});

test('review results opens the existing report and moves keyboard focus without changing verification', async () => {
  const h = load('?handoff=narration-capture&state=' + STATE);
  let focused = false;
  let scrolled = false;
  const details = { tagName: 'DETAILS', open: false,
    querySelector: () => ({ focus() { focused = true; } }),
    scrollIntoView() { scrolled = true; } };
  h.byId.successModalities = { parentNode: details };
  h.window.VACVaultHandoff.onVerified(FULL, {});
  await flush(); await flush();
  h.byId.vacVaultHandoffReview.listeners.click();
  assert.equal(details.open, false);
  const ack = { origin: VAULT, source: h.op, data: { type: 'vac-vault-handoff-ack', state: STATE } };
  h.listeners.message[0](ack);
  h.byId.vacVaultHandoffReview.listeners.click();
  assert.equal(details.open, true);
  assert.equal(focused, true);
  assert.equal(scrolled, true);
  assert.equal(h.byId.vacVaultHandoff.style.display, 'none', 'banner no longer covers the report');
  h.listeners.message[0](ack);
  assert.equal(h.byId.vacVaultHandoff.style.display, 'none', 'duplicate ack does not interrupt review');
  assert.equal(h.closed, false);
  assert.equal(h.fetches.length, 1);
  assert.equal(h.posted.length, 1);
  assert.equal(h.navigations.length, 0);
});

test('owner and Vault handoffs retain their existing automatic return behavior', async () => {
  for (const target of ['vault-store', 'owner-collaborate']) {
    const h = load('?handoff=' + target + '&state=' + STATE);
    h.window.VACVaultHandoff.onVerified(FULL, {});
    await flush(); await flush();
    h.listeners.message[0]({ origin: VAULT, source: h.op,
      data: { type: 'vac-vault-handoff-ack', state: STATE } });
    assert.equal(h.byId.vacVaultHandoffActions, undefined);
    assert.equal(h.timers.filter((t) => t.ms === 1200).length, 1);
    h.timers.filter((t) => t.ms === 1200).forEach((t) => t.f());
    assert.equal(h.closed, true);
  }
});



test('Decisions acknowledgement reports the held action and never auto-closes',async()=>{
  const h=load('?handoff=decisions-confirm&state='+STATE);offer(h);
  h.window.VACVaultHandoff.consumeChallenge({email:'owner@example.invalid'},true,false);
  h.window.VACVaultHandoff.onVerified(FULL,{});await flush();await flush();
  const ack={type:'vac-vault-handoff-ack',state:STATE};
  for(const fn of h.listeners.message)fn({origin:VAULT,source:h.op,data:ack});
  assert.doesNotMatch(h.byId.vacVaultHandoffMsg.textContent,/checked your identity/);
  ack.status='identity_verified_action_held';
  for(const fn of h.listeners.message)fn({origin:VAULT,source:h.op,data:ack});
  assert.match(h.byId.vacVaultHandoffMsg.textContent,/decision is still held/);
  for(const timer of h.timers)timer.f();
  assert.equal(h.closed,false);
});
