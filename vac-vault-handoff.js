/* vac-vault-handoff.js — hand a completed VAC verification back to the Athena
 * Vault tab that opened this ceremony (athena PKT-S204-VAULT-MOBILE-HANDOFF,
 * successor to PKT-S189-VAC-COMPACT-VAT-HANDOFF B2).
 *
 * WITHOUT handoff params this file defines nothing and changes nothing: the
 * production ceremony is untouched. With ?handoff=<target>&state=<nonce>:
 *   - the ceremony itself runs unchanged; auth.html's showSuccess() calls
 *     VACVaultHandoff.onVerified() only on its authenticated branch;
 *   - only a SERVER verdict authenticated at "full", with a session token, and
 *     only when this tab has a window.opener, asks VAC POST /v1/vat/issue for a
 *     handoff VAT: aud = the target's audience, nonce = state, <= 120 s. VAC
 *     re-checks all of it server-side and refuses otherwise;
 *   - the VAT goes to window.opener by postMessage with targetOrigin PINNED to
 *     the target's origin from the list below (never "*", never from the URL),
 *     so a wrong opener never receives it. It is never put in a URL, history,
 *     storage or a log, and the session token never leaves this origin;
 *   - the Vault acks back; on ack this tab says so and closes itself;
 *   - no opener, or no ack: a plain "return to the Vault tab" message and a
 *     "Send to the Vault again" button (re-sends, or re-mints once expired).
 * It never navigates anywhere, so there is no redirect to abuse.
 */
