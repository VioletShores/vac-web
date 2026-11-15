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
 *   - the Vault acks back; on ack this tab says so and closes itself. Narration
 *     capture keeps the results available until the user chooses to close it;
 *   - no opener, or no ack: a plain "return to the Vault tab" message and a
 *     "Send to the Vault again" button (re-sends, or re-mints once expired).
 * It never navigates anywhere, so there is no redirect to abuse.
 */
(function () {
  'use strict';
  var TARGETS = {
    'decisions-confirm': {
      origin: 'https://api.athenapilot.ai', audience: 'athena:decisions:confirm',
      agent: 'athena-decisions-confirm-handoff', resource: 'athena:decisions:confirm',
      action: 'confirm'
    },
    'vault-store': {
      origin: 'https://api.athenapilot.ai',
      audience: 'athena:vault:store',
      agent: 'athena-vault-store-handoff',
      resource: 'athena:vault:store',
      action: 'store_grant'
    },
    // Same signed JWT/nonce protocol as the Vault, but a DIFFERENT JWT
    // audience, product capability and owner session. No password or
    // session token crosses origins; Athena re-verifies independently.
    'owner-collaborate': {
      origin: 'https://api.athenapilot.ai',
      audience: 'athena:owner:collaborate',
      agent: 'athena-owner-collaborate-handoff',
      resource: 'athena:owner:collaborate',
      action: 'owner_signin'
    },
    // athena PKT-S204-VAC-NARRATION-CAPTURE (#1532): the owner's narration
    // recording page. Same protocol again, its own audience, one fixed origin.
    'narration-capture': {
      origin: 'https://api.athenapilot.ai',
      audience: 'athena:narration:capture',
      agent: 'athena-narration-capture-handoff',
      resource: 'athena:narration:capture',
      action: 'narration_capture'
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
  var toAthena = kind === 'decisions-confirm' || kind === 'owner-collaborate' || kind === 'narration-capture';
  var destination = toAthena ? 'Athena' : 'the Vault';
  var actionName = kind === 'decisions-confirm' ? 'confirmation' : kind === 'owner-collaborate' ? 'sign-in' : (kind === 'narration-capture' ? 'recording' : 'store');
  var reviewAfterHandoff = kind === 'narration-capture';

  // The opener obtained this challenge from VAC server-to-server and stores its
  // exact policy pin with the pending decision. URL data never supplies it.
  var continuation = null;
  var challengeConsumed = false;
  var cancelled = false;
  function continuationFresh() {
    return continuation && !cancelled && Date.now() < continuation.expires_at * 1000;
  }
  function acceptContinuation(m) {
    if (continuation || cancelled || challengeConsumed || m.type !== 'vac-continuation-challenge' || m.state !== state) return;
    var c = m.continuation || {};
    var ch = c.challenge || {}, p = ch.ceremony_policy || {}, b = p.binding || {};
    var expires = Math.min(Number(c.expires_at) * 1000,
      Date.parse(b.created_at) + Number(b.expires_seconds) * 1000);
    if (c.status !== 'identity_check_required' || c.purpose !== 'decision_receipt' || c.action !== 'confirm' ||
        !c.handoff || c.handoff.audience !== target.audience || c.handoff.nonce !== state ||
        typeof c.subject !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(c.subject) ||
        typeof c.public_ref !== 'string' || !c.public_ref || c.public_ref.length > 128 ||
        !/^[a-f0-9]{64}$/.test(c.payload_sha256 || '') ||
        p.version !== 'full-ceremony-1' || !/^[a-f0-9]{64}$/.test(p.sha256 || '') ||
        !p.verification || p.verification.version !== 'full-auth-1' ||
        !p.capture || typeof p.capture.include_greeting !== 'boolean' ||
        typeof ch.challenge_id !== 'string' || !ch.challenge_id || b.challenge_id !== ch.challenge_id ||
        !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 600000) return;
    continuation = JSON.parse(JSON.stringify(c));
    continuation.expires_at = expires / 1000;
  }

  var assertion = null;
  var assertionExpMs = 0;
  var sessionToken = null;
  var subject = null;
  var acked = false;
  var delivered = false;
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
    btn.textContent = 'Send to ' + destination + ' again';
    btn.style.cssText = 'display:none;margin:clamp(10px,2.5vw,14px) auto 0;min-height:44px;' +
      'padding:12px 22px;border-radius:12px;border:1px solid #10B981;background:transparent;' +
      'color:#10B981;font:700 clamp(15px,3.8vw,16px) -apple-system,system-ui,sans-serif;';
    btn.addEventListener('click', function () { send(); });
    el.appendChild(msg);
    el.appendChild(btn);
    if (reviewAfterHandoff) {
      var actions = document.createElement('div');
      actions.id = 'vacVaultHandoffActions';
      actions.style.cssText = 'display:none;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:12px;';
      var review = document.createElement('button');
      review.id = 'vacVaultHandoffReview';
      review.type = 'button';
      review.textContent = 'Review results';
      review.style.cssText = 'min-height:44px;padding:12px 22px;border-radius:12px;border:1px solid #10B981;' +
        'background:transparent;color:#10B981;font:700 16px -apple-system,system-ui,sans-serif;';
      review.addEventListener('click', function () {
        if (!acked) return;
        // Only reveal the existing server-result UI; never construct a verdict here.
        var results = document.getElementById('successModalities');
        var details = results && results.parentNode;
        if (details && details.tagName === 'DETAILS') {
          details.open = true;
          var summary = details.querySelector('summary');
          if (summary) summary.focus();
          details.scrollIntoView({ block: 'start' });
        }
        // Keep the onward action next to the report, in normal document flow.
        if (details && details.parentNode) details.parentNode.insertBefore(el, details);
        if (el.scrollIntoView) el.scrollIntoView({ block: 'start' });
      });
      var close = document.createElement('button');
      close.id = 'vacVaultHandoffClose';
      close.type = 'button';
      close.textContent = 'Continue to recording';
      close.style.cssText = review.style.cssText + 'background:#10B981;color:#071812;font-weight:800;';
      close.addEventListener('click', function () {
        if (!acked) return;
        // Focus only the original opener; never reconstruct a personal recording URL.
        if (!openerPresent()) {
          show('error', 'The recording tab is closed. Reopen your original recording link to continue.', false);
          return;
        }
        show('ok', 'Return to your original Athena recording tab. If this tab stays open, switch tabs to continue recording.', false);
        try { window.opener.focus(); } catch (e) {}
        try { window.close(); } catch (e) {}
      });
      actions.appendChild(close);
      actions.appendChild(review);
      el.appendChild(actions);
    }
    var success = reviewAfterHandoff && document.getElementById('step4');
    if (reviewAfterHandoff) {
      // The result belongs to the originating task, ahead of general VAC material.
      // Normal flow prevents the controls covering results at zoom or on mobile.
      el.style.cssText = 'position:relative;margin:16px 0;padding:20px;border:2px solid #10B981;' +
        'border-radius:14px;background:#0D0F17;color:#E8EDF5;text-align:center;' +
        'font:600 17px/1.45 -apple-system,system-ui,sans-serif;scroll-margin-top:16px;';
    }
    if (success) success.insertBefore(el, success.firstChild);
    else document.body.appendChild(el);
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
    if (kind === 'decisions-confirm' && (!continuationFresh() || !challengeConsumed)) return;
    if (!openerPresent()) {
      show('warn', 'Return to ' + (toAthena ? 'the Athena' : 'the Vault') + ' tab. This page was not opened from ' + destination +
        ' (or that tab was closed), so nothing was sent. Start the ' + actionName + ' again from ' + destination + '.', false);
      return;
    }
    window.opener.postMessage({ type: MSG, state: state, assertion: assertion }, target.origin);
    delivered = true;
    show('info', 'Sent to ' + destination + '. Return to that tab to finish ' + actionName + '.', true);
    clearTimeout(ackTimer);
    ackTimer = setTimeout(function () {
      if (!acked) {
        show('warn', destination + ' has not confirmed yet. Switch back to it; if it is still waiting, ' +
          'come back here and tap “Send to ' + destination + ' again”.', true);
      }
    }, ACK_WAIT_MS);
  }

  function send() {
    if (sending || acked || (kind === 'decisions-confirm' && (!challengeConsumed || !continuationFresh()))) return;
    // No opener (or it closed): deliver() says "return to the Vault tab"; nothing is minted.
    if (!openerPresent()) { deliver(); return; }
    sending = true;
    var ready = (assertion && Date.now() < assertionExpMs - 5000) ? Promise.resolve() : mint();
    ready.then(deliver, function (e) {
      show('error', 'Could not prepare the handoff to ' + destination + ' (' + e.message + '). Return to ' + destination + ' and start again.', false);
    }).then(function () { sending = false; }, function () { sending = false; });
  }

  if (valid) {
    window.addEventListener('message', function (ev) {
      if (ev.origin !== target.origin) return;
      var op = null;
      try { op = window.opener; } catch (e) { op = null; }
      if (!op || ev.source !== op) return;
      var m = ev.data || {};
      if (kind === 'decisions-confirm') {
        if (m.type === 'vac-continuation-cancel' && m.state === state) { cancelled = true; continuation = null; assertion = null; delivered = false; return; }
        acceptContinuation(m);
      }
      if (m.type !== ACK || m.state !== state) return;
      if (acked || !delivered) return;
      if (kind === 'decisions-confirm' && (!challengeConsumed || !continuationFresh())) return;
      if (kind === 'decisions-confirm' && m.status !== 'identity_verified_action_held' && m.status !== 'confirmed') return;
      acked = true;
      clearTimeout(ackTimer);
      assertion = null;
      if (kind === 'decisions-confirm') {
        if (m.status === 'confirmed') {
          show('ok', 'Athena recorded the decision receipt. Return to Athena to review it.', false);
        } else {
          show('warn', 'Athena checked your identity. The decision is still held; nothing has been authorised. Return to Athena for the next step.', false);
        }
      } else if (reviewAfterHandoff) {
        show('ok', 'Verification delivered to Athena. Continue to recording, or review your results first. Your results stay available until you leave.', false);
        document.getElementById('vacVaultHandoffActions').style.display = 'flex';
      } else {
        show('ok', 'Delivered. ' + destination + ' has your verification. You can close this tab.', false);
        setTimeout(function () { try { window.close(); } catch (e) {} }, 1200);
      }
    });
  }

  window.VACVaultHandoff = {
    requiresSuppliedChallenge: kind === 'decisions-confirm',
    assertChallengeActive: function (id) {
      if (!continuationFresh() || !challengeConsumed || id !== continuation.challenge.challenge_id) {
        throw new Error('This confirmation expired or was cancelled. Return to Athena.');
      }
    },
    consumeChallenge: function (identity, isFull, skipsGreeting) {
      if (!valid || kind !== 'decisions-confirm' || !openerPresent() || !continuationFresh() || challengeConsumed ||
          !isFull || String((identity || {}).email || '').trim().toLowerCase() !== continuation.subject.trim().toLowerCase() ||
          continuation.challenge.ceremony_policy.capture.include_greeting === !!skipsGreeting) {
        throw new Error('Return to Athena and start this confirmation again.');
      }
      challengeConsumed = true;
      return JSON.parse(JSON.stringify(continuation.challenge));
    },
    onVerified: function (authResult, identity) {
      if (!valid) {
        show('error', 'This ' + destination + ' link is not valid, so nothing was sent. Return to ' + destination + ' and start again.', false);
        return;
      }
      var r = (authResult && typeof authResult === 'object') ? authResult : {};
      var sess = (r.session && typeof r.session === 'object') ? r.session : {};
      var level = sess.auth_level || r.auth_level || null;
      var token = (typeof r.session_token === 'string' && r.session_token) ? r.session_token
        : (typeof sess.token === 'string' ? sess.token : '');
      var email = sess.email || r.email || (identity && identity.email) || '';
      if (r.authenticated !== true || level !== 'full' || !token || !email) {
        show('error', 'This was not a full VAC verification, so nothing was sent to ' + destination + '.', false);
        return;
      }
      if (kind === 'decisions-confirm' && (!challengeConsumed || !continuationFresh() ||
          String(email).trim().toLowerCase() !== continuation.subject.trim().toLowerCase())) {
        show('error', 'This confirmation is no longer valid. Return to Athena and start again.', false);
        return;
      }
      sessionToken = token;
      subject = String(email).trim().toLowerCase();
      send();
    }
  };
  if (valid && kind === 'decisions-confirm' && openerPresent()) {
    window.opener.postMessage({type:'vac-continuation-ready', state:state}, target.origin);
  }
})();



