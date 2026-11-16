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
const crypto = require('node:crypto');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'vac-vault-handoff.js'), 'utf8');
const VAULT = 'https://api.athenapilot.ai';
const STATE = 'S'.repeat(43);
const JWT = 'aaa.bbb.ccc';

function el() {
  return { style: {}, attrs: {}, children: [], textContent: '', listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, f) { this.listeners[t] = f; } };
}

function load(search, { opener = 'present', authFetch, now } = {}) {
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
  document.createElement = function () {
    var e = el();
    Object.defineProperty(e, 'innerHTML', { set() { throw new Error('unsafe HTML sink'); } });
    e.appendChild = function (c) {
      const walk = (n) => { if (n.id) byId[n.id] = n; n.children.forEach(walk); };
      walk(c); e.children.push(c); return c;
    };
    e.remove = function () { const walk = n => { if (n.id) delete byId[n.id]; n.children.forEach(walk); }; walk(e); };
    return e;
  };
  document.body.appendChild = (c) => { const walk = (n) => { if (n.id) byId[n.id] = n; n.children.forEach(walk); }; walk(c); return c; };
  const location = {};
  Object.defineProperty(location, 'search', { get: () => search });
  for (const k of ['href', 'hash']) Object.defineProperty(location, k, { get: () => '', set: (v) => navigations.push(v) });
  const window = {
    location, opener: op, closed: false,
    crypto: crypto.webcrypto,
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    close() { closed = true; },
  };
  const fetch = (url, init) => {
    fetches.push({ url, body: JSON.parse(init.body) });
    const r = authFetch ? authFetch(url, init) : { ok: true, status: 200, body: { compact_jwt: JWT, claims: { exp: Date.now() / 1000 + 120 } } };
    return Promise.resolve(r).then(r => ({ ok: r.ok, status: r.status, json: () => Promise.resolve(r.body) }));
  };
  const timers = [];
  const Clock = class extends Date { static now() { return now ? now() : Date.now(); } };
  const ctx = { window, document, fetch, URLSearchParams, Promise, JSON, Date: Clock, String, Object, Error, TextEncoder, Uint8Array, Number,
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

function serviceFixture(patch = {}, options = {}) {
  const op = Object.assign({version: 1, purpose: 'service-operation', actor: 'owner@example.invalid',
    principal: 'person-owner', tenant_id: 'tenant-one', service_id: 'flux',
    project_url: 'https://flux.ai/synthetic/private-project', object_ref: 'README.md', action: 'write_file', capability: 'project.write',
    readback: {action: 'read_file', capability: 'project.read', cost_upper_bound: {amount: '0', unit: 'USD'}},
    source_manifest_sha256: 'a'.repeat(64), content_sha256: 'b'.repeat(64),
    expiry: new Date(Date.now() + 120000).toISOString(),
    resource_envelope: {spend_ceiling: {amount: '0', unit: 'USD'}, cost_upper_bound: {amount: '0', unit: 'USD'}}}, patch);
  const raw = JSON.stringify(op); // bytes supplied by server; UI must not recanonicalise them
  const state = crypto.createHash('sha256').update(raw).digest('hex');
  const h = load('?handoff=service-operation&state=' + state, options);
  const message = {type: 'vac-service-operation-intent', state, intent_json: raw};
  const receive = (overrides = {}) => h.listeners.message[0](Object.assign({origin: VAULT, source: h.op, data: message}, overrides));
  return {h, op, raw, state, receive, message};
}

async function settleReview() {
  // Real WebCrypto digest runs asynchronously off-thread.
  for (let i = 0; i < 15; i++) await new Promise(r => setTimeout(r, 1));
}

function allText(node) { return (node.textContent || '') + (node.children || []).map(allText).join('\n'); }

// Pre-A2 critic review has a separate audience and one-use grant. Its nonce
// binds *only* the server's exact operation digest and policy digest; Athena
// independently validates the full preview and policy on POST confirm.
function criticFixture(change = () => {}, options = {}) {
  const operation_digest = 'b'.repeat(64), policy_sha256 = 'c'.repeat(64);
  const state = crypto.createHash('sha256').update(JSON.stringify({
    operation_digest, policy_sha256, purpose: 'athena:l0:critic-review'
  })).digest('hex');
  const preview = {
    packet_id: 42, kind: 'critic-review', audience: 'athena:l0:critic-review',
    state, operation_digest, policy_sha256, tenant_id: 'tenant-one',
    principal: 'person-owner', actor: 'owner@example.invalid',
    project_url: 'https://www.flux.ai/robzag/athena-pebble-b1-feasibility~07/schematic',
    source_sha256: '6a678dbbc359df3888790019ef4799f2198dee2273cd329edc1d5463868a4156',
    source_bytes: 40304, canonical_plan_rows: 113, source_confidential: true,
    external_source_disclosure: 'full_canonical_plan_and_source_scope',
    reviewers: [
      {provider: 'openai', model: 'gpt-fixture', model_family: 'openai_gpt',
        provider_tier: 'paid_api', data_training_posture: 'owner_verified_no_training',
        evidence_url: 'https://openai.com/enterprise-privacy',
        processing_jurisdiction: 'global_unverified', retention_posture: 'provider_default_disclosed'},
      {provider: 'groq', model: 'qwen-fixture', model_family: 'qwen',
        provider_tier: 'paid_api', data_training_posture: 'owner_verified_no_training',
        evidence_url: 'https://groq.com/privacy',
        processing_jurisdiction: 'global_unverified', retention_posture: 'zdr_verified'}
    ],
    orchestrate_mode: 'collect_only', reviewer_call_limit: 2, synthesis_vendor_allowed: false,
    max_tokens_per_provider: 16384, approved_total_usd: '20.00',
    owner_accepted_external_disclosure: true, owner_accepted_unverified_residency: true,
    provider_hard_cost_cap_enforced: false, automatic_retries: false,
    routing_posture: 'owner_approved_tier_default_after_calibration_expired',
    expiry: new Date(Date.now() + 120000).toISOString(),
    ready_for_owner_critic_vac: true, review_submission_started: false
  };
  change(preview);
  const h = load('?handoff=critic-review&state=' + state, options);
  const offer = (origin = VAULT, source = h.op) => {
    (h.listeners.message || []).forEach(fn => fn({origin, source,
      data: {type: 'vac-critic-review-preview', state, preview}}));
  };
  return {h, state, preview, offer};
}

test('critic-review is separate FULL/L3 VAT for two external models, not Flux write', async () => {
  const {h, state, offer} = criticFixture();
  assert.equal(h.posted.length, 0, 'no disclosure before owner FULL verification');
  h.window.VACVaultHandoff.onVerified(FULL, {});
  assert.deepEqual(JSON.parse(JSON.stringify(h.posted[0])),
    {m: {type: 'vac-critic-review-request', state}, o: VAULT});
  offer(); await settleReview();
  assert.ok(h.byId.vacCriticReviewConfirm, 'valid signed digest binding must offer consent');
  const body = allText(h.byId.vacCriticReview);
  assert.match(body, /Approve this one external A2 critic review/);
  assert.match(body, /40,?304|Reviewed source bytes: 40304/);
  assert.match(body, /113 exact rows/);
  assert.match(body, /openai \/ gpt-fixture/);
  assert.match(body, /groq \/ qwen-fixture/);
  assert.match(body, /COLLECT ONLY: exactly two paid reviewer calls; no third synthesis model/);
  assert.match(body, /FULL source scope and canonical PLAN/);
  assert.match(body, /GLOBAL \/ UNVERIFIED/);
  assert.match(body, /20.00 USD, a POLICY amount — NOT a provider-enforced hard cap/);
  assert.match(body, /NOT permission to start Flux create_thread/);
  assert.equal(h.fetches.length, 0);
  h.byId.vacCriticReviewConfirm.listeners.click(); await flush(); await flush();
  assert.equal(h.fetches.length, 1);
  assert.deepEqual(h.fetches[0].body.handoff,
    {audience: 'athena:l0:critic-review', nonce: state});
  assert.deepEqual(h.fetches[0].body.actions, ['critic_review']);
  assert.equal(h.posted[h.posted.length - 1].m.assertion, JWT);
  assert.equal('session_token' in h.posted[h.posted.length - 1].m, false);
  (h.listeners.message || []).forEach(fn => fn({origin: VAULT, source: h.op,
    data: {type: 'vac-vault-handoff-ack', state}}));
  assert.match(h.byId.vacVaultHandoffMsg.textContent, /does NOT approve the Flux design task/);
});

const criticFaults = {
  extra: p => p.unreviewed = true,
  actor: p => p.actor = 'other@example.invalid',
  sourceHash: p => p.source_sha256 = 'd'.repeat(64),
  sourceBytes: p => p.source_bytes = 40303,
  rows: p => p.canonical_plan_rows = 112,
  project: p => p.project_url = 'https://www.flux.ai/foreign/project/schematic',
  oneReviewer: p => p.reviewers.pop(),
  sameProvider: p => p.reviewers[1].provider = 'openai',
  sameFamily: p => p.reviewers[1].model_family = 'openai_gpt',
  thirdModel: p => p.orchestrate_mode = 'synthesise',
  excessCalls: p => p.reviewer_call_limit = 3,
  hiddenSynthesis: p => p.synthesis_vendor_allowed = true,
  unapprovedTraining: p => p.reviewers[0].data_training_posture = 'vendor_can_train',
  noEvidence: p => p.reviewers[0].evidence_url = 'http://evil.invalid',
  urlSecret: p => p.reviewers[0].evidence_url = 'https://evil.invalid/?token=secret',
  hiddenJurisdiction: p => p.reviewers[1].processing_jurisdiction = 'local_au',
  unknownRetention: p => p.reviewers[1].retention_posture = 'undisclosed',
  manyTokens: p => p.max_tokens_per_provider = 100000,
  wrongAmount: p => p.approved_total_usd = 'unlimited',
  tooMuch: p => p.approved_total_usd = '500.01',
  fakeHardStop: p => p.provider_hard_cost_cap_enforced = true,
  retries: p => p.automatic_retries = true,
  noDisclosure: p => p.owner_accepted_external_disclosure = false,
  noResidency: p => p.owner_accepted_unverified_residency = false,
  wrongRouting: p => p.routing_posture = 'silent_provider_substitution',
  started: p => p.review_submission_started = true,
  oldPolicy: p => p.policy_sha256 = 'd'.repeat(64),
  oldOperation: p => p.operation_digest = 'd'.repeat(64),
  wrongAudience: p => p.audience = 'athena:l0:service-operation',
  expired: p => p.expiry = new Date(Date.now() - 1000).toISOString(),
  future: p => p.expiry = new Date(Date.now() + 1900000).toISOString()
};
for (const [name, change] of Object.entries(criticFaults)) {
  test('critic-review refuses unapproved disclosure, drift or confused authority: ' + name, async () => {
    const {h, offer} = criticFixture(change);
    h.window.VACVaultHandoff.onVerified(FULL, {}); offer(); await settleReview();
    assert.equal(h.byId.vacCriticReviewConfirm, undefined);
    assert.equal(h.fetches.length, 0);
  });
}

test('critic-review requires FULL owner with exact opener, nonce and origin', async () => {
  for (const fault of ['notFull', 'wrongOrigin', 'wrongSource', 'absentOpener', 'wrongNonce']) {
    const {h, state, preview, offer} = criticFixture(() => {}, fault === 'absentOpener' ?
      {opener: 'absent'} : {});
    if (fault === 'notFull') {
      h.window.VACVaultHandoff.onVerified({authenticated:true,auth_level:'fast',session_token:'x',email:'owner@example.invalid'}, {});
    } else h.window.VACVaultHandoff.onVerified(FULL, {});
    if (fault === 'wrongOrigin') offer('https://evil.invalid');
    else if (fault === 'wrongSource') offer(VAULT, {});
    else if (fault === 'wrongNonce') {
      (h.listeners.message || []).forEach(fn => fn({origin:VAULT,source:h.op,
        data:{type:'vac-critic-review-preview',state:'d'.repeat(64),preview}}));
    } else if (fault !== 'absentOpener') offer();
    await settleReview();
    assert.equal(h.byId.vacCriticReviewConfirm, undefined);
    assert.equal(h.fetches.length, 0);
    if (fault === 'wrongNonce') assert.equal(state.length, 64);
  }
});

// Same v2 envelope shape as Athena's native service dispatcher. This fixture
// supplies synthetic identifiers/evidence only; it never runs a real ceremony.
function taskFixture(change = () => {}, options = {}) {
  const project = 'https://www.flux.ai/robzag/athena-pebble-b1-feasibility~07/schematic';
  const hash = 'b'.repeat(64), readBinding = {
    get_thread: {thread: {from_execute: 'thread_url'}},
    get_messages: {thread: {from_execute: 'thread_url'}, offset: 0, limit: 20}
  };
  // Athena's canonical ASCII, sorted-key encoding for this fixed derivation.
  const readHash = crypto.createHash('sha256').update('{"get_messages":{"limit":20,"offset":0,"thread":{"from_execute":"thread_url"}},"get_thread":{"thread":{"from_execute":"thread_url"}}}').digest('hex');
  const op = {
    version: 2, purpose: 'service-operation', execution_id: 'fixture-execution', packet_id: 'fixture-packet',
    actor: 'owner@example.invalid', principal: 'person-owner', tenant_id: 'tenant-one', service_id: 'flux',
    endpoint: 'https://app.flux.ai/mcp', capability: 'submit_agent_task', project_url: project,
    object_ref: 'submitted-source:' + hash, action: 'create_thread', executor: 'fixture-native-executor',
    expiry: new Date(Date.now() + 120000).toISOString(), revocation_ref: 'execution:fixture-execution', risk: 0.5,
    content_sha256: hash, source_manifest_sha256: 'a'.repeat(64), arguments_sha256: 'c'.repeat(64),
    tool_schema_sha256: 'd'.repeat(64), cost_contract_sha256: 'e'.repeat(64), service_manifest_sha256: 'f'.repeat(64),
    allowed_tools: ['get_project', 'create_thread', 'get_thread', 'get_messages'],
    constraints: {network_allowlist: ['app.flux.ai'], write_scope: [project], financial_transaction: false, connection_budget: 3},
    resource_envelope: {max_turns: 1, max_minutes: 5,
      spend_ceiling: {status: 'unknown', unit: 'ACU', basis: 'no_native_per_task_limit'},
      cost_upper_bound: {status: 'unknown', unit: 'ACU', basis: 'no_native_per_task_limit'}},
    evidence_requirements: {independent_readback: true, content_sha256: hash, source_manifest_sha256: 'a'.repeat(64)},
    readback: {action: 'get_messages', capability: 'read_agent_messages', tool_schema_sha256: 'd'.repeat(64),
      arguments_sha256: readHash, cost_contract_sha256: 'e'.repeat(64), project_url: project,
      object_ref: 'submitted-source:' + hash,
      cost_upper_bound: {status: 'unknown', unit: 'ACU', basis: 'no_native_per_task_limit'}, max_calls: 2},
    result_contract: {kind: 'provider_task_message', version: 1,
      source_url: 'https://github.com/VioletShores/athena/blob/' + '1'.repeat(40) + '/docs/pebble-reviewed-fixture.md',
      retrieved_at: new Date().toISOString(), provider_project_id: 'robzag/athena-pebble-b1-feasibility~07', read_argument_binding: readBinding}
  };
  op.async_credit_risk = {
    mode: 'owner_accepted_unstoppable_agent', provider: 'flux_ai', account: 'robzag',
    project_url: project, billing_mode: 'on_demand',
    observed_monthly_spend_limit_usd: '500.00', observed_available_acus: 300,
    provider_task_spend_cap_enforced: false, provider_agent_stop_available: false,
    automatic_retries: false, evidence_kind: 'owner_account_settings_ui_observation',
    observed_at: new Date().toISOString(), owner_acceptance: 'fresh_exact_operation_vac_required',
    payer_binding: {type: 'provider_project_owner_billing_rule',
      status: 'owner_observed_recheck_required', project_owner: 'robzag', billing_account: 'robzag',
      source_url: 'https://docs.flux.ai/account/copilot-credits', observed_at: new Date().toISOString(),
      oauth_subject_verified: false, fresh_provider_owner_recheck_required: true}
  };
  change(op);
  function ordered(value) {
    if (Array.isArray(value)) return value.map(ordered);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, ordered(value[k])]));
  }
  op.cost_contract_sha256 = crypto.createHash('sha256').update(JSON.stringify(ordered(op.async_credit_risk))).digest('hex');
  return serviceFixture(op, options);
}

