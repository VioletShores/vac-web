// Offline, explicitly simulated visual check for vac-web narration result return.
// All pages and API responses below are fulfilled by Playwright routing.
// No real identity, media, production session, provider or external request is used.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const source = fs.readFileSync(path.join(__dirname, '..', 'vac-vault-handoff.js'), 'utf8');
const sourceSha256 = crypto.createHash('sha256').update(source).digest('hex');
const ceremony = fs.readFileSync(path.join(__dirname, '..', 'vac-reauth-ceremony.js'), 'utf8');
const ceremonySha256 = crypto.createHash('sha256').update(ceremony).digest('hex');
const faceStageSource = ceremony.slice(ceremony.indexOf('function _vacFaceStageShow()'), ceremony.indexOf('function _createVaultFaceStageGate('));
assert(faceStageSource.includes('function _vacFaceStageHide()'));
const STATE = 'S'.repeat(43);
const ATHENA = 'https://api.athenapilot.ai';
const VAC = 'https://vac.fixture.invalid';
const out = path.join(__dirname, '..', 'artifacts', 'narration-review-layout');
fs.mkdirSync(out, { recursive: true });

// Native report markup follows auth.html's existing successModalities parent.
// Report data is deliberately fictional and does not claim biometric verification.
const fixture = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SIMULATED PR49 layout fixture</title><style>
*{box-sizing:border-box}body{margin:0;background:#0d0f17;color:#e8edf5;font:16px/1.5 system-ui}
main{max-width:520px;padding:20px;margin:auto}aside{border:2px dashed #d4a94e;padding:10px}
summary{padding:12px;cursor:pointer;background:#1a2030;border:1px solid #334155;border-radius:8px}
li{padding:14px 0;border-bottom:1px solid #334155}button:focus-visible,summary:focus-visible{outline:3px solid #facc15;outline-offset:3px}
</style><main id="step4"><aside>SIMULATED FIXTURE — no biometric capture or real verification.</aside>
<h1>Verification report layout</h1><p>Fictional data tests only the handoff controls and report access.</p>
<p style="height:300px">Existing page content</p>
<details><summary>How we authenticated you</summary><div id="successModalities"><ul>
<li>Fixture report row A — synthetic display data</li><li>Fixture report row B — synthetic display data</li>
<li>Fixture report row C — synthetic display data</li></ul></div></details>
<p>End of simulated report</p></main>
<script>var API_BASE=${JSON.stringify(VAC)};</script><script>${source}</script>
<script>VACVaultHandoff.onVerified({authenticated:true,session_token:'fixture-only-not-valid',session:{auth_level:'full',email:'fixture@example.invalid'}},{});</script>`;

(async () => {
  const browser = await chromium.launch({ headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  const results = [];
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1180, height: 820 }, { width: 1440, height: 900 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const requests = [];
      const unexpected = [];
      const errors = [];
      context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        requests.push({ url: url.origin + url.pathname, method: request.method() });
        if (url.origin === ATHENA && url.pathname === '/__offline_pr49_fixture') {
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><title>SIMULATED opener</title>
            <p>Offline fixture opener, no real Athena session.</p><button id="open">Open simulated result</button>
            <script>document.getElementById('open').onclick=()=>window.open('${VAC}/auth?handoff=narration-capture&state=${STATE}');
            window.addEventListener('message',event=>{if(event.origin==='${VAC}'&&event.data.type==='vac-vault-handoff')
            event.source.postMessage({type:'vac-vault-handoff-ack',state:event.data.state},'${VAC}');});</script>` });
        }
        if (url.origin === VAC && url.pathname === '/auth') {
          return route.fulfill({ contentType: 'text/html', body: fixture });
        }
        if (url.origin === VAC && url.pathname === '/v1/vat/issue') {
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ compact_jwt: 'fixture.not-valid.not-a-token', claims: { exp: Date.now() / 1000 + 120 } }) });
        }
        unexpected.push(request.url());
        return route.abort();
      });
      const opener = await context.newPage();
      await opener.goto(ATHENA + '/__offline_pr49_fixture');
      const popupPromise = opener.waitForEvent('popup', { timeout: 10000 });
      await opener.locator('#open').click();
      const page = await popupPromise;
      await page.setViewportSize(viewport);
      const review = page.locator('#vacVaultHandoffReview');
      const close = page.locator('#vacVaultHandoffClose');
      await review.waitFor({ state: 'visible', timeout: 10000 });
      assert.equal(await close.isVisible(), true);
      for (const control of [review, close]) {
        const box = await control.boundingBox();
        assert(box && box.width > 0 && box.height >= 44);
        assert(box.x >= 0 && box.x + box.width <= viewport.width);
        assert(box.y >= 0 && box.y + box.height <= viewport.height);
      }
      const before = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth, viewport: innerWidth,
        detailsOpen: document.querySelector('details').open,
        bannerHeight: document.getElementById('vacVaultHandoff').getBoundingClientRect().height
      }));
      assert(before.width <= before.viewport);
      assert.equal(before.detailsOpen, false);
      await page.screenshot({ path: path.join(out, `${viewport.width}-before.png`) });
      await review.click();
      const after = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth, viewport: innerWidth,
        detailsOpen: document.querySelector('details').open,
        focused: document.activeElement === document.querySelector('summary'),
        bannerDisplay: getComputedStyle(document.getElementById('vacVaultHandoff')).display,
        resultsHeight: document.getElementById('successModalities').getBoundingClientRect().height
      }));
      assert.equal(after.detailsOpen, true);
      assert.equal(after.focused, true);
      assert.notEqual(after.bannerDisplay, 'none', 'return action survives review');
      assert.equal(await close.isVisible(), true);
      const returnBox = await close.boundingBox();
      assert(returnBox && returnBox.y >= 0 && returnBox.y + returnBox.height <= viewport.height, 'return is visible next to expanded results');
      assert(after.resultsHeight > 0);
      assert(after.width <= after.viewport);
      assert.equal(requests.filter(r => r.url.endsWith('/v1/vat/issue')).length, 1);
      assert.deepEqual(unexpected, []);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(out, `${viewport.width}-after.png`) });
      // Actual face-stage presentation functions, offline simulated camera placeholder only.
      // No permissions, camera, biometric engine, identity or real session is exercised.
      const facePage = await context.newPage();
      await facePage.setContent(`<!doctype html><meta charset="utf-8"><style>
        *{box-sizing:border-box}body{margin:0;background:#0d0f17;color:#e8edf5;font:16px/1.5 system-ui}
        main{max-width:520px;margin:auto;padding:16px}#cameraBoxRec{height:240px;border:2px dashed #d4a94e;display:grid;place-items:center}
        </style><main><p>SIMULATED face-stage layout — no camera or biometric verification.</p>
        <div id="cameraBoxRec">Camera placeholder</div></main><script>${faceStageSource}\n_vacFaceStageShow();</script>`);
      const faceReady = facePage.locator('#vacFaceStageReady');
      const faceBox = await faceReady.boundingBox();
      assert(faceBox && faceBox.height >= 44 && faceBox.x >= 0 && faceBox.x + faceBox.width <= viewport.width);
      assert(faceBox.y >= 0 && faceBox.y + faceBox.height <= viewport.height);
      const faceLayout = await facePage.evaluate(() => ({
        width: document.documentElement.scrollWidth, viewport: innerWidth,
        stageBottom: document.getElementById('vacFaceStage').getBoundingClientRect().bottom,
        cameraTop: document.getElementById('cameraBoxRec').getBoundingClientRect().top
      }));
      assert(faceLayout.width <= faceLayout.viewport);
      assert(faceLayout.stageBottom <= faceLayout.cameraTop, 'separate step precedes camera rather than covering it');
      await facePage.screenshot({ path: path.join(out, `${viewport.width}-face-stage.png`) });
      results.push({ viewport, before, after, faceLayout, interceptedRequests: requests.length, unexpectedRequests: unexpected.length, result: 'PASS' });
      await context.close();
    }
    const report = { head: process.env.VAC_LAYOUT_HEAD_SHA || 'local', checkout: process.env.GITHUB_SHA || 'local', sourceSha256, ceremonySha256,
      evidence: 'Offline simulated Chromium fixture; not a live biometric or Safari device test', results };
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
