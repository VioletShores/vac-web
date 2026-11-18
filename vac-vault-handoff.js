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
    // OFF at the issuer unless VAC_L0_SERVICE_HANDOFF_ENABLED=1 AND this
    // audience is explicitly allowlisted. Identity is not a service grant:
    // Athena still verifies its exact packet, policy and permit at use time.
    'service-operation': {
      origin: 'https://api.athenapilot.ai',
      audience: 'athena:l0:service-operation',
      agent: 'athena-l0-service-operation-handoff',
      resource: 'athena:l0:service-operation',
      action: 'service_operation'
    },
    // Independent owner L3 consent for the billable two-model A2 critic review.
    // Not an approval for the later native Flux design task; separate audience,
    // nonce, grant, server policy and expiry.
    'critic-review': {
      origin: 'https://api.athenapilot.ai',
      audience: 'athena:l0:critic-review',
      agent: 'athena-l0-critic-review-handoff',
      resource: 'athena:l0:critic-review',
      action: 'critic_review'
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
  var serviceOperation = kind === 'service-operation';
  var criticReview = kind === 'critic-review';
  var reviewedHandoff = serviceOperation || criticReview;
  var valid = !!target && (reviewedHandoff ? /^[a-f0-9]{64}$/.test(state) : STATE_RE.test(state));
  var toAthena = reviewedHandoff || kind === 'decisions-confirm' || kind === 'owner-collaborate' || kind === 'narration-capture';
  var destination = toAthena ? 'Athena' : 'the Vault';
  var actionName = criticReview ? 'A2 external critic review' :
    (serviceOperation ? 'operation review' : (kind === 'decisions-confirm' ? 'confirmation' :
    kind === 'owner-collaborate' ? 'sign-in' : (kind === 'narration-capture' ? 'recording' : 'store')));
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
  var operation = null;
  var operationJson = null;
  var operationGeneration = 0;
  var operationConfirmed = false;
  var replacementDeliveryAttempted = false;

  function serviceSessionChanged() {
    if (!reviewedHandoff) return;
    operationGeneration++;
    operationConfirmed = false;
    operation = null;
    operationJson = null;
    assertion = null;
    delivered = false;
    sessionToken = null;
    subject = null;
    sending = false;
    var review = document.getElementById('vacServiceOperationReview');
    if (review) review.remove();
    var criticPanel = document.getElementById('vacCriticReview');
    if (criticPanel) criticPanel.remove();
  }

  // The canonical bytes come from the server-authored packet in the opener.
  // Never rebuild canonical JSON in JS (Python float/Unicode encoding differs)
  // or accept an operation from URL parameters, local storage or another tab.
  function requestOperation() {
    if (!reviewedHandoff || !valid || !openerPresent()) return;
    window.opener.postMessage({ type: criticReview ? 'vac-critic-review-request' :
      'vac-service-operation-request', state: state }, target.origin);
  }

  function operationRefused() {
    operationGeneration++;
    operation = null;
    operationJson = null;
    operationConfirmed = false;
    assertion = null;
    delivered = false;
    var review = document.getElementById('vacServiceOperationReview');
    if (review) review.remove();
    var criticPanel = document.getElementById('vacCriticReview');
    if (criticPanel) criticPanel.remove();
    show('error', criticReview ?
      'The exact external-review disclosure could not be verified. No critic or Flux task was authorised. Return to Athena.' :
      'The exact operation could not be verified. Nothing was authorised. Return to Athena to review it again.', false);
  }

  // UI shape validation is deliberately separate from authority. Athena still
  // validates the canonical seals, current policy, registered implementations,
  // budget evidence and one-use permit when consuming this exact-intent proof.
  // V1 keeps its existing file-transfer review. V2 is the narrowly supported
  // native Flux task contract, not permission for arbitrary provider actions.
  function exactKeys(value, keys) {
    return !!value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === keys.length && keys.every(function (key) {
        return Object.prototype.hasOwnProperty.call(value, key);
      });
  }
  function sameList(value, expected) {
    return Array.isArray(value) && value.length === expected.length &&
      value.every(function (item, index) { return item === expected[index]; });
  }
  function safeStrings(value) {
    if (typeof value === 'string') return value.length <= 2048 && value.trim() === value &&
      !/\p{C}/u.test(value);
    if (Array.isArray(value)) return value.every(safeStrings);
    if (value && typeof value === 'object') return Object.keys(value).every(function (key) {
      return safeStrings(key) && safeStrings(value[key]);
    });
    return true;
  }
  function awareTime(value) {
    return typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  }
  function costValue(value, unit) {
    if (!exactKeys(value, ['amount', 'unit']) || typeof value.unit !== 'string' || !value.unit ||
        (unit !== undefined && value.unit !== unit) || typeof value.amount !== 'string' ||
        !/^\d+(?:\.\d+)?$/.test(value.amount)) throw new Error('invalid decimal cost');
    var parts = value.amount.split('.');
    return {digits: BigInt(parts.join('')), scale: (parts[1] || '').length};
  }
  function exactValues(value, expected) {
    return exactKeys(value, Object.keys(expected)) && Object.keys(expected).every(function (key) {
      return value[key] === expected[key];
    });
  }
  function validAsyncCreditRisk(op) {
    // An owner-observed account setting is NOT a provider-enforced per-task cap
    // or proof of who pays. The signed exact operation includes the disclosure;
    // Athena independently checks the evidence, payer, policy and sealed L0
    // before it may dispatch anything.
    var risk = op.async_credit_risk;
    if (!exactKeys(risk, ['mode', 'provider', 'account', 'project_url', 'billing_mode',
          'observed_monthly_spend_limit_usd', 'observed_available_acus',
          'provider_task_spend_cap_enforced', 'provider_agent_stop_available',
          'automatic_retries', 'evidence_kind', 'observed_at', 'owner_acceptance',
          'payer_binding'])) return false;
    if (risk.mode !== 'owner_accepted_unstoppable_agent' ||
        risk.provider !== 'flux_ai' ||
        typeof risk.account !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(risk.account) ||
        risk.project_url !== op.project_url || risk.billing_mode !== 'on_demand' ||
        typeof risk.observed_monthly_spend_limit_usd !== 'string' ||
        !/^(?:0|[1-9][0-9]{0,5})\.[0-9]{2}$/.test(risk.observed_monthly_spend_limit_usd) ||
        Number(risk.observed_monthly_spend_limit_usd) <= 0 ||
        !Number.isSafeInteger(risk.observed_available_acus) ||
        risk.observed_available_acus < 0 || risk.observed_available_acus > 100000 ||
        risk.provider_task_spend_cap_enforced !== false ||
        risk.provider_agent_stop_available !== false ||
        risk.automatic_retries !== false ||
        risk.evidence_kind !== 'owner_account_settings_ui_observation' ||
        risk.owner_acceptance !== 'fresh_exact_operation_vac_required' ||
        !awareTime(risk.observed_at)) return false;
    var ageMs = Date.now() - Date.parse(risk.observed_at);
    if (ageMs < -10000 || ageMs > 900000) return false;
    var projectParts = op.project_url.match(/^https:\/\/www\.flux\.ai\/([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\/([^/?#]+)\/schematic$/);
    if (!projectParts || projectParts[1] !== risk.account ||
        op.result_contract.provider_project_id !== risk.account + '/' + projectParts[2]) return false;
    // Flux's documented rule charges project owners (not OAuth callers).
    // This is STILL an owner-observed binding, not a live provider receipt.
    // Athena must freshly authenticate get_project and check ownerHandle/slug,
    // exact target and current billing before the one paid effect.
    var payer = risk.payer_binding;
    if (!exactKeys(payer, ['type', 'status', 'project_owner', 'billing_account',
          'source_url', 'observed_at', 'oauth_subject_verified',
          'fresh_provider_owner_recheck_required']) ||
        payer.type !== 'provider_project_owner_billing_rule' ||
        payer.status !== 'owner_observed_recheck_required' ||
        payer.project_owner !== risk.account || payer.billing_account !== risk.account ||
        payer.source_url !== 'https://docs.flux.ai/account/copilot-credits' ||
        payer.oauth_subject_verified !== false ||
        payer.fresh_provider_owner_recheck_required !== true ||
        !awareTime(payer.observed_at)) return false;
    var payerAgeMs = Date.now() - Date.parse(payer.observed_at);
    if (payerAgeMs < -10000 || payerAgeMs > 900000) return false;
    var unknown = {status: 'unknown', unit: 'ACU', basis: 'no_native_per_task_limit'};
    return exactValues(op.resource_envelope.spend_ceiling, unknown) &&
      exactValues(op.resource_envelope.cost_upper_bound, unknown) &&
      exactValues(op.readback.cost_upper_bound, unknown);
  }
  function validTaskOperation(op, raw) {
    var fields = ['version', 'purpose', 'execution_id', 'packet_id', 'actor', 'principal', 'tenant_id',
      'service_id', 'endpoint', 'capability', 'project_url', 'action', 'executor', 'expiry',
      'revocation_ref', 'risk', 'content_sha256', 'source_manifest_sha256', 'arguments_sha256',
      'tool_schema_sha256', 'cost_contract_sha256', 'service_manifest_sha256', 'allowed_tools',
      'constraints', 'resource_envelope', 'evidence_requirements', 'object_ref', 'readback', 'result_contract',
      'async_credit_risk'];
    var digests = ['content_sha256', 'source_manifest_sha256', 'arguments_sha256',
      'tool_schema_sha256', 'cost_contract_sha256', 'service_manifest_sha256'];
    var ids = ['execution_id', 'packet_id', 'actor', 'principal', 'tenant_id', 'service_id',
      'capability', 'object_ref', 'action', 'executor', 'revocation_ref'];
    var project = 'https://www.flux.ai/robzag/athena-pebble-b1-feasibility~07/schematic';
    if (raw.length > 16384 || !exactKeys(op, fields) || !safeStrings(op) || op.version !== 2 ||
        op.purpose !== 'service-operation' ||
        ids.some(function (key) { return typeof op[key] !== 'string' || !op[key] || op[key].length > 320; }) ||
        digests.some(function (key) { return typeof op[key] !== 'string' || !/^[a-f0-9]{64}$/.test(op[key]); }) ||
        op.project_url !== project || op.endpoint !== 'https://app.flux.ai/mcp' ||
        op.action !== 'create_thread' || op.capability !== 'submit_agent_task' ||
        op.object_ref !== 'submitted-source:' + op.content_sha256 ||
        op.revocation_ref !== 'execution:' + op.execution_id || !awareTime(op.expiry) ||
        typeof op.risk !== 'number' || !Number.isFinite(op.risk) || op.risk < 0 || op.risk > 1 ||
        !sameList(op.allowed_tools, ['get_project', 'create_thread', 'get_thread', 'get_messages'])) return false;
    var c = op.constraints, e = op.resource_envelope, r = op.readback, proof = op.evidence_requirements;
    if (!exactKeys(c, ['network_allowlist', 'write_scope', 'financial_transaction', 'connection_budget']) ||
        !sameList(c.network_allowlist, ['app.flux.ai']) || !sameList(c.write_scope, [project]) ||
        c.financial_transaction !== false || c.connection_budget !== 3 ||
        !exactKeys(e, ['max_turns', 'max_minutes', 'spend_ceiling', 'cost_upper_bound']) ||
        e.max_turns !== 1 || !Number.isInteger(e.max_minutes) || e.max_minutes < 1 || e.max_minutes > 30 ||
        !exactKeys(r, ['action', 'capability', 'tool_schema_sha256', 'arguments_sha256',
          'cost_contract_sha256', 'project_url', 'object_ref', 'cost_upper_bound', 'max_calls']) ||
        r.action !== 'get_messages' || r.capability !== 'read_agent_messages' || r.max_calls !== 2 ||
        r.project_url !== project || r.object_ref !== op.object_ref ||
        ['tool_schema_sha256', 'arguments_sha256', 'cost_contract_sha256'].some(function (key) {
          return typeof r[key] !== 'string' || !/^[a-f0-9]{64}$/.test(r[key]);
        }) || !exactKeys(proof, ['independent_readback', 'content_sha256', 'source_manifest_sha256']) ||
        proof.independent_readback !== true || proof.content_sha256 !== op.content_sha256 ||
        proof.source_manifest_sha256 !== op.source_manifest_sha256) return false;
    var result = op.result_contract;
    if (!exactKeys(result, ['kind', 'version', 'source_url', 'retrieved_at', 'provider_project_id', 'read_argument_binding']) ||
        result.kind !== 'provider_task_message' || result.version !== 1 ||
        typeof result.source_url !== 'string' ||
        !/^https:\/\/github\.com\/VioletShores\/athena\/blob\/[a-f0-9]{40}\/[^?#]+$/.test(result.source_url) ||
        !awareTime(result.retrieved_at) || typeof result.provider_project_id !== 'string' ||
        !/^robzag\/[^\s/?#]+$/.test(result.provider_project_id) || result.provider_project_id.length > 320) return false;
    if (!validAsyncCreditRisk(op)) return false;
    var binding = result.read_argument_binding;
    if (!exactKeys(binding, ['get_thread', 'get_messages']) ||
        !exactKeys(binding.get_thread, ['thread']) || !exactKeys(binding.get_messages, ['thread', 'offset', 'limit']) ||
        !exactKeys(binding.get_thread.thread, ['from_execute']) ||
        !exactKeys(binding.get_messages.thread, ['from_execute']) ||
        binding.get_thread.thread.from_execute !== 'thread_url' || binding.get_messages.thread.from_execute !== 'thread_url' ||
        binding.get_messages.offset !== 0 || binding.get_messages.limit !== 20) return false;
    // Hash of Athena's fixed canonical read-derivation bytes; never recanonicalise
    // the received intent or accept arbitrary caller-supplied read arguments.
    return r.arguments_sha256 === '7b25df211e6e413c79a586a0438cacd846b2d2e02837f1e60aaeaf8a20626820';
  }

  function renderOperation() {
    if (!serviceOperation || !operation || !sessionToken || !subject) return;
    if (operation.actor !== subject || Date.parse(operation.expiry) <= Date.now()) {
      operationRefused(); return;
    }
    var existing = document.getElementById('vacServiceOperationReview');
    if (existing) return;
    var box = document.createElement('section');
    box.id = 'vacServiceOperationReview';
    box.setAttribute('aria-label', 'Review the exact service operation');
    box.style.cssText = 'max-height:55vh;overflow:auto;max-width:860px;margin:12px auto;text-align:left;overflow-wrap:anywhere;';
    var title = document.createElement('h2');
    title.textContent = 'Review this one operation';
    box.appendChild(title);
    var summary = document.createElement('p');
    summary.textContent = operation.version === 2
      ? 'Confirming allows Athena to start one Flux design task using the exact source below, subject to its current policy and spending checks. The task may consume Flux credits. Readback verifies the submitted instructions; it is not proof that a schematic is finished. No general service access is granted.'
      : 'Your identity has been verified. Confirm only the operation below. This does not start design work, grant general service access, or replace Athena’s policy and delivery checks.';
    box.appendChild(summary);
    var fields = [
      ['Person', operation.actor], ['Athena principal', operation.principal],
      ['Tenant', operation.tenant_id], ['Service', operation.service_id],
      ['Project', operation.project_url], ['Object', operation.object_ref],
      ['Write action', operation.action], ['Write capability', operation.capability],
      ['Readback action', operation.readback.action], ['Readback capability', operation.readback.capability],
      ['Readback cost upper bound', operation.version === 2 ? 'Unknown; Flux supplies no per-task limit' :
          operation.readback.cost_upper_bound.amount + ' ' + operation.readback.cost_upper_bound.unit],
      ['Source SHA-256', operation.source_manifest_sha256],
      ['Content SHA-256', operation.content_sha256],
      ['Expiry', operation.expiry], ['Exact intent SHA-256', state]
    ];
    if (operation.version === 2) {
      var risk = operation.async_credit_risk;
      fields.push(['Billing mode', 'On-demand enabled (owner-observed settings)'],
        ['Owner-observed monthly on-demand limit', risk.observed_monthly_spend_limit_usd + ' USD — account-wide, NOT a cap on this task'],
        ['Owner-observed available credits', risk.observed_available_acus + ' ACUs at ' + risk.observed_at + '; balance can change'],
        ['Whole-job and per-task upper bound', 'Unknown — the Flux agent may keep consuming credits after message submission'],
        ['Flux MCP per-task spend cap', 'Unavailable; NO enforced stop'],
        ['Automatic retries', 'Disabled; one create_thread only'],
        ['Billing payer basis', 'Flux bills the project owner: ' + risk.account + ' (observed); Athena must recheck authenticated project ownership before execution'],
        ['OAuth subject', 'Not used as payer proof; no OAuth subject verification claimed'],
        ['Account observation', 'Owner UI observation only; not live provider proof'],
        ['Further paid actions', 'No additional messages, purchases, manufacturing orders or paid external services']);
    } else {
      fields.push(['Spend ceiling', operation.resource_envelope.spend_ceiling.amount + ' ' + operation.resource_envelope.spend_ceiling.unit],
        ['Cost upper bound', operation.resource_envelope.cost_upper_bound.amount + ' ' + operation.resource_envelope.cost_upper_bound.unit]);
    }
    if (operation.version === 2) {
      fields.push(['Source document', operation.result_contract.source_url],
        ['Source retrieved at', operation.result_contract.retrieved_at],
        ['Provider project', operation.result_contract.provider_project_id],
        ['Verified result', 'Exact submitted message only; design results need separate verification'],
        ['Submission and readback deadline', operation.resource_envelope.max_minutes + ' minutes'],
        ['Provider runtime', 'May continue after submission; the deadline above does not stop the Flux agent']);
    }
    fields.forEach(function (item) {
      var line = document.createElement('p');
      line.textContent = item[0] + ': ' + String(item[1]);
      box.appendChild(line);
    });
    var details = document.createElement('details');
    var label = document.createElement('summary');
    label.textContent = 'All exact operation fields';
    var pre = document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;';
    pre.textContent = operationJson;
    details.appendChild(label); details.appendChild(pre); box.appendChild(details);
    var confirm = document.createElement('button');
    confirm.id = 'vacServiceOperationConfirm'; confirm.type = 'button';
    confirm.textContent = 'Confirm this exact operation';
    confirm.style.cssText = 'min-height:44px;margin:12px 0;padding:12px 22px;background:#10B981;color:#07130f;border:0;border-radius:12px;font:700 16px system-ui;';
    confirm.addEventListener('click', function () {
      if (!operation || operation.actor !== subject || Date.parse(operation.expiry) <= Date.now()) { operationRefused(); return; }
      operationConfirmed = true; confirm.disabled = true; send();
    });
    box.appendChild(confirm);
    panel().appendChild(box);
    show('info', 'Review the operation and confirm it before any authority is sent to Athena.', false);
  }

  function receiveOperation(message) {
    var raw = message.intent_json;
    if (typeof raw !== 'string' || raw.length > 65536 || !/^[\x20-\x7e]*$/.test(raw)) { operationRefused(); return; }
    if (operationJson === raw) { renderOperation(); return; }
    if (operationJson !== null || operationConfirmed || sending || acked) { operationRefused(); return; }
    var generation = ++operationGeneration;
    var parsed;
    try {
      parsed = JSON.parse(raw);
      var strings = ['actor', 'principal', 'tenant_id', 'service_id', 'project_url', 'object_ref', 'action', 'capability',
        'source_manifest_sha256', 'content_sha256', 'expiry'];
      if (parsed && parsed.version === 2) {
        if (!validTaskOperation(parsed, raw)) throw new Error('invalid task operation');
      } else if (!parsed || parsed.version !== 1 || parsed.purpose !== 'service-operation' ||
          strings.some(function (key) { return typeof parsed[key] !== 'string' || !parsed[key]; }) ||
          !Number.isFinite(Date.parse(parsed.expiry)) || !parsed.readback ||
          typeof parsed.readback.action !== 'string' || !parsed.readback.action ||
          typeof parsed.readback.capability !== 'string' || !parsed.readback.capability ||
          !parsed.readback.cost_upper_bound || typeof parsed.readback.cost_upper_bound.amount !== 'string' ||
          typeof parsed.readback.cost_upper_bound.unit !== 'string' || !parsed.resource_envelope ||
          !parsed.resource_envelope.spend_ceiling || !parsed.resource_envelope.cost_upper_bound ||
          ['spend_ceiling', 'cost_upper_bound'].some(function (key) {
            var cost = parsed.resource_envelope[key];
            return typeof cost.amount !== 'string' || typeof cost.unit !== 'string';
          })) throw new Error('invalid operation');
    } catch (e) { operationRefused(); return; }
    Promise.resolve().then(function () {
      return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    }).then(function (digest) {
      if (generation !== operationGeneration) return;
      var hex = Array.prototype.map.call(new Uint8Array(digest), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      if (hex !== state) { operationRefused(); return; }
      operation = parsed; operationJson = raw; renderOperation();
    }, function () { if (generation === operationGeneration) operationRefused(); });
  }


  // Separate from service-operation: a fresh FULL/L3 approval for disclosure
  // of the exact sealed PLAN/source to TWO paid external model critics. This
  // does not create an execution permit or authorise Flux create_thread.
  function validCriticRecovery(r) {
    return exactKeys(r, ['version', 'kind', 'parent_grant_id', 'parent_job_id',
      'parent_result_sha256', 'plan_seal_sha256', 'additional_reviewer_call_limit',
      'automatic_retries', 'prior_calls_may_be_charged']) &&
      r.version === 1 && r.kind === 'one_manual_replacement' &&
      typeof r.parent_grant_id === 'string' && /^[a-f0-9]{32}$/.test(r.parent_grant_id) &&
      r.parent_job_id === 'orchestrate_fluxcritic_' + r.parent_grant_id &&
      typeof r.parent_result_sha256 === 'string' && /^[a-f0-9]{64}$/.test(r.parent_result_sha256) &&
      typeof r.plan_seal_sha256 === 'string' && /^[a-f0-9]{64}$/.test(r.plan_seal_sha256) &&
      r.additional_reviewer_call_limit === 2 && r.automatic_retries === false &&
      r.prior_calls_may_be_charged === true;
  }

  function validCriticInputBinding(b, p) {
    var hashes = ['operation_digest', 'plan_seal_sha256', 'gold_spec_hash', 'context_sha256',
      'prompt_sha256', 'system_sha256', 'model_input_sha256'];
    return exactKeys(b, hashes.concat(['version', 'packet_id', 'packet_ref', 'gold_spec_version'])) &&
      b.version === 'athena.flux.critic-input-binding/2' &&
      Number.isSafeInteger(b.packet_id) && b.packet_id > 0 && b.packet_id === p.packet_id &&
      typeof b.packet_ref === 'string' && /^PKT-FLUX-B1-[0-9a-f]{20}$/.test(b.packet_ref) &&
      b.operation_digest === p.operation_digest &&
      typeof b.gold_spec_version === 'string' && b.gold_spec_version.length > 0 &&
      Array.from(b.gold_spec_version).length <= 128 &&
      hashes.every(function(k) { return typeof b[k] === 'string' && /^[a-f0-9]{64}$/.test(b[k]); });
  }

  function criticNonceText(p) {
    var replacement = Object.prototype.hasOwnProperty.call(p, 'recovery');
    var binding = {operation_digest: p.operation_digest, policy_sha256: p.policy_sha256,
      purpose: replacement ? 'athena:l0:critic-review:replacement' : 'athena:l0:critic-review'};
    if (replacement) {
      var r = p.recovery;
      // Fixed validated ASCII/scalar schema, in the same recursively sorted
      // order as server canonical JSON. Never recanonicalise the operation.
      binding.recovery = {additional_reviewer_call_limit: r.additional_reviewer_call_limit,
        automatic_retries: r.automatic_retries, kind: r.kind,
        parent_grant_id: r.parent_grant_id, parent_job_id: r.parent_job_id,
        parent_result_sha256: r.parent_result_sha256, plan_seal_sha256: r.plan_seal_sha256,
        prior_calls_may_be_charged: r.prior_calls_may_be_charged, version: r.version};
    }
    if (Object.prototype.hasOwnProperty.call(p, 'review_binding')) {
      var b = p.review_binding;
      binding.review_binding = {context_sha256: b.context_sha256, gold_spec_hash: b.gold_spec_hash,
        gold_spec_version: b.gold_spec_version, model_input_sha256: b.model_input_sha256,
        operation_digest: b.operation_digest, packet_id: b.packet_id, packet_ref: b.packet_ref,
        plan_seal_sha256: b.plan_seal_sha256, prompt_sha256: b.prompt_sha256,
        system_sha256: b.system_sha256, version: b.version};
    }
    // Python canonical_json_hash uses ensure_ascii=True. Preserve legacy ASCII
    // bytes and escape Unicode gold-spec versions, including surrogate pairs.
    return JSON.stringify(binding).replace(/[\u007f-\uffff]/g, function(c) {
      return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
    });
  }

  function validCriticPreview(p) {
    var keys = ['packet_id', 'kind', 'audience', 'state', 'operation_digest',
      'policy_sha256', 'tenant_id', 'principal', 'actor', 'project_url', 'source_sha256',
      'source_bytes', 'canonical_plan_rows', 'source_confidential',
      'external_source_disclosure', 'reviewers', 'orchestrate_mode',
      'reviewer_call_limit', 'synthesis_vendor_allowed', 'max_tokens_per_provider',
      'approved_total_usd', 'owner_accepted_external_disclosure',
      'owner_accepted_unverified_residency', 'provider_hard_cost_cap_enforced',
      'automatic_retries', 'routing_posture', 'expiry',
      'ready_for_owner_critic_vac', 'review_submission_started'];
    var replacement = !!p && typeof p === 'object' &&
      Object.prototype.hasOwnProperty.call(p, 'recovery');
    var inputBound = !!p && typeof p === 'object' &&
      Object.prototype.hasOwnProperty.call(p, 'review_binding');
    if (replacement) keys.push('recovery');
    if (inputBound) keys.push('review_binding');
    var hex = /^[a-f0-9]{64}$/;
    var expectedSource = '6a678dbbc359df3888790019ef4799f2198dee2273cd329edc1d5463868a4156';
    var expectedProject = 'https://www.flux.ai/robzag/athena-pebble-b1-feasibility~07/schematic';
    if (!exactKeys(p, keys) || !safeStrings(p) ||
        (replacement && !validCriticRecovery(p.recovery)) ||
        (inputBound && !validCriticInputBinding(p.review_binding, p)) ||
        !Number.isSafeInteger(p.packet_id) || p.packet_id <= 0 ||
        p.kind !== 'critic-review' || p.audience !== 'athena:l0:critic-review' ||
        !hex.test(p.state) || p.state !== state ||
        !hex.test(p.operation_digest) || !hex.test(p.policy_sha256) ||
        typeof p.tenant_id !== 'string' || !p.tenant_id || p.tenant_id.length > 128 ||
        typeof p.principal !== 'string' || !p.principal || p.principal.length > 320 ||
        typeof p.actor !== 'string' || p.actor.toLowerCase() !== subject ||
        !/^[^\s@]+@[^\s@]+$/.test(p.actor) ||
        p.project_url !== expectedProject || p.source_sha256 !== expectedSource ||
        p.source_bytes !== 40304 || p.canonical_plan_rows !== 113 ||
        p.source_confidential !== true ||
        p.external_source_disclosure !== 'full_canonical_plan_and_source_scope' ||
        !Array.isArray(p.reviewers) || p.reviewers.length !== 2 ||
        p.orchestrate_mode !== 'collect_only' ||
        p.reviewer_call_limit !== 2 || p.synthesis_vendor_allowed !== false ||
        !Number.isInteger(p.max_tokens_per_provider) ||
        p.max_tokens_per_provider < 8192 || p.max_tokens_per_provider > 32768 ||
        typeof p.approved_total_usd !== 'string' ||
        !/^(?:0|[1-9][0-9]{0,2})\.[0-9]{2}$/.test(p.approved_total_usd) ||
        Number(p.approved_total_usd) < 0.01 || Number(p.approved_total_usd) > 500 ||
        p.owner_accepted_external_disclosure !== true ||
        p.owner_accepted_unverified_residency !== true ||
        p.provider_hard_cost_cap_enforced !== false ||
        p.automatic_retries !== false ||
        p.routing_posture !== 'owner_approved_tier_default_after_calibration_expired' ||
        // Server PolicyRail expiry is bounded by the sealed operation, not a
        // rolling preview lease. The separate FULL/L3 VAT keeps its short TTL.
        !awareTime(p.expiry) ||
        Date.parse(p.expiry) <= Date.now() ||
        p.ready_for_owner_critic_vac !== true ||
        p.review_submission_started !== false) return false;
    var providers = [], families = [];
    for (var i = 0; i < 2; i++) {
      var r = p.reviewers[i];
      if (!exactKeys(r, ['provider', 'model', 'model_family', 'provider_tier',
            'data_training_posture', 'evidence_url', 'processing_jurisdiction',
            'retention_posture']) ||
          ['openai', 'groq', 'xai', 'google'].indexOf(r.provider) < 0 ||
          typeof r.model !== 'string' || !r.model || r.model.length > 160 ||
          ['openai_gpt', 'qwen', 'llama', 'xai_grok', 'google_gemini'].indexOf(r.model_family) < 0 ||
          r.provider_tier !== 'paid_api' ||
          r.data_training_posture !== 'owner_verified_no_training' ||
          typeof r.evidence_url !== 'string' ||
          !/^https:\/\/[A-Za-z0-9.-]+(?:\/[^?#]*)?$/.test(r.evidence_url) ||
          r.processing_jurisdiction !== 'global_unverified' ||
          ['provider_default_disclosed', 'zdr_verified'].indexOf(r.retention_posture) < 0 ||
          providers.indexOf(r.provider) >= 0 || families.indexOf(r.model_family) >= 0) return false;
      providers.push(r.provider); families.push(r.model_family);
    }
    return true;
  }

  function renderCriticPreview() {
    if (!criticReview || !operation || !sessionToken || !subject) return;
    if (operation.actor.toLowerCase() !== subject || Date.parse(operation.expiry) <= Date.now()) {
      operationRefused(); return;
    }
    if (document.getElementById('vacCriticReview')) return;
    var box = document.createElement('section');
    box.id = 'vacCriticReview';
    box.setAttribute('aria-label', 'Review the exact external critic disclosure');
    box.style.cssText = 'max-height:55vh;overflow:auto;max-width:860px;margin:12px auto;text-align:left;overflow-wrap:anywhere;';
    var heading = document.createElement('h2');
    var recovery = operation.recovery;
    heading.textContent = recovery ? 'Authorise ONE replacement attempt — TWO ADDITIONAL paid A2 reviews' :
      'Approve and start TWO paid external A2 critic reviews';
    box.appendChild(heading);
    if (recovery) {
      var replacementNotice = document.createElement('p');
      replacementNotice.id = 'vacCriticRecoveryDisclosure';
      replacementNotice.textContent = 'ONE manual replacement attempt, for the same source and PLAN: exactly TWO ADDITIONAL paid external model calls. Prior timed-out calls may be charged. No further retry is authorised. The original failed job remains on record; this does not restart it or approve Flux design.';
      box.appendChild(replacementNotice);
    }
    var warning = document.createElement('p');
    warning.textContent = 'IMPORTANT: Completing FULL/L3 VAC and confirming below will hand Athena proof to IMMEDIATELY queue the FULL confidential source and 113-row PLAN to exactly TWO paid external model reviewers. Provider costs and external processing may start right away; the task cannot be recalled by closing this window. No provider-enforced per-job hard cost stop, no automatic retry and no third synthesis model. This is SEPARATE from and does NOT authorise the later Flux create_thread design task, manufacturing, customer sharing or further spending.';
    box.appendChild(warning);
    var fields = [
      ['Owner', operation.actor], ['Tenant', operation.tenant_id],
      ['Athena principal', operation.principal], ['Exact project', operation.project_url],
      ['Confidential source', 'FULL source scope and canonical PLAN will be sent to two external model providers'],
      ['Reviewed source bytes', operation.source_bytes],
      ['Source SHA-256', operation.source_sha256],
      ['Canonical PLAN obligations', operation.canonical_plan_rows + ' exact rows'],
      ['Reviewers', 'Exactly two distinct paid providers and model families'],
      ['Effect of this approval', 'Athena will immediately queue exactly TWO paid external model API calls with the confidential source and PLAN, after server-side one-use grant verification'],
      ['Irreversibility', 'External processing and charges may start after confirmation; closing VAC cannot recall a submitted provider call'], 
      ['Orchestration and synthesis', 'COLLECT ONLY: exactly two paid reviewer calls; no third synthesis model or hidden model vendor'],
      ['Reviewer call limit', operation.reviewer_call_limit + ' total; no third model'],
      ['Maximum output tokens', operation.max_tokens_per_provider + ' per provider, not a USD bill guarantee'],
      ['Owner-approved total exposure', operation.approved_total_usd + ' USD, a POLICY amount — NOT a provider-enforced hard cap'],
      ['Provider hard cost stop', 'NOT AVAILABLE'],
      ['Training posture', 'Owner-evidenced no-training claims; see individual provider evidence URLs'],
      ['Processing jurisdiction', 'GLOBAL / UNVERIFIED; no locality guarantee'],
      ['Retention', 'Provider-specific; may retain content under disclosed default terms unless ZDR verified'],
      ['Privacy minimisation', 'Identity labels are reduced to SHA-256 in the submitted A2 prompt; the exact reviewed source and obligation rows still leave Athena'],
      ['Automatic retries', 'OFF'],
      ['Routing', 'Owner-approved tier default after calibration expiry; no silent provider substitution'],
      ['Expiry', operation.expiry], ['Operation digest', operation.operation_digest],
      ['External review policy SHA-256', operation.policy_sha256],
      ['Exact review nonce', state]
    ];
    if (recovery) {
      fields.push(['Replacement scope', 'One manual replacement attempt; two ADDITIONAL calls; no further retry'],
        ['Original grant', recovery.parent_grant_id], ['Original failed job', recovery.parent_job_id],
        ['Original failure result SHA-256', recovery.parent_result_sha256],
        ['Unchanged PLAN seal SHA-256', recovery.plan_seal_sha256],
        ['Prior-call charges', 'Prior timed-out calls may be charged in addition to this replacement']);
    }
    operation.reviewers.forEach(function (r, i) {
      fields.push(['Reviewer ' + (i + 1), r.provider + ' / ' + r.model +
        ' (' + r.model_family + '); paid API; jurisdiction ' +
        r.processing_jurisdiction + '; retention ' + r.retention_posture +
        '; no-training posture ' + r.data_training_posture +
        '; evidence ' + r.evidence_url]);
    });
    fields.forEach(function (entry) {
      var p = document.createElement('p');
      p.textContent = entry[0] + ': ' + String(entry[1]);
      box.appendChild(p);
    });
    var confirm = document.createElement('button');
    confirm.id = 'vacCriticReviewConfirm'; confirm.type = 'button';
    confirm.textContent = recovery ? 'I authorise ONE replacement attempt — TWO ADDITIONAL paid A2 reviews' :
      'I authorise Athena to START TWO paid external A2 reviews';
    confirm.style.cssText = 'min-height:44px;margin:12px 0;padding:12px 22px;background:#10B981;color:#07130f;border:0;border-radius:12px;font:700 16px system-ui;';
    confirm.addEventListener('click', function () {
      if (recovery && (operationConfirmed || sending || acked || replacementDeliveryAttempted)) return;
      if (!operation || operation.actor.toLowerCase() !== subject ||
          Date.parse(operation.expiry) <= Date.now()) { operationRefused(); return; }
      operationConfirmed = true; confirm.disabled = true; send();
    });
    box.appendChild(confirm);
    panel().appendChild(box);
    show('info', recovery ?
      'This replacement has not started. Fresh FULL/L3 consent authorises TWO ADDITIONAL paid calls for the same source and PLAN. Prior timed-out calls may be charged; no further retry or Flux design is authorised.' :
      'No critic or Flux design task has started yet. Deliberately confirming authorises immediate queueing of TWO paid external model calls; Flux design remains separate.', false);
  }

  function receiveCriticPreview(message) {
    if (!criticReview || !sessionToken || !subject ||
        operation || operationConfirmed || sending || acked ||
        message.type !== 'vac-critic-review-preview' || message.state !== state) return;
    var preview;
    try {
      // Validate before cloning as well: JSON serialization must not silently
      // drop an explicitly present, invalid recovery (for example undefined).
      if (!validCriticPreview(message.preview)) { operationRefused(); return; }
      preview = JSON.parse(JSON.stringify(message.preview));
    }
    catch (_error) { operationRefused(); return; }
    if (!validCriticPreview(preview)) { operationRefused(); return; }
    var generation = ++operationGeneration;
    // Python canonical_json_hash sorts the fixed ASCII/scalar binding. No
    // URL-supplied policy and no claim that the rest of preview is a signed
    // provider receipt; Athena's confirmation endpoint verifies it separately.
    var nonceText = criticNonceText(preview);
    Promise.resolve().then(function () {
      return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonceText));
    }).then(function (digest) {
      if (generation !== operationGeneration) return;
      var hex = Array.prototype.map.call(new Uint8Array(digest),
        function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      if (hex !== state) { operationRefused(); return; }
      operation = JSON.parse(JSON.stringify(preview));
      operationJson = JSON.stringify(preview);
      renderCriticPreview();
    }, function () { if (generation === operationGeneration) operationRefused(); });
  }

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

  function mint(generation) {
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
        if (reviewedHandoff && generation !== operationGeneration) throw new Error('Verification changed');
        assertion = b.compact_jwt;
        var exp = b.claims && typeof b.claims.exp === 'number' ? b.claims.exp * 1000 : Date.now() + LIFETIME_S * 1000;
        assertionExpMs = exp;
      });
    });
  }

  function deliver() {
    if (kind === 'decisions-confirm' && (!continuationFresh() || !challengeConsumed)) return;
    var replacement = criticReview && operation && operation.recovery;
    if (replacementDeliveryAttempted) return;
    if (!openerPresent()) {
      show('warn', 'Return to ' + (toAthena ? 'the Athena' : 'the Vault') + ' tab. This page was not opened from ' + destination +
        ' (or that tab was closed), so nothing was sent. Start the ' + actionName + ' again from ' + destination + '.', false);
      return;
    }
    if (replacement) {
      // A replacement is a new, separately approved paid attempt, not a
      // retryable delivery loop. Uncertain receipt must be reconciled in Athena.
      replacementDeliveryAttempted = true;
      try { window.opener.postMessage({ type: MSG, state: state, assertion: assertion }, target.origin); }
      catch (_error) {
        show('warn', 'Replacement outcome UNKNOWN. The TWO ADDITIONAL paid calls may already have started. Do NOT retry or repeat VAC; check Athena’s exact job receipt. Prior timed-out calls may be charged.', false);
        return;
      }
    } else window.opener.postMessage({ type: MSG, state: state, assertion: assertion }, target.origin);
    delivered = true;
    show('info', replacement ?
      'Replacement authorisation sent to Athena. TWO ADDITIONAL paid calls may start after server checks. Prior timed-out calls may be charged. Do NOT retry; check Athena’s job receipt. This is not proof that reviews completed.' :
      'Sent to ' + destination + '. Return to that tab to finish ' + actionName + '.', !replacement);
    clearTimeout(ackTimer);
    ackTimer = setTimeout(function () {
      if (!acked) {
        show('warn', replacement ?
          'Replacement outcome UNKNOWN: Athena has not acknowledged here. TWO ADDITIONAL paid calls may already have started. Do NOT retry or repeat VAC; check Athena’s exact job receipt. Prior timed-out calls may be charged.' :
          destination + ' has not confirmed yet. Switch back to it; if it is still waiting, ' +
          'come back here and tap “Send to ' + destination + ' again”.', !replacement);
      }
    }, ACK_WAIT_MS);
  }

  function send() {
    if (replacementDeliveryAttempted) return;
    if (sending || acked || (kind === 'decisions-confirm' && (!challengeConsumed || !continuationFresh()))) return;
    if (reviewedHandoff && (!operationConfirmed || !operation ||
        operation.actor.toLowerCase() !== subject || Date.parse(operation.expiry) <= Date.now())) {
      if (criticReview) renderCriticPreview(); else renderOperation(); return;
    }
    // No opener (or it closed): deliver() says "return to the Vault tab"; nothing is minted.
    if (!openerPresent()) { deliver(); return; }
    sending = true;
    var generation = operationGeneration;
    var ready = (assertion && Date.now() < assertionExpMs - 5000) ? Promise.resolve() : mint(generation);
    ready.then(function () {
      if (reviewedHandoff && generation !== operationGeneration) return;
      if (reviewedHandoff && (!operationConfirmed || !operation ||
          operation.actor.toLowerCase() !== subject ||
          Date.parse(operation.expiry) <= Date.now())) {
        operationRefused(); return;
      }
      deliver();
    }, function (e) {
      if (reviewedHandoff && generation !== operationGeneration) return;
      show('error', 'Could not prepare the handoff to ' + destination + ' (' + e.message + '). Return to ' + destination + ' and start again.', false);
    }).then(function () { if (!reviewedHandoff || generation === operationGeneration) sending = false; },
      function () { if (!reviewedHandoff || generation === operationGeneration) sending = false; });
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
      if (serviceOperation && m.type === 'vac-service-operation-intent' && m.state === state) {
        if (!sessionToken || !subject) return;
        receiveOperation(m); return;
      }
      if (criticReview && m.type === 'vac-critic-review-preview' && m.state === state) {
        if (!sessionToken || !subject) return;
        receiveCriticPreview(m); return;
      }
      if (m.type !== ACK || m.state !== state) return;
      if (reviewedHandoff && (!operationConfirmed || !assertion)) return;
      if (acked || !delivered) return;
      if (kind === 'decisions-confirm' && (!challengeConsumed || !continuationFresh())) return;
      if (kind === 'decisions-confirm' && m.status !== 'identity_verified_action_held' && m.status !== 'confirmed') return;
      acked = true;
      clearTimeout(ackTimer);
      assertion = null;
      sessionToken = null;
      if (kind === 'decisions-confirm') {
        if (m.status === 'confirmed') {
          show('ok', 'Athena recorded the decision receipt. Return to Athena to review it.', false);
        } else {
          show('warn', 'Athena checked your identity. The decision is still held; nothing has been authorised. Return to Athena for the next step.', false);
        }
      } else if (criticReview) {
        show('warn', operation && operation.recovery ?
          'Athena acknowledged the ONE replacement authorisation for TWO ADDITIONAL paid calls. Prior timed-out calls may be charged. No further retry is authorised. Check Athena for the exact job receipt and outcome; this is not proof of review completion and does NOT approve the Flux design task.' :
          'Athena received the one-time critic-review verification. The owner tab may now queue TWO paid external model calls immediately after server grant checks. Check Athena for the exact job receipt; this does NOT approve the Flux design task.', false);
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
      if (replacementDeliveryAttempted) return;
      serviceSessionChanged();
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
      if (reviewedHandoff) {
        show('info', criticReview ?
          'Identity verified. Waiting for Athena’s exact external-critic policy. No model or Flux design task has been authorised.' :
          'Identity verified. Waiting for the exact operation from Athena; nothing has been authorised yet.', false);
        requestOperation();
        if (criticReview) renderCriticPreview(); else renderOperation();
        return;
      }
      send();
    }
  };
  if (valid && kind === 'decisions-confirm' && openerPresent()) {
    window.opener.postMessage({type:'vac-continuation-ready', state:state}, target.origin);
  }
})();



