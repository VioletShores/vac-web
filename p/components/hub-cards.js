/* hub-cards.js v1
 * Rob's Hub card component library — vanilla JS, no build step, no framework.
 * Include: <script src="/p/components/hub-cards.js"></script>
 *
 * L-2330: reviewCard throws at call time if next_action absent — dead-ends structurally impossible.
 * L-2351: decisionCard seal IS the transport action (WhatsApp link or chat phrase, never local state).
 *
 * Assumes .page-shell context with CSS vars --bg, --panel, --line, --gold, --gold-dim,
 * --text, --muted, --green, --clay, --blue defined on :root.
 */
(function (global) {
  'use strict';

  var _injected = false;

  function _injectStyles() {
    if (_injected) return;
    _injected = true;
    var el = document.createElement('style');
    el.id = 'hub-cards-styles';
    el.textContent = [
      /* card base */
      '.hc-card{background:var(--panel,#101827);border:1px solid var(--line,#1E2A3D);border-radius:11px;padding:14px 16px;margin:11px 0;font-size:13px;line-height:1.6;color:var(--muted,#93A1B8)}',
      '.hc-card b{color:var(--text,#E8EDF5)}',
      /* accent borders */
      '.hc-green{border-left:3px solid var(--green,#5FB87A)}',
      '.hc-clay{border-left:3px solid var(--clay,#D9705F)}',
      '.hc-blue{border-left:3px solid var(--blue,#6FA8DC)}',
      '.hc-gold{border-left:3px solid var(--gold,#D4A94E)}',
      /* card head */
      '.hc-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}',
      '.hc-title{font-size:13.5px;font-weight:600;color:var(--text,#E8EDF5)}',
      '.hc-tag{font-family:"JetBrains Mono",monospace;font-size:9.5px;padding:2px 7px;border-radius:4px;border:1px solid var(--gold-dim,#8A7233);color:var(--gold,#D4A94E);white-space:nowrap}',
      /* evidence links row */
      '.hc-evidence{margin-top:10px;display:flex;flex-wrap:wrap;gap:4px 2px;align-items:center}',
      '.hc-ev-link{color:var(--blue,#6FA8DC);font-size:12px;text-decoration:none}',
      '.hc-ev-link:hover{text-decoration:underline}',
      '.hc-ev-sep{color:var(--line,#1E2A3D);font-size:12px;padding:0 2px}',
      /* next action footer (reviewCard) */
      '.hc-next{display:flex;align-items:flex-start;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--line,#1E2A3D)}',
      '.hc-next-icon{flex-shrink:0;margin-top:2px;color:var(--gold,#D4A94E)}',
      '.hc-next-lbl{font-size:12.5px;font-weight:600;color:var(--text,#E8EDF5)}',
      '.hc-next-how{display:block;font-size:11.5px;color:var(--muted,#93A1B8);margin-top:3px}',
      /* evidence sub-sections inside evidence_html */
      '.hc-ev-s{margin-bottom:10px}',
      '.hc-ev-s:last-child{margin-bottom:0}',
      /* decision card: options */
      '.hc-options{margin-top:10px;display:flex;flex-direction:column;gap:4px}',
      '.hc-option{font-size:12.5px;color:var(--muted,#93A1B8)}',
      '.hc-option b{color:var(--text,#E8EDF5)}',
      /* decision card: optional text input */
      '.hc-input{width:100%;min-height:52px;background:#0D1420;border:1px solid var(--line,#1E2A3D);border-radius:8px;color:var(--text,#E8EDF5);font-family:"Inter",sans-serif;font-size:13px;padding:10px;margin-top:10px;resize:vertical;box-sizing:border-box}',
      /* seal section */
      '.hc-seal{margin-top:13px;padding-top:12px;border-top:1px solid var(--line,#1E2A3D)}',
      '.hc-seal-wa{display:inline-flex;align-items:center;gap:8px;background:#1a7a4a;color:#fff;text-decoration:none;border-radius:8px;padding:10px 16px;font-size:13px;font-weight:600;line-height:1}',
      '.hc-seal-wa:hover{background:#20924f}',
      '.hc-seal-wa svg{flex-shrink:0}',
      '.hc-seal-note{margin-top:8px;font-size:10.5px;font-family:"JetBrains Mono",monospace;color:var(--gold-dim,#8A7233);line-height:1.5}',
      '.hc-seal-chat{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.hc-seal-chat-lbl{font-size:12px;color:var(--muted,#93A1B8)}',
      '.hc-seal-phrase{font-family:"JetBrains Mono",monospace;font-size:12px;background:#070B12;padding:4px 10px;border-radius:5px;color:var(--gold,#D4A94E);border:1px solid var(--line,#1E2A3D)}',
      /* pre blocks inside summary/evidence html */
      '.hc-card pre{background:#070B12;border-radius:8px;padding:10px;font-family:"JetBrains Mono",monospace;font-size:10.5px;color:#B8C4D8;overflow-x:auto;line-height:1.5;margin:8px 0}',
      /* table inside cards */
      '.hc-card table{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0}',
      '.hc-card td,.hc-card th{padding:5px 8px;border-bottom:1px solid var(--line,#1E2A3D);text-align:left}',
      '.hc-card th{font-family:"JetBrains Mono",monospace;font-size:9.5px;text-transform:uppercase;color:var(--gold-dim,#8A7233)}',
      '.hc-card a{color:var(--blue,#6FA8DC)}',
    ].join('');
    document.head.appendChild(el);
  }

  /* Custom SVG arrow — right-pointing, no emoji/system icon */
  var ARROW_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

  /* Custom SVG speech-bubble icon for WhatsApp transport — no system emoji */
  var WA_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12.05 2C6.495 2 2 6.494 2 12.05c0 1.923.506 3.728 1.386 5.284L2 22l4.804-1.37A10.02 10.02 0 0 0 12.05 22C17.605 22 22 17.506 22 11.95 22 6.395 17.605 2 12.05 2zm0 18.316a8.269 8.269 0 0 1-4.237-1.166l-.302-.18-3.147.824.857-3.065-.198-.314A8.27 8.27 0 0 1 3.734 11.95c0-4.587 3.73-8.316 8.316-8.316s8.316 3.73 8.316 8.316c0 4.587-3.73 8.316-8.316 8.316z"/></svg>';

  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * reviewCard(cfg) → HTML string
   *
   * cfg: {
   *   id:             string  — unique id (used for DOM id="hc-{id}")
   *   title:          string  — plain-English card title
   *   status?:        string  — short status label (DONE, RUNNING, REVIEW NEEDED, …)
   *   accent?:        'green'|'clay'|'blue'|'gold'  — left-border accent colour
   *   summary_html:   string  — body HTML (may include tables, <b>, <pre>)
   *   evidence_links: [{label, url}]  — REQUIRED, at least one
   *   next_action:    {label, how?}   — REQUIRED (L-2330: no dead-ends)
   * }
   *
   * Throws at call time if next_action or evidence_links missing — dead-ends structurally impossible.
   */
  function reviewCard(cfg) {
    if (!cfg.next_action) {
      throw new Error(
        'HubCards.reviewCard("' + cfg.id + '"): next_action is required — no dead-ends (L-2330). ' +
        'Provide {label, how?} or the card cannot be composed.'
      );
    }
    if (!cfg.evidence_links || cfg.evidence_links.length === 0) {
      throw new Error(
        'HubCards.reviewCard("' + cfg.id + '"): evidence_links required (at least one {label, url}).'
      );
    }
    _injectStyles();

    var accentClass = cfg.accent ? ' hc-' + cfg.accent : '';

    var headHTML = '<div class="hc-head"><span class="hc-title">' + _esc(cfg.title) + '</span>';
    if (cfg.status) {
      headHTML += '<span class="hc-tag">' + _esc(cfg.status) + '</span>';
    }
    headHTML += '</div>';

    var evLinks = cfg.evidence_links.map(function (l) {
      return '<a href="' + _esc(l.url) + '" class="hc-ev-link" target="_blank" rel="noopener">' + _esc(l.label) + '</a>';
    }).join('<span class="hc-ev-sep">·</span>');

    var nextHowHTML = cfg.next_action.how
      ? '<span class="hc-next-how">' + _esc(cfg.next_action.how) + '</span>'
      : '';

    var nextHTML = '<div class="hc-next">'
      + '<span class="hc-next-icon">' + ARROW_SVG + '</span>'
      + '<div><span class="hc-next-lbl">' + _esc(cfg.next_action.label) + '</span>'
      + nextHowHTML + '</div>'
      + '</div>';

    return '<div class="hc-card hc-review' + accentClass + '" id="hc-' + _esc(cfg.id) + '">'
      + headHTML
      + '<div class="hc-body">' + (cfg.summary_html || '') + '</div>'
      + '<div class="hc-evidence">' + evLinks + '</div>'
      + nextHTML
      + '</div>';
  }

  /**
   * decisionCard(cfg) → HTML string
   *
   * cfg: {
   *   id:                string   — unique id
   *   title:             string   — plain-English decision question
   *   evidence_html:     string   — full evidence HTML (root-cause, diagrams, proposed fix, …)
   *   options?:          [{label, verb}]  — choices to display (e.g. Approve / Hold)
   *   input_placeholder?: string  — optional freetext input for Rob's notes
   *   seal_transport:    one of:
   *     {type:'whatsapp', prefill:string}  → renders wa.me/61418409944?text= prefilled link
   *       '{id}' in prefill is replaced with cfg.id at render time
   *     {type:'chat', say:string}          → renders the exact phrase to say in chat
   * }
   *
   * Throws at call time if seal_transport missing (L-2351: the seal IS the transport action).
   * No local-state seal buttons — every decision has a real durable transport.
   */
  function decisionCard(cfg) {
    if (!cfg.seal_transport) {
      throw new Error(
        'HubCards.decisionCard("' + cfg.id + '"): seal_transport is required (L-2351). ' +
        'Provide {type:"whatsapp", prefill:"..."} or {type:"chat", say:"..."}.'
      );
    }
    _injectStyles();

    var optionsHTML = '';
    if (cfg.options && cfg.options.length > 0) {
      optionsHTML = '<div class="hc-options">'
        + cfg.options.map(function (o) {
          return '<div class="hc-option"><b>' + _esc(o.label) + '</b> — ' + _esc(o.verb) + '</div>';
        }).join('')
        + '</div>';
    }

    var inputHTML = cfg.input_placeholder
      ? '<textarea class="hc-input" placeholder="' + _esc(cfg.input_placeholder) + '"></textarea>'
      : '';

    var sealInner;
    var st = cfg.seal_transport;

    if (st.type === 'whatsapp') {
      var prefillText = (st.prefill || '').replace('{id}', cfg.id);
      var waHref = 'https://wa.me/61418409944?text=' + encodeURIComponent(prefillText);
      sealInner = '<a href="' + waHref + '" class="hc-seal-wa" target="_blank" rel="noopener">'
        + WA_SVG + ' Send approval via WhatsApp</a>'
        + '<p class="hc-seal-note">Opens WhatsApp with message &ldquo;' + _esc(prefillText) + '&rdquo; &mdash; '
        + 'your send IS the seal (L-2351). Becomes durable receipt once task 308 reply-recorder merges.</p>';
    } else if (st.type === 'chat') {
      sealInner = '<div class="hc-seal-chat">'
        + '<span class="hc-seal-chat-lbl">Say in chat:</span>'
        + '<code class="hc-seal-phrase">' + _esc(st.say) + '</code>'
        + '</div>';
    } else {
      throw new Error(
        'HubCards.decisionCard("' + cfg.id + '"): unknown seal_transport.type "' + st.type + '". '
        + 'Use "whatsapp" or "chat".'
      );
    }

    return '<div class="hc-card hc-decision hc-gold" id="hc-' + _esc(cfg.id) + '">'
      + '<div class="hc-head"><span class="hc-title">' + _esc(cfg.title) + '</span></div>'
      + '<div class="hc-body">' + (cfg.evidence_html || '') + '</div>'
      + optionsHTML
      + inputHTML
      + '<div class="hc-seal">' + sealInner + '</div>'
      + '</div>';
  }

  global.HubCards = { reviewCard: reviewCard, decisionCard: decisionCard };

})(window);