function asyncTaskFixture(change = () => {}, options = {}) {
  return taskFixture(change, options);
}

test('on-demand task review discloses actual owner-observed billing and UNKNOWN agent cost', async () => {
  const {h, receive, raw, state} = asyncTaskFixture();
  h.window.VACVaultHandoff.onVerified(FULL, {}); receive(); await settleReview();
  assert.ok(h.byId.vacServiceOperationConfirm, 'valid typed v2 disclosure must reach review');
  const text = allText(h.byId.vacServiceOperationReview);
  assert.match(text, /start one Flux design task/);
  assert.match(text, /On-demand enabled/);
  assert.match(text, /500.00 USD — account-wide, NOT a cap on this task/);
  assert.match(text, /300 ACUs/);
  assert.match(text, /Whole-job and per-task upper bound: Unknown/);
  assert.match(text, /NO enforced stop/);
  assert.match(text, /Flux bills the project owner: robzag \(observed\); Athena must recheck/);
  assert.match(text, /OAuth subject: Not used as payer proof/);
  assert.match(text, /one create_thread only/);
  assert.doesNotMatch(text, /Spend ceiling: 0|Cost upper bound: 0|guaranteed free task|On-demand charging was observed disabled/);
  assert.ok(text.includes(raw));
  assert.equal(h.fetches.length, 0);
  h.byId.vacServiceOperationConfirm.listeners.click(); await flush(); await flush();
  assert.equal(h.fetches.length, 1);
  assert.equal(h.fetches[0].body.handoff.nonce, state);
});

