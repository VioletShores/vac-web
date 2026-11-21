/* Opt-in private film bridge. No recorder, verifier, VAT or publication authority.
 * Ordinary /auth defines nothing. Only the explicit owner-launched film flow
 * retains the existing original Blob, in memory, until consented save/decline.
 */
(function () {
  'use strict';
  var q;
  try { q = new URLSearchParams(window.location.search); } catch (_) { return; }
  if (q.get('handoff') !== 'vac-walkthrough-record') return;

  var ORIGIN = 'https://api.athenapilot.ai';
  var NOTICE = 'vac-walkthrough-private-v1';
  var SAVE_NOTICE = 'vac-walkthrough-save-v1';
  var state = q.get('state') || '';
  var peer = window.opener;
  var valid = !!peer && /^[A-Za-z0-9_-]{43}$/.test(state) &&
    q.getAll('state').length === 1 && q.getAll('handoff').length === 1 &&
    Array.from(q.keys()).every(function (k) { return k === 'state' || k === 'handoff'; });
  var initialized = false, continued = false, ended = false, saving = false;
  var expires = 0, stateHash = '', clip = null, receipt = null, waiting = null;
  var beginAcknowledged = false, nextChunk = 0;
  var dialog = null, noticeBox = null, saveButton = null, heartbeat = null, expiryTimer = null;
  var started = performance.now(), events = [], lastPhase = -1;
  var phases = {ceremony_opened:0, camera_ready:1, capture_started:2,
    greeting_prompt:3, digit_prompt:3, gesture_prompt:3, capture_stopped:4,
    verification_submitted:5, private_save_offered:6, private_save_consented:7};
  var repeatable = {digit_prompt:true, gesture_prompt:true};

  function fresh() { return valid && initialized && !ended && Date.now() < expires * 1000; }
  function post(type, extra, transfer) {
    if (!valid) return;
    peer.postMessage(Object.assign({type:type, state:state}, extra || {}), ORIGIN, transfer || []);
  }
  function stage(name) {
    if (!fresh() || !Object.prototype.hasOwnProperty.call(phases, name)) return;
    // A failed attempt may be retried by the ordinary ceremony. Keep only the
    // timeline for the actual new clip; never present failed-attempt prompts
    // as stages of the saved original.
    if (name === 'capture_started' && events.some(function (e) { return e.stage === name; })) {
      events = events.filter(function (e) { return e.stage === 'ceremony_opened' || e.stage === 'camera_ready'; });
      lastPhase = events.length ? phases[events[events.length - 1].stage] : -1;
    }
    if (phases[name] < lastPhase || events.length >= 80) return;
    if (!repeatable[name] && events.some(function (e) { return e.stage === name; })) return;
    if ((name === 'greeting_prompt' || name === 'digit_prompt' || name === 'gesture_prompt' || name === 'capture_stopped') &&
        !events.some(function (e) { return e.stage === 'capture_started'; })) return;
    if (name === 'verification_submitted' && !events.some(function (e) { return e.stage === 'capture_stopped'; })) return;
    var at = Math.max(0, Math.floor(performance.now() - started));
    if (at > 600000) return;
    events.push({stage:name, at_ms:at});
    lastPhase = phases[name];
  }
  function closePanel() {
    if (!dialog) return;
    try { if (dialog.open && dialog.close) dialog.close(); } catch (_) {}
    dialog.remove(); dialog = null; noticeBox = null; saveButton = null;
  }
  function element(tag, text) {
    var el = document.createElement(tag);
    if (text) el.textContent = text;
    return el;
  }
  function panel(title, copy) {
    closePanel();
    dialog = element('dialog');
    dialog.id = 'vacWalkthroughDialog';
    dialog.setAttribute('aria-label', title);
    dialog.style.cssText = 'background:#14202b;color:#f1f6fa;border:1px solid #496174;border-radius:16px;padding:24px;max-width:560px;width:calc(100% - 36px);font:17px/1.55 system-ui;z-index:2147483647;';
    dialog.append(element('h2', title), element('p', copy));
    dialog.addEventListener('cancel', function (e) { e.preventDefault(); });
    document.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { dialog.setAttribute('open', ''); dialog.style.position = 'fixed'; dialog.style.inset = '12% auto auto 18px'; }
    return dialog;
  }
  function button(label, fn, secondary) {
    var b = element('button', label);
    b.type = 'button';
    b.style.cssText = 'font:inherit;padding:12px 16px;margin:8px 8px 0 0;border:0;border-radius:8px;cursor:pointer;background:' + (secondary ? '#344757;color:#fff' : '#9ce0cf;color:#10251f');
    b.addEventListener('click', fn); dialog.appendChild(b); return b;
  }
  function clearMedia() {
    clip = null; receipt = null; saving = false;
    beginAcknowledged = false; nextChunk = 0;
    if (waiting) { var pending = waiting; waiting = null; clearTimeout(pending.timer); pending.reject(new Error('film_closed')); }
  }
  function decline() {
    if (saving) return;
    post('vac-walkthrough-declined'); ended = true; clearMedia();
    panel('Private saving declined', 'Your VAC result is unchanged. Return to Athena to confirm the unfinished recording was deleted. If a save had already finished, check “My saved recordings”.');
  }
  function expired() {
    ended = true; clearMedia();
    if (heartbeat) clearInterval(heartbeat);
    panel('Private recording window ended', 'This page cannot save a clip now. Your VAC result is unchanged. Check “My saved recordings” in Athena before doing anything else; a save that already finished may be there.');
  }
  function readyPanel() {
    panel('Your private VAC walkthrough', 'Follow the real VAC prompts at your own pace: look at the camera, speak when asked, and show the requested fingers beside your face. This records the camera and microphone, not your screen. After the result you will choose separately whether to save the original privately.');
    button('Continue to the real VAC check', function () {
      if (!fresh()) { expired(); return; }
      continued = true; closePanel();
    });
    button('Cancel this recording', decline, true);
  }
  function canStart(full, greetingRequired) {
    return fresh() && continued && !clip && !saving && full === true && greetingRequired === true;
  }
  function challengeFields() {
    if (!fresh() || !continued || !/^[a-f0-9]{64}$/.test(stateHash)) throw new Error('walkthrough_not_ready');
    return {walkthrough_state_sha256:stateHash};
  }
  function waitFor(phase, seq, send) {
    return new Promise(function (resolve, reject) {
      if (!fresh()) { reject(new Error('film_expired')); return; }
      var item = {phase:phase, seq:seq, resolve:resolve, reject:reject, timer:null};
      waiting = item;
      item.timer = setTimeout(function () {
        if (waiting === item) waiting = null;
        reject(new Error('film_ack_timeout'));
      }, 12000);
      Promise.resolve().then(send).catch(function () {
        if (waiting === item) waiting = null;
        clearTimeout(item.timer); reject(new Error('film_transfer_failed'));
      });
    });
  }
  async function withRetry(phase, seq, send) {
    for (var attempt = 0; attempt < 3; attempt++) {
      try { await waitFor(phase, seq, send); return; }
      catch (e) { if (!fresh() || attempt === 2) throw e; }
    }
  }
  async function save() {
    if (!fresh() || !clip || !receipt || saving || !noticeBox || noticeBox.checked !== true) return;
    saving = true; stage('private_save_consented');
    var timeline = events.map(function (e) { return {stage:e.stage, at_ms:e.at_ms}; });
    panel('Saving your original privately', 'Keep this tab and the Athena owner page open. The file is saved only when Athena confirms that the signed original can be read back.');
    try {
      if (!beginAcknowledged) {
        await withRetry('begin', null, function () {
          post('vac-walkthrough-save', {receipt:receipt, timeline:timeline,
            save_notice_version:SAVE_NOTICE, save_consented:true});
        });
        beginAcknowledged = true;
      }
      for (var seq = nextChunk, offset = nextChunk * 524288; offset < clip.size; seq++, offset += 524288) {
        // Read a fresh ArrayBuffer for each retry: transferring detaches it.
        await withRetry('chunk', seq, async function () {
          var data = await clip.slice(offset, offset + 524288).arrayBuffer();
          post('vac-walkthrough-chunk', {seq:seq, data:data}, [data]);
        });
        nextChunk = seq + 1;
      }
      await withRetry('saved', null, function () { post('vac-walkthrough-finish'); });
      ended = true; clearMedia(); clearTimeout(expiryTimer);
      panel('Saved privately in Athena', 'Your original has been saved and read back successfully. Return to Athena to play, download or delete it. Nothing has been published.');
      button('Return to Athena', function () { try { peer.focus(); window.close(); } catch (_) {} });
    } catch (_) {
      saving = false;
      if (!fresh()) { expired(); return; }
      offer('Saving could not be confirmed. Check “My saved recordings” in Athena first. You can retry saving this same clip while this page stays open; do not repeat verification.');
    }
  }
  function offer(message) {
    panel('Save this genuine clip privately?', message || 'VAC has returned a successful result for this camera and microphone recording. Saving it in Athena is optional and does not approve publication or a business action.');
    var label = element('label'); label.style.display = 'block';
    noticeBox = element('input'); noticeBox.type = 'checkbox'; noticeBox.style.marginRight = '10px';
    label.append(noticeBox, element('span', 'Save the original privately for up to 7 days. I can play, download or delete it in my owner page. No public use, training or voice cloning is approved.'));
    dialog.appendChild(label);
    saveButton = button('Save this genuine clip privately', save); saveButton.disabled = true;
    noticeBox.addEventListener('change', function () { saveButton.disabled = !noticeBox.checked; });
    button('Do not save this clip', decline, true);
  }
  function completed(blob, result) {
    if (!fresh() || !continued || clip || saving) return;
    if (!(blob instanceof Blob) || blob.size <= 0 || blob.size > 41943040 ||
        !/^video\/(webm|mp4)(;|$)/.test(blob.type) || !result || result.authenticated !== true ||
        typeof result.walkthrough_receipt !== 'string' || result.walkthrough_receipt.length > 12000 ||
        result.walkthrough_receipt.split('.').length !== 3) {
      panel('No private clip is ready to save', 'The film receipt was unavailable. Your VAC result is unchanged. Do not repeat verification for a missing film receipt; return to Athena for help.');
      return;
    }
    clip = blob; receipt = result.walkthrough_receipt;
    stage('private_save_offered'); offer();
  }
  // Available even on malformed dedicated URLs so the camera hook fails
  // closed. Plain /auth returned above and has no object or changed behavior.
  window.VACWalkthroughCapture = Object.freeze({canStart:canStart,
    challengeFields:challengeFields, event:stage, completed:completed});

  window.addEventListener('message', async function (event) {
    if (!valid || event.origin !== ORIGIN || event.source !== peer || !event.data || event.data.state !== state) return;
    var m = event.data;
    if (m.type === 'vac-walkthrough-init' && !initialized && !ended) {
      if (m.notice_version !== NOTICE || typeof m.expires_at !== 'number' ||
          !Number.isFinite(m.expires_at) || m.expires_at * 1000 <= Date.now() ||
          m.expires_at * 1000 > Date.now() + 605000) return;
      try {
        var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state));
        if (initialized || ended) return;
        stateHash = Array.from(new Uint8Array(digest), function (n) { return n.toString(16).padStart(2, '0'); }).join('');
        expires = m.expires_at; initialized = true;
        clearInterval(heartbeat); stage('ceremony_opened');
        expiryTimer = setTimeout(expired, Math.max(0, expires * 1000 - Date.now()));
        readyPanel();
      } catch (_) { ended = true; panel('Recording is unavailable', 'Your owner page could not be linked securely. No camera or verification has started.'); }
      return;
    }
    if (m.type === 'vac-walkthrough-cancelled') { ended = true; clearMedia(); closePanel(); return; }
    if (!waiting) return;
    var match = (m.type === 'vac-walkthrough-saved' && waiting.phase === 'saved') ||
      (m.type === 'vac-walkthrough-ack' && (m.phase === 'begin' || m.phase === 'chunk') && m.phase === waiting.phase &&
       (m.phase !== 'chunk' || (Number.isInteger(m.seq) && m.seq === waiting.seq)));
    if (match || m.type === 'vac-walkthrough-error') {
      var pending = waiting; waiting = null; clearTimeout(pending.timer);
      if (match) pending.resolve(); else pending.reject(new Error('film_save_refused'));
    }
  });
  window.addEventListener('pagehide', function () {
    ended = true; clearMedia(); clearInterval(heartbeat); clearTimeout(expiryTimer);
  });
  function open() {
    panel('Linking your private recording', valid ? 'Keep your Athena owner page open. No camera or verification starts until the private recording is linked and you continue.' : 'Open this flow from “Record my VAC walkthrough” in your Athena owner page. No camera or verification has started.');
    if (valid) {
      post('vac-walkthrough-ready');
      heartbeat = setInterval(function () { if (!initialized && !ended) post('vac-walkthrough-ready'); }, 1000);
      setTimeout(function () { if (!initialized && !ended) { ended = true; clearInterval(heartbeat); panel('Could not link the owner page', 'Return to Athena, keep that page open, and cancel this unfinished session. No camera or verification has started.'); } }, 15000);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', open, {once:true});
  else open();
})();
