'use strict';
// vault-operation-review-layout.test.js — S206: the post-biometric operation review
// must stay readable on a host page that resets every margin (auth.html:54).
// Renders the real module in Chromium at iPad width, through the real opener flow
// (Vault origin opens the VAC page and posts the exact intent), with sample data.
//
// Run: node --test tests/vault-operation-review-layout.test.js
// Needs the `playwright` package and a Chromium (PLAYWRIGHT_CHROMIUM overrides the path).
// Network is fully intercepted: nothing leaves the machine.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let chromium = null;
for (const mod of ['playwright', '/opt/node22/lib/node_modules/playwright', '/opt/node-tools/node_modules/playwright']) {
  try { chromium = require(mod).chromium; break; } catch (_) {}
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'vac-vault-handoff.js'), 'utf8');
const AUTH = fs.readFileSync(path.join(__dirname, '..', 'auth.html'), 'utf8');
const VAULT = 'https://api.athenapilot.ai';
const VAC = 'https://vacprotocol.org';
const OBS_DOMAIN = 'athena:l0:service-operation:observation-context:1';

function ordered(v) {
  if (Array.isArray(v)) return v.map(ordered);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])]));
}

// The same valid Flux v2 task fixture as vault-handoff.test.js (sample data).
function intent() {
  const project = 'https://www.flux.ai/robzag/athena-pebble-b1-feasibility~07/schematic';
  const hash = 'b'.repeat(64);
  const readBinding = { get_thread: { thread: { from_execute: 'thread_url' } },
    get_messages: { thread: { from_execute: 'thread_url' }, offset: 0, limit: 20 } };
  const readHash = crypto.createHash('sha256').update('{"get_messages":{"limit":20,"offset":0,"thread":{"from_execute":"thread_url"}},"get_thread":{"thread":{"from_execute":"thread_url"}}}').digest('hex');
  const now = new Date().toISOString();
  const op = {
    version: 2, purpose: 'service-operation', execution_id: 'sample-execution', packet_id: 'sample-packet',
    actor: 'owner@example.invalid', principal: 'person-owner', tenant_id: 'tenant-one', service_id: 'flux',
    endpoint: 'https://app.flux.ai/mcp', capability: 'submit_agent_task', project_url: project,
    object_ref: 'submitted-source:' + hash, action: 'create_thread', executor: 'sample-native-executor',
    expiry: new Date(Date.now() + 600000).toISOString(), revocation_ref: 'execution:sample-execution', risk: 0.5,
    content_sha256: hash, source_manifest_sha256: 'a'.repeat(64), arguments_sha256: 'c'.repeat(64),
    tool_schema_sha256: 'd'.repeat(64), cost_contract_sha256: 'e'.repeat(64), service_manifest_sha256: 'f'.repeat(64),
    allowed_tools: ['get_project', 'create_thread', 'get_thread', 'get_messages'],
    constraints: { network_allowlist: ['app.flux.ai'], write_scope: [project], financial_transaction: false, connection_budget: 3 },
    resource_envelope: { max_turns: 1, max_minutes: 5,
      spend_ceiling: { status: 'unknown', unit: 'ACU', basis: 'no_native_per_task_limit' },
      cost_upper_bound: { status: 'unknown', unit: 'ACU', basis: 'no_native_per_task_limit' } },
    evidence_requirements: { independent_readback: true, content_sha256: hash, source_manifest_sha256: 'a'.repeat(64) },
    readback: { action: 'get_messages', capability: 'read_agent_messages', tool_schema_sha256: 'd'.repeat(64),
      arguments_sha256: readHash, cost_contract_sha256: 'e'.repeat(64), project_url: project,
      object_ref: 'submitted-source:' + hash,
      cost_upper_bound: { status: 'unknown', unit: 'ACU', basis: 'no_native_per_task_limit' }, max_calls: 2 },
    result_contract: { kind: 'provider_task_message', version: 1,
      source_url: 'https://github.com/VioletShores/athena/blob/' + '1'.repeat(40) + '/docs/sample-fixture.md',
      retrieved_at: now, provider_project_id: 'robzag/athena-pebble-b1-feasibility~07', read_argument_binding: readBinding }
  };
  op.async_credit_risk = {
    mode: 'owner_accepted_unstoppable_agent', provider: 'flux_ai', account: 'robzag',
    project_url: project, billing_mode: 'on_demand',
    observed_monthly_spend_limit_usd: '500.00', observed_available_acus: 300,
    provider_task_spend_cap_enforced: false, provider_agent_stop_available: false,
    automatic_retries: false, evidence_kind: 'owner_account_settings_ui_observation',
    observed_at: now, owner_acceptance: 'fresh_exact_operation_vac_required',
    payer_binding: { type: 'provider_project_owner_billing_rule',
      status: 'owner_observed_recheck_required', project_owner: 'robzag', billing_account: 'robzag',
      source_url: 'https://docs.flux.ai/account/copilot-credits', observed_at: now,
      oauth_subject_verified: false, fresh_provider_owner_recheck_required: true }
  };
  op.cost_contract_sha256 = crypto.createHash('sha256').update(JSON.stringify(ordered(op.async_credit_risk))).digest('hex');
  const raw = JSON.stringify(op);
  const digest = crypto.createHash('sha256').update(raw).digest('hex');
  const ctx = JSON.stringify(ordered({ version: 'athena.flux.observation-context/1', operation_digest: digest,
    observation_policy: { version: 1, mode: 'max_age', max_age_seconds: 900 }, policy_sha256: 'a'.repeat(64) }));
  const ctxSha = crypto.createHash('sha256').update(ctx).digest('hex');
  const state = crypto.createHash('sha256').update(OBS_DOMAIN + '\n' + digest + '\n' + ctxSha).digest('hex');
  return { state, message: { type: 'vac-service-operation-intent', state, intent_json: raw,
    observation_context_json: ctx, server_now: now, server_now_age_ms: 0 } };
}