const asyncFaults = {
  fields: o => o.async_credit_risk.ignored = true,
  mode: o => o.async_credit_risk.mode = 'guaranteed_free',
  provider: o => o.async_credit_risk.provider = 'other',
  project: o => o.async_credit_risk.project_url = 'https://www.flux.ai/foreign/project',
  account: o => o.async_credit_risk.account = '',
  billingMode: o => o.async_credit_risk.billing_mode = 'off',
  monthlyLimit: o => o.async_credit_risk.observed_monthly_spend_limit_usd = 'unlimited',
  noNumericBalance: o => o.async_credit_risk.observed_available_acus = '300',
  negativeBalance: o => o.async_credit_risk.observed_available_acus = -1,
  taskCapClaim: o => o.async_credit_risk.provider_task_spend_cap_enforced = true,
  stopClaim: o => o.async_credit_risk.provider_agent_stop_available = true,
  retries: o => o.async_credit_risk.automatic_retries = true,
  evidenceKind: o => o.async_credit_risk.evidence_kind = 'provider_guaranteed',
  observedAtMissing: o => o.async_credit_risk.observed_at = '',
  staleObservation: o => o.async_credit_risk.observed_at = new Date(Date.now() - 960001).toISOString(),
  futureObservation: o => o.async_credit_risk.observed_at = new Date(Date.now() + 60000).toISOString(),
  ownerAcceptance: o => o.async_credit_risk.owner_acceptance = 'automatic',
  payerClaim: o => o.async_credit_risk.payer_binding.status = 'verified',
  payerSource: o => o.async_credit_risk.payer_binding.source_url = 'https://evil.invalid',
  payerOwner: o => o.async_credit_risk.payer_binding.project_owner = 'other',
  payerAccount: o => o.async_credit_risk.payer_binding.billing_account = 'other',
  payerOAuthClaim: o => o.async_credit_risk.payer_binding.oauth_subject_verified = true,
  payerNoRecheck: o => o.async_credit_risk.payer_binding.fresh_provider_owner_recheck_required = false,
  payerStale: o => o.async_credit_risk.payer_binding.observed_at = new Date(Date.now() - 1000000).toISOString(),
  payerExtra: o => o.async_credit_risk.payer_binding.extra = true,
  envelopeNumeric: o => o.resource_envelope.cost_upper_bound = {amount: '0', unit: 'ACU'},
  envelopeBasis: o => o.resource_envelope.cost_upper_bound.basis = 'verified_free',
  envelopeAllowance: o => o.resource_envelope.spend_ceiling.status = 'bounded',
  paidRead: o => o.readback.cost_upper_bound = {amount: '1', unit: 'ACU'}
};
for (const [name, change] of Object.entries(asyncFaults)) {
  test('async disclosure refuses changed scope or overstated certainty: ' + name, async () => {
    const {h, receive} = asyncTaskFixture(change);
    h.window.VACVaultHandoff.onVerified(FULL, {}); receive(); await settleReview();
    assert.equal(h.byId.vacServiceOperationConfirm, undefined);
    assert.equal(h.fetches.length, 0);
  });
}

