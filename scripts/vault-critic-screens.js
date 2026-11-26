// vault-critic-screens.js — screenshots of the Vault A2 critic-review panel
// (auth.html?handoff=critic-review) on phone and tablet, at three states:
// review shown, approval sent (no ack yet), and Athena acknowledged.
//
// Offline: every request is answered by page.route. vacprotocol.org is served
// from this checkout, the Athena opener is a stub page on its real origin (the
// handoff pins that origin), and /v1/vat/issue returns a dummy token. No
// production call, nothing leaves the machine.
//
// Run: node scripts/vault-critic-screens.js <vac-vault-handoff.js path> <out dir> <label>
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const HANDOFF = path.resolve(process.argv[2] || path.join(ROOT, 'vac-vault-handoff.js'));
const OUT = path.resolve(process.argv[3] || '.');
const LABEL = process.argv[4] || 'after';
const ATHENA = 'https://api.athenapilot.ai';
const VAC = 'https://vacprotocol.org';

// The legacy critic nonce, exactly as tests/vault-handoff.test.js computes it.
const operation_digest = 'b'.repeat(64), policy_sha256 = 'c'.repeat(64);
const STATE = crypto.createHash('sha256').update(JSON.stringify({
  operation_digest, policy_sha256, purpose: 'athena:l0:critic-review' })).digest('hex');
const PREVIEW = {
  packet_id: 42, kind: 'critic-review', audience: 'athena:l0:critic-review',
  state: STATE, operation_digest, policy_sha256, tenant_id: 'tenant-one',
  principal: 'person-owner', actor: 'owner@example.invalid',
  // The one project the handoff accepts (pinned in vac-vault-handoff.js).
  project_url: 'https://www.flux.ai/robzag/athena-pebble-b1-feasibility~07/schematic',
  source_sha256: '6a678dbbc359df3888790019ef4799f2198dee2273cd329edc1d5463868a4156',
  source_bytes: 40304, canonical_plan_rows: 113, source_confidential: true,
  external_source_disclosure: 'full_canonical_plan_and_source_scope',
  reviewers: [
    { provider: 'openai', model: 'gpt-fixture', model_family: 'openai_gpt', provider_tier: 'paid_api',
      data_training_posture: 'owner_verified_no_training', evidence_url: 'https://openai.com/enterprise-privacy',
      processing_jurisdiction: 'global_unverified', retention_posture: 'provider_default_disclosed' },
    { provider: 'groq', model: 'qwen-fixture', model_family: 'qwen', provider_tier: 'paid_api',
      data_training_posture: 'owner_verified_no_training', evidence_url: 'https://groq.com/privacy',
      processing_jurisdiction: 'global_unverified', retention_posture: 'zdr_verified' }
  ],
  orchestrate_mode: 'collect_only', reviewer_call_limit: 2, synthesis_vendor_allowed: false,
  max_tokens_per_provider: 16384, approved_total_usd: '20.00',
  owner_accepted_external_disclosure: true, owner_accepted_unverified_residency: true,
  provider_hard_cost_cap_enforced: false, automatic_retries: false,
  routing_posture: 'owner_approved_tier_default_after_calibration_expired',
  expiry: new Date(Date.now() + 30 * 60000).toISOString(),
  ready_for_owner_critic_vac: true, review_submission_started: false
};
const FULL = { authenticated: true, session_token: 'sess.sig',
  biometric_verification: { overall_score: 0.93 },
  session: { auth_level: 'full', email: 'Owner@Example.invalid', token: 'sess.sig' } };

const OPENER = `<!doctype html><meta charset=utf-8><title>Athena stub</title>
<button id=open>open</button><script>
window.got = [];
var child;
document.getElementById('open').onclick = function () {
  child = window.open(${JSON.stringify(VAC + '/auth.html?handoff=critic-review&state=' + STATE)}, 'vac');
};
window.addEventListener('message', function (ev) {
  if (ev.origin !== ${JSON.stringify(VAC)}) return;
  window.got.push(ev.data && ev.data.type);
  if (ev.data && ev.data.type === 'vac-critic-review-request')
    child.postMessage({ type: 'vac-critic-review-preview', state: ${JSON.stringify(STATE)},
      preview: ${JSON.stringify(PREVIEW)} }, ${JSON.stringify(VAC)});
});
window.ack = function () {
  child.postMessage({ type: 'vac-vault-handoff-ack', state: ${JSON.stringify(STATE)} }, ${JSON.stringify(VAC)});
};
</script>`;

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.onnx': 'application/octet-stream' };

