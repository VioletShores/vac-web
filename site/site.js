/* vacprotocol.org — shared site script (S204 rebuild).
 *
 * Every figure on the site comes from the Athena Data snapshot at
 * /data/company-facts.json, rendered at load. HTML carries only the key:
 *   <span data-fact="patents.total.claims"></span>
 * Only facts marked public:true are shown. A missing or non-public fact
 * renders as an em dash with a "not yet published" title, never a guess.
 *
 * Product status chips (Live / Built / Coming) read product.<name>.status:
 *   <span class="chip" data-status="vac"></span>
 * A status that is missing renders as "Status pending", never a default.
 */
(function () {
  'use strict';
  var FACTS_URL = '/data/company-facts.json';
  var facts = {};
  var generatedAt = null;

  function isPublic(f) { return !!f && f.public === true; }
  function get(key) { var f = facts[key]; return isPublic(f) ? f : null; }
  function text(f) {
    if (!f) return null;
    if (f.display != null && String(f.display).trim() !== '') return String(f.display);
    if (f.value == null) return null;
    if (Array.isArray(f.value)) return f.value.map(function (v) { return typeof v === 'object' ? (v.name || v.title || JSON.stringify(v)) : String(v); }).join(', ');
    if (typeof f.value === 'object') return null;
    return String(f.value);
  }
  function titleFor(f) {
    var bits = ['Athena Data'];
    if (f.source) bits.push(String(f.source));
    if (f.last_updated) bits.push('updated ' + String(f.last_updated));
    return bits.join(' · ');
  }

  // product.<name>.status — try the forms a registry key could take.
  function statusKeys(name) {
    var n = String(name).toLowerCase().trim();
    var forms = [n, n.replace(/[\s-]+/g, '_'), n.replace(/[\s_]+/g, '-'), n.replace(/[\s_-]+/g, '')];
    var stripped = n.replace(/^athena[\s_-]+/, '');
    if (stripped !== n) forms.push(stripped, stripped.replace(/[\s-]+/g, '_'), stripped.replace(/[\s_]+/g, '-'), stripped.replace(/[\s_-]+/g, ''));
    var out = [];
    forms.forEach(function (x) { var k = 'product.' + x + '.status'; if (out.indexOf(k) < 0) out.push(k); });
    return out;
  }
  function stateOf(raw) {
    var s = String(raw || '').toLowerCase();
    if (/\blive\b/.test(s)) return 'live';
    if (/\bbuilt\b/.test(s)) return 'built';
    if (/\b(coming|planned|proposed|designed)\b/.test(s)) return 'coming';
    return null;
  }

  function renderFacts() {
    document.querySelectorAll('[data-fact]').forEach(function (el) {
      var key = el.getAttribute('data-fact');
      var f = get(key);
      var t = text(f);
      // data-mode="count": a list-valued fact shown as how many entries it has.
      if (f && el.getAttribute('data-mode') === 'count') {
        t = Array.isArray(f.value) ? String(f.value.length)
          : (typeof f.value === 'number' ? String(f.value)
          : (f.count != null ? String(f.count) : null));
      }
      if (t) {
        el.textContent = t;
        el.title = titleFor(f);
        el.classList.remove('pending');
      } else {
        el.textContent = el.getAttribute('data-fallback') || '—';
        el.title = 'Not yet published in Athena Data (' + key + ')';
        el.classList.add('pending');
        var block = el.closest('[data-fact-block]');
        if (block && block.hasAttribute('data-hide-if-missing')) block.hidden = true;
      }
    });
  }

  function renderStatuses() {
    document.querySelectorAll('[data-status]').forEach(function (el) {
      var keys = statusKeys(el.getAttribute('data-status'));
      var f = null, used = keys[0];
      for (var i = 0; i < keys.length && !f; i++) { f = get(keys[i]); if (f) used = keys[i]; }
      var raw = text(f);
      var st = stateOf(raw);
      el.classList.remove('live', 'built', 'coming', 'pending');
      if (st) {
        el.textContent = st.toUpperCase();
        el.classList.add(st);
        el.title = titleFor(f);
      } else {
        el.textContent = raw ? raw : 'Status pending';
        el.classList.add('pending');
        el.title = raw ? titleFor(f) : 'Not yet published in Athena Data (' + used + ')';
      }
      var node = el.closest('.node');
      if (node) node.setAttribute('data-state', st || 'pending');
    });
  }

  // ietf.drafts may be a list of drafts; render it where a page asks.
  function renderLists() {
    document.querySelectorAll('[data-fact-list]').forEach(function (ul) {
      var f = get(ul.getAttribute('data-fact-list'));
      if (!f || !Array.isArray(f.value) || !f.value.length) return; // static markup stays
      ul.innerHTML = '';
      f.value.forEach(function (d) {
        var li = document.createElement('li');
        if (d && typeof d === 'object') {
          var name = d.name || d.draft || d.title || '';
          var b = document.createElement('code'); b.textContent = name + (d.version ? '-' + String(d.version).replace(/^-/, '') : '');
          li.appendChild(b);
          var rest = [d.title && d.title !== name ? d.title : '', d.status || '', d.date || d.posted || ''].filter(Boolean).join(' · ');
          if (rest) li.appendChild(document.createTextNode(' — ' + rest));
        } else {
          li.textContent = String(d);
        }
        ul.appendChild(li);
      });
      ul.title = titleFor(f);
    });
  }

  function renderAsOf() {
    document.querySelectorAll('[data-facts-asof]').forEach(function (el) {
      el.textContent = generatedAt ? String(generatedAt).slice(0, 10) : 'not yet available';
    });
  }

  function apply(data) {
    facts = (data && data.facts && typeof data.facts === 'object') ? data.facts : {};
    generatedAt = data && data.generated_at ? data.generated_at : null;
    renderFacts(); renderStatuses(); renderLists(); renderAsOf();
    document.documentElement.setAttribute('data-facts', Object.keys(facts).length ? 'loaded' : 'missing');
  }

  window.VACFacts = { get: get, text: function (k) { return text(get(k)); } };

  // Old single-page anchors on the home page now live on their own pages.
  if (document.body && document.body.getAttribute('data-page') === 'home' && location.hash) {
    var moved = {
      '#problem': '/protocol', '#how': '/protocol', '#capabilities': '/protocol#scope',
      '#architecture': '/protocol#layers', '#alignment': '/regulatory', '#ip': '/ip',
      '#contact': '/contact', '#standards': '/specifications'
    };
    var to = moved[location.hash];
    if (to) location.replace(to);
  }

  function load() {
    fetch(FACTS_URL, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(apply)
      .catch(function () { apply(null); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
})();