test('generic positive account-limit amount is disclosed without claiming task enforcement', async () => {
  const {h, receive} = asyncTaskFixture(op => {
    op.async_credit_risk.observed_monthly_spend_limit_usd = '600.00';
  });
  h.window.VACVaultHandoff.onVerified(FULL, {}); receive(); await settleReview();
  assert.ok(h.byId.vacServiceOperationConfirm, 'browser may display; server tenant policy decides');
  const text = allText(h.byId.vacServiceOperationReview);
  assert.match(text, /600.00 USD — account-wide, NOT a cap on this task/);
  assert.equal(h.fetches.length, 0);
});

test('owner-observed project-owner billing remains subject to authenticated pre-effect recheck', async () => {
  const {h, receive} = asyncTaskFixture();
  h.window.VACVaultHandoff.onVerified(FULL, {}); receive(); await settleReview();
  assert.ok(h.byId.vacServiceOperationConfirm, 'typed owner-observed risk can be reviewed');
  const text = allText(h.byId.vacServiceOperationReview);
  assert.match(text, /Flux bills the project owner: robzag \(observed\); Athena must recheck/);
  assert.match(text, /OAuth subject: Not used as payer proof/);
  assert.doesNotMatch(text, /payer guaranteed|provider guarantees a stop|OAuth subject verified/);
  assert.equal(h.fetches.length, 0);
});