// The host carries auth.html's own reset rule, copied from the file, not retyped.
function hostPage() {
  const reset = AUTH.match(/\*\s*\{\s*margin\s*:\s*0;[^}]*\}/)[0];
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>' + reset + ' body{font:15px/1.6 system-ui;background:#0D0F17;color:#C9CED8}</style></head>' +
    '<body><main>sample host</main><script src="/vac-vault-handoff.js"></script></body></html>';
}

async function openReview(t) {
  const { state, message } = intent();
  const opener = '<!doctype html><html><body><script>window.addEventListener("message",function(e){' +
    'if(e.data&&e.data.type==="vac-service-operation-request")e.source.postMessage(' + JSON.stringify(message) + ',"' + VAC + '");});</script></body></html>';
  const opts = process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {};
  const browser = await chromium.launch(opts);
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 820, height: 1180 } });
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin === VAULT && u.pathname === '/opener.html') return route.fulfill({ status: 200, contentType: 'text/html', body: opener });
    if (u.origin === VAC && u.pathname === '/host.html') return route.fulfill({ status: 200, contentType: 'text/html', body: hostPage() });
    if (u.origin === VAC && u.pathname === '/vac-vault-handoff.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: SRC });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  const page = await context.newPage();
  await page.goto(VAULT + '/opener.html');
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.evaluate(url => { window.open(url, 'vac'); }, VAC + '/host.html?handoff=service-operation&state=' + state),
  ]);
  await popup.waitForLoadState('load');
  await popup.waitForFunction(() => window.VACVaultHandoff);
  await popup.evaluate(() => window.VACVaultHandoff.onVerified({ authenticated: true, session_token: 'sess.sig',
    session: { auth_level: 'full', email: 'owner@example.invalid', token: 'sess.sig' } }, {}));
  await popup.waitForSelector('#vacServiceOperationReview p', { timeout: 10000 });
  return popup;
}

test('rows are visibly separate on iPad despite the host margin reset', { skip: !chromium }, async t => {
  const page = await openReview(t);
  const rows = await page.$$eval('#vacServiceOperationReview > p', ps => ps.slice(1).map(p => {
    const r = p.getBoundingClientRect(), s = getComputedStyle(p);
    return { top: r.top, bottom: r.bottom, pad: parseFloat(s.paddingTop) + parseFloat(s.paddingBottom),
      border: parseFloat(s.borderBottomWidth), text: p.textContent };
  }));
  assert.ok(rows.length >= 20, 'every field is its own row');
  for (const r of rows) {
    assert.ok(r.pad >= 12, 'row keeps vertical padding under the reset: ' + r.text.slice(0, 40));
    assert.ok(r.border >= 1, 'row has a visible divider: ' + r.text.slice(0, 40));
  }
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].top >= rows[i - 1].bottom - 0.5, 'rows never overlap');
  const summaryGap = await page.$eval('#vacServiceOperationReview', box => {
    const ps = box.querySelectorAll(':scope > p');
    return ps[1].getBoundingClientRect().top - ps[0].getBoundingClientRect().bottom;
  });
  assert.ok(summaryGap >= 8, 'the summary is separated from the first field');
});

test('long values wrap inside the box; multi-line values keep their line breaks', { skip: !chromium }, async t => {
  const page = await openReview(t);
  const overflow = await page.$eval('#vacServiceOperationReview', box =>
    [...box.querySelectorAll(':scope > p')].filter(p => p.scrollWidth > p.clientWidth + 1).map(p => p.textContent.slice(0, 40)));
  assert.deepEqual(overflow, [], 'no row overflows horizontally (64-character hashes wrap)');
  // Field values are textContent; a value containing newlines must render on
  // separate lines, not run together, and must never be parsed as HTML.
  const probe = await page.$eval('#vacServiceOperationReview > p:nth-of-type(3)', p => {
    const clone = p.cloneNode(false);
    clone.textContent = 'Multi-line value: first line\nsecond line\n<b>not markup</b>';
    p.parentNode.appendChild(clone);
    const lineHeight = parseFloat(getComputedStyle(clone).lineHeight) || 20;
    const out = { lines: Math.round((clone.getBoundingClientRect().height - parseFloat(getComputedStyle(clone).paddingTop) -
      parseFloat(getComputedStyle(clone).paddingBottom)) / lineHeight), bold: clone.querySelectorAll('b').length };
    clone.remove();
    return out;
  });
  assert.ok(probe.lines >= 3, 'newlines are preserved (pre-wrap), got ' + probe.lines + ' line(s)');
  assert.equal(probe.bold, 0, 'text is never parsed as HTML');
});