async function route(r) {
  const url = new URL(r.request().url());
  if (url.origin === ATHENA && url.pathname === '/opener') return r.fulfill({ contentType: 'text/html', body: OPENER });
  if (url.pathname === '/v1/vat/issue') {
    return r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ compact_jwt: 'aaa.bbb.ccc', claims: { exp: Math.floor(Date.now() / 1000) + 120 } }) });
  }
  if (url.origin === VAC) {
    const file = url.pathname === '/vac-vault-handoff.js' ? HANDOFF : path.join(ROOT, decodeURIComponent(url.pathname));
    if (file.startsWith(ROOT) || file === HANDOFF) {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        return r.fulfill({ contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
      }
    }
  }
  return r.abort();
}

async function shoot(browser, name, device) {
  const context = await browser.newContext({ ...device });
  await context.route('**/*', route);
  const opener = await context.newPage();
  await opener.goto(ATHENA + '/opener');
  const [page] = await Promise.all([context.waitForEvent('page'), opener.click('#open')]);
  await page.waitForLoadState('load');
  await page.waitForFunction(() => window.VACVaultHandoff);
  // auth.html's own success path, as after a server-verified FULL ceremony.
  await page.evaluate((full) => {
    document.getElementById('inputEmail').value = full.session.email;
    document.getElementById('inputName').value = 'Owner';
    authResult = full; goToStep(4); showSuccess();
  }, FULL);
  try { await page.waitForSelector('#vacCriticReviewConfirm', { timeout: 8000 }); }
  catch (e) {
    const why = await page.evaluate(() => (document.getElementById('vacVaultHandoff') || {}).textContent);
    throw new Error('critic review did not render: ' + why + ' | opener got ' +
      JSON.stringify(await opener.evaluate(() => window.got)));
  }
  const shots = [];
  const snap = async (state) => {
    const file = path.join(OUT, `${LABEL}-${name}-${state}.png`);
    await page.screenshot({ path: file });
    const box = await page.evaluate(() => {
      const panel = document.getElementById('vacVaultHandoff').getBoundingClientRect();
      const visible = Array.from(document.querySelectorAll('#vacVaultHandoff button, #vacCriticReviewSent'))
        .filter(b => b.offsetParent !== null);
      const last = visible.length ? visible[visible.length - 1] : null;
      return { viewportH: innerHeight, panelBottom: panel.bottom,
        lastAction: last ? (last.id || last.textContent.slice(0, 40)) : null,
        lastActionGapPx: last ? Math.round(innerHeight - last.getBoundingClientRect().bottom) : null,
        approveButtonVisible: !!(document.getElementById('vacCriticReviewConfirm') &&
          document.getElementById('vacCriticReviewConfirm').offsetParent !== null) };
    });
    shots.push({ state, file: path.relative(ROOT, file), ...box });
  };
  // 1. Review, scrolled so the approval button is in view.
  await page.evaluate(() => { const b = document.getElementById('vacCriticReview'); b.scrollTop = b.scrollHeight; });
  await snap('1-review');
  // 2. Approve: mint (stubbed) and postMessage to the opener; no ack yet.
  await page.click('#vacCriticReviewConfirm');
  await opener.waitForFunction(() => window.got.includes('vac-vault-handoff'));
  await page.evaluate(() => { const b = document.getElementById('vacCriticReview'); b.scrollTop = b.scrollHeight; });
  await snap('2-sent');
  // 3. Athena acknowledges.
  await opener.evaluate(() => window.ack());
  await page.waitForFunction(() => /Athena received/.test(document.getElementById('vacVaultHandoffMsg').textContent));
  await page.evaluate(() => { const b = document.getElementById('vacCriticReview'); b.scrollTop = b.scrollHeight; });
  await snap('3-acked');
  await context.close();
  return shots;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const out = [];
  for (const [name, device] of [['iphone13', devices['iPhone 13']], ['ipad', devices['iPad (gen 7)']]]) {
    out.push(...await shoot(browser, name, device));
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