test('async confirmation preserves one mint and remains inert after acknowledgement', async () => {
  const {h, receive, state} = asyncTaskFixture();
  h.window.VACVaultHandoff.onVerified(FULL, {}); receive(); await settleReview();
  const confirm = h.byId.vacServiceOperationConfirm;
  assert.ok(confirm);
  confirm.listeners.click(); confirm.listeners.click(); await flush(); await flush();
  assert.equal(h.fetches.length, 1);
  h.listeners.message[0]({origin: VAULT, source: h.op, data: {type: 'vac-vault-handoff-ack', state}});
  confirm.listeners.click(); receive(); await settleReview();
  assert.equal(h.fetches.length, 1);
});

test('v2 task review names design commencement, exact source and limited readback before consent', async () => {
  const {h, receive, raw, state} = taskFixture();
  receive(); await settleReview();
  assert.equal(h.byId.vacServiceOperationConfirm, undefined, 'intent alone is not identity');
  h.window.VACVaultHandoff.onVerified(FULL, {}); receive(); await settleReview();
  assert.ok(h.byId.vacServiceOperationConfirm, 'valid v2 must reach exact review');
  const text = allText(h.byId.vacServiceOperationReview);
  assert.match(text, /start one Flux design task/);
  assert.match(text, /may consume Flux credits/);
  assert.match(text, /not proof that a schematic is finished/);
  assert.doesNotMatch(text, /does not start design work/);
  assert.ok(text.includes('pebble-reviewed-fixture.md'));
  assert.ok(text.includes('Submission and readback deadline: 5 minutes'));
  assert.ok(text.includes('On-demand enabled (owner-observed settings)'));
  assert.ok(text.includes('Athena must recheck authenticated project ownership before execution'));
  assert.ok(text.includes(raw));
  assert.equal(h.fetches.length, 0);
  h.byId.vacServiceOperationConfirm.listeners.click(); await flush(); await flush();
  assert.equal(h.fetches.length, 1);
  assert.deepEqual(h.fetches[0].body.handoff, {audience: 'athena:l0:service-operation', nonce: state});
  assert.ok(h.posted.every(x => !x.m.intent_json && !x.m.session_token));
});