(function () {
  'use strict';
  var TARGETS = {
    'vault-store': {
      origin: 'https://api.athenapilot.ai',
      audience: 'athena:vault:store',
      agent: 'athena-vault-store-handoff',
      resource: 'athena:vault:store',
      action: 'store_grant'
    }
  };
  var STATE_RE = /^[A-Za-z0-9_-]{32,128}$/;
  var MSG = 'vac-vault-handoff';
  var ACK = 'vac-vault-handoff-ack';
  var ACK_WAIT_MS = 6000;
  var LIFETIME_S = 120;

  var q;
  try { q = new URLSearchParams(window.location.search); } catch (e) { return; }
  var kind = q.get('handoff');
  if (kind === null) return; // no handoff params: nothing is defined, nothing changes

  var target = Object.prototype.hasOwnProperty.call(TARGETS, kind) ? TARGETS[kind] : null;
  var state = q.get('state') || '';
  var valid = !!target && STATE_RE.test(state);

  var assertion = null;
  var assertionExpMs = 0;
  var sessionToken = null;
  var subject = null;
  var acked = false;
  var sending = false;
  var ackTimer = null;

  function apiBase() {
    try { if (typeof API_BASE === 'string' && API_BASE) return API_BASE; } catch (e) {}
    return 'https://vac-system-production.up.railway.app';
  }

  function panel() {
    var el = document.getElementById('vacVaultHandoff');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'vacVaultHandoff';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:10000;background:#0D0F17;' +
      'border-top:1px solid #1E2230;padding:clamp(14px,3.5vw,22px) clamp(16px,4vw,28px) ' +
      'calc(clamp(14px,3.5vw,22px) + env(safe-area-inset-bottom));color:#E8EDF5;' +
      'font:600 clamp(15px,3.8vw,17px)/1.45 -apple-system,system-ui,sans-serif;text-align:center;';
    var msg = document.createElement('div');
    msg.id = 'vacVaultHandoffMsg';
    var btn = document.createElement('button');
    btn.id = 'vacVaultHandoffResend';
    btn.type = 'button';
    btn.textContent = 'Send to the Vault again';
    btn.style.cssText = 'display:none;margin:clamp(10px,2.5vw,14px) auto 0;min-height:44px;' +
      'padding:12px 22px;border-radius:12px;border:1px solid #10B981;background:transparent;' +
      'color:#10B981;font:700 clamp(15px,3.8vw,16px) -apple-system,system-ui,sans-serif;';
    btn.addEventListener('click', function () { send(); });
    el.appendChild(msg);
    el.appendChild(btn);
    document.body.appendChild(el);
    return el;
  }

  function show(tone, text, withResend) {
    var el = panel();
    el.setAttribute('data-tone', tone);
    el.style.borderTopColor = tone === 'ok' ? '#10B981' : (tone === 'error' ? '#F87171' : '#1E2230');
    document.getElementById('vacVaultHandoffMsg').textContent = text;
    document.getElementById('vacVaultHandoffResend').style.display = withResend ? 'block' : 'none';
  }

  function openerPresent() {
    var op = null;
    try { op = window.opener; } catch (e) { op = null; }
    return !!op && op !== window && !op.closed;
  }

  function mint() {
    return fetch(apiBase() + '/v1/vat/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        human_identity: 'email:' + subject,
        agent_id: target.agent,
        resources: [target.resource],
        actions: [target.action],
        expiry_seconds: LIFETIME_S,
        authorising_session_token: sessionToken,
        handoff: { audience: target.audience, nonce: state }
      })
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (b) {
        if (!r.ok || !b || typeof b.compact_jwt !== 'string') {
          var d = b && b.detail;
          throw new Error((d && (d.message || d.error)) || ('VAC answered ' + r.status));
        }
        assertion = b.compact_jwt;
        var exp = b.claims && typeof b.claims.exp === 'number' ? b.claims.exp * 1000 : Date.now() + LIFETIME_S * 1000;
        assertionExpMs = exp;
      });
    });
  }

  function deliver() {
    if (!openerPresent()) {
      show('warn', 'Return to the Vault tab. This page was not opened from the Vault (or that tab was closed), ' +
        'so nothing was sent. Start the store again from the Vault.', false);
      return;
    }
    window.opener.postMessage({ type: MSG, state: state, assertion: assertion }, target.origin);
    show('info', 'Sent to the Vault. Return to the Vault tab to finish storing.', true);
    clearTimeout(ackTimer);
    ackTimer = setTimeout(function () {
      if (!acked) {
        show('warn', 'The Vault tab has not confirmed yet. Switch back to it; if it is still waiting, ' +
          'come back here and tap “Send to the Vault again”.', true);
      }
    }, ACK_WAIT_MS);
  }

  function send() {
    if (sending || acked) return;
    // No opener (or it closed): deliver() says "return to the Vault tab"; nothing is minted.
    if (!openerPresent()) { deliver(); return; }
    sending = true;
    var ready = (assertion && Date.now() < assertionExpMs - 5000) ? Promise.resolve() : mint();
    ready.then(deliver, function (e) {
      show('error', 'Could not prepare the handoff to the Vault (' + e.message + '). Return to the Vault and start again.', false);
    }).then(function () { sending = false; }, function () { sending = false; });
  }

  if (valid) {
    window.addEventListener('message', function (ev) {
      if (ev.origin !== target.origin) return;
      var op = null;
      try { op = window.opener; } catch (e) { op = null; }
      if (!op || ev.source !== op) return;
      var m = ev.data || {};
      if (m.type !== ACK || m.state !== state) return;
      acked = true;
      clearTimeout(ackTimer);
      assertion = null;
      show('ok', 'Delivered. The Vault has your verification. You can close this tab.', false);
      setTimeout(function () { try { window.close(); } catch (e) {} }, 1200);
    });
  }

  window.VACVaultHandoff = {
    onVerified: function (authResult, identity) {
      if (!valid) {
        show('error', 'This Vault link is not valid, so nothing was sent. Return to the Vault and start again.', false);
        return;
      }
      var r = (authResult && typeof authResult === 'object') ? authResult : {};
      var sess = (r.session && typeof r.session === 'object') ? r.session : {};
      var level = sess.auth_level || r.auth_level || null;
      var token = (typeof r.session_token === 'string' && r.session_token) ? r.session_token
        : (typeof sess.token === 'string' ? sess.token : '');
      var email = sess.email || r.email || (identity && identity.email) || '';
      if (r.authenticated !== true || level !== 'full' || !token || !email) {
        show('error', 'This was not a full VAC verification, so nothing was sent to the Vault.', false);
        return;
      }
      sessionToken = token;
      subject = String(email).trim().toLowerCase();
      send();
    }
  };
})();
