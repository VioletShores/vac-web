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
  const op = opener === 'present' ? { closed: false, focused: false, focus() { this.focused = true; }, postMessage: (m, o) => posted.push({ m, o }) } : null;
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


function nativeFixture(change = () => {}) {
  const op = JSON.parse(fs.readFileSync(path.join(__dirname, 'native-operation-fixture.json'), 'utf8'));
  change(op);
  return serviceFixture(op);
}
function allText(node) { return String(node.textContent || '') + (node.children || []).map(allText).join(' '); }
async function showNative(f) { f.h.window.VACVaultHandoff.onVerified(FULL, {}); await flush(); f.receive(); await settleReview(); return f; }

test('Python v3 cost commitment is accepted by mounted native browser disclosure', async () => {
  const f = await showNative(nativeFixture());
  assert.ok(f.h.byId.vacServiceOperationConfirm);
  const body = allText(f.h.byId.vacServiceOperationReview);
  assert.match(body, /11 additional tool calls/);
  assert.match(body, /four total MCP sessions/);
  assert.match(body, /Unknown ACU cost/);
  assert.match(body, /five-minute permit/);
  assert.match(body, /no second submission/);
  assert.match(body, /electrical correctness and source coverage remain unverified/);
  assert.equal(f.h.fetches.length, 0);
  f.h.byId.vacServiceOperationConfirm.listeners.click();
  await flush(); await flush();
  assert.equal(f.h.fetches.length, 1);
  assert.equal(f.h.fetches[0].body.handoff.audience, 'athena:l0:service-operation');
  assert.equal(f.h.fetches[0].body.handoff.nonce, f.state);
});

const faults = {
  scopeRemoved: p => delete p.artifact_observation,
  legacyDowngrade: p => p.version = 2,
  unknownVersion: p => p.version = 4,
  extraScope: p => p.artifact_observation.extra = true,
  extraCall: p => p.artifact_observation.additional_tool_call_limit = 12,
  extraPoll: p => p.artifact_observation.max_polls = 4,
  extraSession: p => p.constraints.connection_budget = 5,
  extraTool: p => p.allowed_tools.push('send_message'),
  changedToolSchema: p => p.artifact_observation.tool_schemas.get_nets.input_sha256 = 'a'.repeat(64),
  wrongTenant: p => p.artifact_observation.connection.tenant_id = 'another-tenant',
  wrongAccount: p => p.artifact_observation.connection.account_id = 'another-account',
  wrongProject: p => p.artifact_observation.project_url = 'https://example.invalid/project',
  expiryExtension: p => p.artifact_observation.expiry = new Date(Date.now() + 86400000).toISOString(),
  retries: p => p.artifact_observation.automatic_retries = true,
  effectReuse: p => p.artifact_observation.effect_replay_permitted = true,
  costZero: p => p.artifact_observation.read_cost = {status:'known',unit:'ACU',amount:'0'},
  oldCostHash: p => { p.cost_contract_sha256 = 'b'.repeat(64); p.readback.cost_contract_sha256 = p.cost_contract_sha256; },
  changedRiskWithoutCostRebinding: p => p.async_credit_risk.observed_available_acus += 1,
  newConnectionWithoutCostRebinding: p => p.artifact_observation.connection.client_generation += 1,
};
for (const [name, mutate] of Object.entries(faults)) {
  test('native v3 refuses expanded or mismatched scope before consent: '+name, async () => {
    const f = await showNative(nativeFixture(mutate));
    assert.equal(f.h.byId.vacServiceOperationConfirm, undefined);
    assert.equal(f.h.fetches.length, 0);
  });
}

test('native v3 historical observations remain explicitly historical; backend admission still required', async () => {
  const f = nativeFixture(p => {
    p.async_credit_risk.observed_at = new Date(Date.now() - 86400000).toISOString();
    p.async_credit_risk.payer_binding.observed_at = p.async_credit_risk.observed_at;
    function sorted(v) { if (Array.isArray(v)) return v.map(sorted); if (!v || typeof v !== 'object') return v; return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])); }
    const cost = {version:1, kind:'native_submission_and_bounded_design_observation', async_credit_risk:p.async_credit_risk,artifact_observation:p.artifact_observation};
    p.cost_contract_sha256 = crypto.createHash('sha256').update(JSON.stringify(sorted(cost))).digest('hex');
    p.readback.cost_contract_sha256 = p.cost_contract_sha256;
  });
  await showNative(f);
  assert.ok(f.h.byId.vacServiceOperationConfirm);
  assert.match(allText(f.h.byId.vacServiceOperationReview), /Original observation times are preserved/);
  assert.equal(f.h.fetches.length, 0);
});