const taskFaults = {
  version: o => o.version = 3,
  extra: o => o.unreviewed = true,
  capability: o => o.capability = 'read_file',
  action: o => o.action = 'send_message',
  tools: o => o.allowed_tools.push('delete_project'),
  endpoint: o => o.endpoint = 'https://evil.invalid/mcp',
  project: o => o.project_url = 'https://www.flux.ai/foreign/project',
  digest: o => o.content_sha256 = 'bad',
  coercedDigest: o => o.arguments_sha256 = ['c'.repeat(64)],
  controlText: o => o.executor = 'fixture\u202eexecutor',
  object: o => o.object_ref = 'other',
  revocation: o => o.revocation_ref = 'execution:other',
  risk: o => o.risk = 2,
  sessionBudget: o => o.constraints.connection_budget = 1,
  scope: o => o.constraints.write_scope.push('other'),
  purchase: o => o.constraints.financial_transaction = true,
  turns: o => o.resource_envelope.max_turns = 2,
  deadline: o => o.resource_envelope.max_minutes = 0,
  negativeCost: o => o.resource_envelope.cost_upper_bound.status = 'negative',
  excessiveCost: o => o.resource_envelope.cost_upper_bound.status = 'enforced',
  readCost: o => o.readback.cost_upper_bound.status = 'enforced',
  units: o => o.readback.cost_upper_bound.unit = 'USD',
  independent: o => o.evidence_requirements.independent_readback = false,
  evidence: o => o.evidence_requirements.content_sha256 = 'a'.repeat(64),
  readCapability: o => o.readback.capability = 'read_file',
  readTarget: o => o.readback.project_url = 'https://www.flux.ai/foreign/project',
  readLimit: o => o.readback.max_calls = 1,
  readDigest: o => o.readback.arguments_sha256 = 'a'.repeat(64),
  coercedReadDigest: o => o.readback.tool_schema_sha256 = ['d'.repeat(64)],
  metric: o => o.result_contract.kind = 'schematic_verified',
  resultVersion: o => o.result_contract.version = 2,
  resultExtra: o => o.result_contract.schematic_verified = true,
  source: o => o.result_contract.source_url = 'https://github.com/VioletShores/athena/blob/main/mutable.md',
  time: o => o.result_contract.retrieved_at = '2026-11-16T10:00:00',
  providerOwner: o => o.result_contract.provider_project_id = 'foreign/project',
  readDerivation: o => o.result_contract.read_argument_binding.get_thread.thread.from_execute = 'caller_supplied',
  pagination: o => o.result_contract.read_argument_binding.get_messages.limit = 100
};
for (const [name, change] of Object.entries(taskFaults)) {
  test('v2 refuses malformed or broader operation: ' + name, async () => {
    const {h, receive} = taskFixture(change);
    h.window.VACVaultHandoff.onVerified(FULL, {}); receive(); await settleReview();
    assert.equal(h.byId.vacServiceOperationConfirm, undefined);
    assert.equal(h.fetches.length, 0);
  });
}

test('v2 still rejects wrong actor, foreign opener, expiry and changed intent', async () => {
  for (const fault of ['actor', 'origin', 'source', 'expiry', 'changed']) {
    const {h, receive, message} = taskFixture(o => {
      if (fault === 'actor') o.actor = 'foreign@example.invalid';
      if (fault === 'expiry') o.expiry = new Date(Date.now() - 1000).toISOString();
    });
    h.window.VACVaultHandoff.onVerified(FULL, {});
    receive(fault === 'origin' ? {origin: 'https://evil.invalid'} : fault === 'source' ? {source: {}} : {});
    await settleReview();
    if (fault === 'changed') {
      assert.ok(h.byId.vacServiceOperationConfirm);
      receive({data: {...message, intent_json: message.intent_json + ' '}}); await settleReview();
    }
    assert.equal(h.byId.vacServiceOperationConfirm, undefined);
    assert.equal(h.fetches.length, 0);
  }
});

test('v2 rejects forged numeric credit bounds even if fractional', async () => {
  const {h, receive} = taskFixture(o => {
    o.resource_envelope.spend_ceiling.amount = '9007199254740992.1';
    o.resource_envelope.cost_upper_bound.amount = '9007199254740992.2';
  });
  h.window.VACVaultHandoff.onVerified(FULL, {}); receive(); await settleReview();
  assert.equal(h.byId.vacServiceOperationConfirm, undefined);
  assert.equal(h.fetches.length, 0);
});

test('service operation requires real FULL ceremony AND exact rendered intent AND explicit confirmation before mint', async () => {
  const {h, receive, raw, state} = serviceFixture();
  assert.equal(h.posted.length, 0, 'module is loaded in the head; no request or DOM before the real ceremony');
  receive(); await settleReview();
  assert.equal(h.byId.vacServiceOperationConfirm, undefined, 'intent alone cannot approve');
  h.window.VACVaultHandoff.onVerified(FULL, {}); receive(); await settleReview();
  assert.equal(h.posted[0].m.type, 'vac-service-operation-request');
  assert.equal(h.posted[0].o, VAULT);
  assert.equal(h.fetches.length, 0, 'FULL alone does not mint');
  assert.ok(allText(h.byId.vacServiceOperationReview).includes(raw));
  assert.ok(allText(h.byId.vacServiceOperationReview).includes('Spend ceiling: 0 USD'));
  assert.ok(allText(h.byId.vacServiceOperationReview).includes('Readback action: read_file'));
  assert.ok(allText(h.byId.vacServiceOperationReview).includes('Readback cost upper bound: 0 USD'));
  h.byId.vacServiceOperationConfirm.listeners.click(); await flush(); await flush();
  assert.equal(h.fetches.length, 1);
  assert.deepEqual(h.fetches[0].body.handoff, {audience: 'athena:l0:service-operation', nonce: state});
  assert.deepEqual(h.fetches[0].body.actions, ['service_operation']);
  assert.deepEqual(h.fetches[0].body.resources, ['athena:l0:service-operation']);
  assert.equal(h.fetches[0].body.agent_id, 'athena-l0-service-operation-handoff');
  assert.equal(h.posted.filter(x => x.m.assertion).length, 1);
});

test('operation cannot arrive from another origin, tab or digest; no raw operation or session is returned', async () => {
  const {h, receive, message} = serviceFixture();
  h.window.VACVaultHandoff.onVerified(FULL, {});
  receive({origin: 'https://evil.invalid'}); receive({source: {}});
  receive({data: {...message, state: 'f'.repeat(64)}});
  await settleReview();
  assert.equal(h.byId.vacServiceOperationConfirm, undefined); assert.equal(h.fetches.length, 0);
  assert.ok(h.posted.every(x => !x.m.intent_json && !x.m.session_token));
});

test('hash mismatch, malformed intent, oversized intent and wrong subject all refuse without mint', async () => {
  for (const value of ['{}', '{bad', 'x'.repeat(65537)]) {
    const {h, receive, message} = serviceFixture(); h.window.VACVaultHandoff.onVerified(FULL, {});
    receive({data: {...message, intent_json: value}}); await settleReview();
    assert.equal(h.fetches.length, 0); assert.equal(h.byId.vacServiceOperationConfirm, undefined);
  }
  const {h, receive} = serviceFixture({actor: 'different@example.invalid'});
  h.window.VACVaultHandoff.onVerified(FULL, {}); receive(); await settleReview();
  assert.equal(h.fetches.length, 0); assert.equal(h.byId.vacServiceOperationConfirm, undefined);
});

test('markup in approved operation values remains inert text and is visible in exact review', async () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const {h, receive} = serviceFixture({tenant_id: hostile});
  h.window.VACVaultHandoff.onVerified(FULL, {}); receive(); await settleReview();
  assert.ok(allText(h.byId.vacServiceOperationReview).includes(hostile));
  assert.equal(h.fetches.length, 0);
});

test('expired intent and partial ceremony cannot create service proof', async () => {
  const old = serviceFixture({expiry: new Date(Date.now() - 1000).toISOString()});
  old.h.window.VACVaultHandoff.onVerified(FULL, {}); old.receive(); await settleReview();
  assert.equal(old.h.byId.vacServiceOperationConfirm, undefined);
  for (const level of ['quick', 'otp']) {
    const {h, receive} = serviceFixture(); receive(); await settleReview();
    h.window.VACVaultHandoff.onVerified({...FULL, session: {...FULL.session, auth_level: level}}, {});
    assert.equal(h.byId.vacServiceOperationConfirm, undefined); assert.equal(h.fetches.length, 0);
  }
});

test('intent invalidation during hashing cannot resurrect an earlier result', async () => {
  const {h, receive, message} = serviceFixture();
  h.window.VACVaultHandoff.onVerified(FULL, {}); receive();
  receive({data: {...message, intent_json: '{invalid'}}); await settleReview();
  assert.equal(h.byId.vacServiceOperationConfirm, undefined); assert.equal(h.fetches.length, 0);
});

test('pre-approval ACK cannot terminate the operation review or report success', async () => {
  const {h, state, receive} = serviceFixture();
  h.listeners.message[0]({origin: VAULT, source: h.op, data: {type: 'vac-vault-handoff-ack', state}});
  h.window.VACVaultHandoff.onVerified(FULL, {}); receive(); await settleReview();
  assert.ok(h.byId.vacServiceOperationConfirm); assert.equal(h.closed, false);
  assert.equal(h.fetches.length, 0);
});

test('changed or failed verification while mint is pending invalidates consent and suppresses old proof', async () => {
  for (const later of [{authenticated: false}, {...FULL, session: {...FULL.session, email: 'different@example.invalid'}}]) {
    let resolve;
    const {h, receive} = serviceFixture({}, {authFetch: () => new Promise(r => { resolve = r; })});
    h.window.VACVaultHandoff.onVerified(FULL, {}); receive(); await settleReview();
    h.byId.vacServiceOperationConfirm.listeners.click();
    assert.equal(h.fetches.length, 1);
    h.window.VACVaultHandoff.onVerified(later, {});
    resolve({ok: true, status: 200, body: {compact_jwt: JWT, claims: {exp: Date.now()/1000 + 120}}});
    await flush(); await flush();
    assert.equal(h.posted.filter(x => x.m.assertion).length, 0);
    assert.equal(h.byId.vacServiceOperationConfirm, undefined);
  }
});

test('operation expiry during issuer network request prevents delivery', async () => {
  let resolve, now = Date.now();
  const {h, receive} = serviceFixture({}, {now: () => now, authFetch: () => new Promise(r => { resolve = r; })});
  h.window.VACVaultHandoff.onVerified(FULL, {}); receive(); await settleReview();
  h.byId.vacServiceOperationConfirm.listeners.click(); now += 121000;
  resolve({ok: true, status: 200, body: {compact_jwt: JWT, claims: {exp: Date.now()/1000 + 120}}});
  await flush(); await flush();
  assert.equal(h.posted.filter(x => x.m.assertion).length, 0);
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

test('Decisions confirmed acknowledgement names only the recorded receipt',async()=>{
  const h=load('?handoff=decisions-confirm&state='+STATE);offer(h);
  h.window.VACVaultHandoff.consumeChallenge({email:'owner@example.invalid'},true,false);
  h.window.VACVaultHandoff.onVerified(FULL,{});await flush();await flush();
  const ack={type:'vac-vault-handoff-ack',state:STATE,status:'confirmed'};
  for(const fn of h.listeners.message)fn({origin:'https://evil.invalid',source:h.op,data:ack});
  assert.doesNotMatch(h.byId.vacVaultHandoffMsg.textContent,/recorded the decision receipt/);
  for(const fn of h.listeners.message)fn({origin:VAULT,source:h.op,data:ack});
  assert.match(h.byId.vacVaultHandoffMsg.textContent,/Athena recorded the decision receipt/);
  for(const timer of h.timers)timer.f();
  assert.equal(h.closed,false);
});

