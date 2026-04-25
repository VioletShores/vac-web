/**
 * athena-chat.js — Reusable conversational copilot component
 * Embed in any copilot page. Provides floating chat button, message thread,
 * voice input (Deepgram → Web Speech API fallback), Anthropic API calls,
 * and localStorage thread persistence.
 *
 * Usage:
 *   <script src="/athena-chat.js"></script>
 *   <script>
 *     AthenaChat.init({
 *       apiKey:       'sk-ant-...',        // Anthropic API key (or read from localStorage)
 *       systemPrompt: 'You are ...',        // Copilot system prompt
 *       threadKey:    'regatta',            // localStorage key suffix
 *       title:        'Regatta Copilot',    // Panel title
 *       accentColor:  '#C9A84C',            // Optional accent colour
 *       deepgramKey:  null,                 // Optional Deepgram key (falls back to Web Speech)
 *     });
 *   </script>
 */
(function () {
  'use strict';

  /* ─── PUBLIC API ────────────────────────────────────────────────── */
  window.AthenaChat = {
    init: _init,
    open: function () { _open(); },
    close: function () { _close(); },
  };

  /* ─── STATE ──────────────────────────────────────────────────────── */
  var _cfg = {
    apiKey:       null,
    deepgramKey:  null,
    systemPrompt: 'You are Athena, a helpful AI copilot. Be concise and practical.',
    threadKey:    'default',
    title:        'Athena',
    accentColor:  '#C9A84C',
  };

  var _thread      = [];   // [{role, content}]
  var _isOpen      = false;
  var _fab, _panel, _msgList, _textInput, _micBtn, _sendBtn;

  // Voice state
  var _voiceActive   = false;
  var _mediaStream   = null;
  var _mediaRecorder = null;
  var _recChunks     = [];
  var _audioCtx      = null;
  var _analyser      = null;
  var _animFrame     = null;
  var _speechRec     = null;
  var _liveText      = '';

  /* ─── INIT ───────────────────────────────────────────────────────── */
  function _init(cfg) {
    if (cfg) Object.keys(cfg).forEach(function (k) { _cfg[k] = cfg[k]; });
    _loadThread();
    _injectStyles();
    _buildDOM();
    _bindEvents();
  }

  /* ─── THREAD PERSISTENCE ─────────────────────────────────────────── */
  function _storageKey() {
    var email = (window.VAC_USER && window.VAC_USER.email) || 'anon';
    return 'athena_chat_' + email + '_' + (_cfg.threadKey || 'default');
  }

  function _loadThread() {
    try {
      var raw = localStorage.getItem(_storageKey());
      if (raw) _thread = JSON.parse(raw);
    } catch (e) {}
  }

  function _saveThread() {
    try {
      localStorage.setItem(_storageKey(), JSON.stringify(_thread.slice(-100)));
    } catch (e) {}
  }

  /* ─── STYLES ─────────────────────────────────────────────────────── */
  function _injectStyles() {
    if (document.getElementById('ac-styles')) return;
    var a = _cfg.accentColor || '#C9A84C';
    var css = [
      /* FAB */
      '.ac-fab{position:fixed;bottom:24px;right:20px;width:56px;height:56px;border-radius:50%;background:' + a + ';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,0.45);z-index:9998;transition:transform .2s,box-shadow .2s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}',
      '.ac-fab:hover{transform:scale(1.06);}',
      '.ac-fab:active{transform:scale(0.94);}',

      /* Panel */
      '.ac-panel{position:fixed;bottom:90px;right:16px;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 120px));background:#0D0F17;border:1px solid rgba(201,168,76,0.15);border-radius:16px;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.65);z-index:9997;overflow:hidden;transform:translateY(12px) scale(0.97);opacity:0;pointer-events:none;transition:transform .22s ease,opacity .22s ease;}',
      '.ac-panel.ac-show{transform:translateY(0) scale(1);opacity:1;pointer-events:all;}',

      /* Header */
      '.ac-hdr{padding:13px 16px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}',
      '.ac-hdr-title{font-family:"DM Sans",-apple-system,sans-serif;font-size:14px;font-weight:600;color:#e8eaf0;display:flex;align-items:center;gap:8px;}',
      '.ac-dot{width:8px;height:8px;border-radius:50%;background:' + a + ';}',
      '.ac-x{background:none;border:none;color:#8B8FA4;cursor:pointer;padding:4px;border-radius:6px;display:flex;-webkit-tap-highlight-color:transparent;}',
      '.ac-x:hover{color:#e8eaf0;}',

      /* Messages */
      '.ac-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth;}',
      '.ac-msgs::-webkit-scrollbar{width:3px;}',
      '.ac-msgs::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px;}',

      /* Empty state */
      '.ac-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#8B8FA4;font-family:"DM Sans",-apple-system,sans-serif;font-size:13px;text-align:center;padding:20px;}',
      '.ac-empty-icon{width:42px;height:42px;border-radius:50%;background:rgba(201,168,76,0.07);border:1px solid rgba(201,168,76,0.15);display:flex;align-items:center;justify-content:center;}',

      /* Bubbles */
      '@keyframes ac-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}',
      '.ac-bubble{max-width:86%;font-family:"DM Sans",-apple-system,sans-serif;font-size:13.5px;line-height:1.55;padding:10px 13px;border-radius:12px;animation:ac-in .18s ease;word-break:break-word;white-space:pre-wrap;}',
      '.ac-user{align-self:flex-end;background:rgba(201,168,76,0.14);border:1px solid rgba(201,168,76,0.22);color:#e8eaf0;border-bottom-right-radius:4px;}',
      '.ac-asst{align-self:flex-start;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);color:#e8eaf0;border-bottom-left-radius:4px;}',

      /* Typing indicator */
      '.ac-typing{align-self:flex-start;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:12px;border-bottom-left-radius:4px;padding:12px 14px;display:flex;gap:5px;align-items:center;}',
      '@keyframes ac-bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}',
      '.ac-typing b{width:6px;height:6px;border-radius:50%;background:#8B8FA4;animation:ac-bounce 1.2s ease infinite;display:block;}',
      '.ac-typing b:nth-child(2){animation-delay:.15s;}',
      '.ac-typing b:nth-child(3){animation-delay:.3s;}',

      /* Footer */
      '.ac-ftr{padding:10px 12px;border-top:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;gap:7px;flex-shrink:0;}',

      /* Voice level bar */
      '.ac-lvl{height:3px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;display:none;}',
      '.ac-lvl-fill{height:100%;border-radius:2px;background:' + a + ';width:0%;transition:width .08s;}',
      '.ac-vstatus{font-family:"DM Sans",-apple-system,sans-serif;font-size:11px;color:#8B8FA4;text-align:center;min-height:15px;transition:color .2s;}',

      /* Input row */
      '.ac-row{display:flex;gap:7px;align-items:flex-end;}',
      '.ac-ta{flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:9px 12px;font-family:"DM Sans",-apple-system,sans-serif;font-size:14px;color:#e8eaf0;resize:none;outline:none;min-height:38px;max-height:100px;line-height:1.4;transition:border-color .2s;-webkit-text-size-adjust:100%;}',
      '.ac-ta::placeholder{color:#8B8FA4;}',
      '.ac-ta:focus{border-color:rgba(201,168,76,0.4);}',

      /* Icon buttons */
      '.ac-icon-btn{width:38px;height:38px;flex-shrink:0;border-radius:10px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}',
      '.ac-mic{background:rgba(96,165,250,0.08);border:1px solid rgba(96,165,250,0.3);color:#60a5fa;}',
      '.ac-mic:hover{background:rgba(96,165,250,0.15);}',
      '@keyframes ac-pr{0%,100%{box-shadow:0 0 0 0 rgba(248,113,113,0.4)}50%{box-shadow:0 0 0 8px rgba(248,113,113,0)}}',
      '@keyframes ac-pg{0%,100%{box-shadow:0 0 0 0 rgba(52,211,153,0.3)}50%{box-shadow:0 0 0 8px rgba(52,211,153,0)}}',
      '.ac-mic.ac-rec{background:rgba(248,113,113,0.12);border-color:#f87171;color:#f87171;animation:ac-pr 1.5s ease infinite;}',
      '.ac-mic.ac-micok{background:rgba(52,211,153,0.12);border-color:#34d399;color:#34d399;animation:ac-pg 1.5s ease infinite;}',
      '.ac-send{background:' + a + ';color:#0D0F17;}',
      '.ac-send:hover{filter:brightness(1.1);}',
      '.ac-send:active{transform:scale(0.95);}',
      '.ac-send:disabled{opacity:0.4;cursor:default;filter:none;}',

      /* Key prompt */
      '.ac-key-prompt{font-family:"DM Sans",-apple-system,sans-serif;font-size:12px;color:#8B8FA4;padding:0 4px;}',
      '.ac-key-row{display:flex;gap:6px;align-items:center;}',
      '.ac-key-input{flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 10px;font-family:ui-monospace,monospace;font-size:12px;color:#e8eaf0;outline:none;}',
      '.ac-key-input:focus{border-color:rgba(201,168,76,0.4);}',
      '.ac-key-save{background:' + a + ';color:#0D0F17;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;font-family:"DM Sans",-apple-system,sans-serif;}',

      /* Reduced motion */
      '@media (prefers-reduced-motion:reduce){.ac-bubble,.ac-mic{animation:none!important;}.ac-fab{transition:none;}}',
    ].join('');

    var s = document.createElement('style');
    s.id = 'ac-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ─── BUILD DOM ──────────────────────────────────────────────────── */
  var MIC_SVG  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
  var STOP_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>';
  var SEND_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  var CHAT_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#0D0F17"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';
  var CLOSE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  function _buildDOM() {
    // FAB
    _fab = document.createElement('button');
    _fab.className = 'ac-fab';
    _fab.setAttribute('aria-label', 'Open ' + (_cfg.title || 'Athena') + ' chat');
    _fab.innerHTML = CHAT_SVG;
    document.body.appendChild(_fab);

    // Panel
    _panel = document.createElement('div');
    _panel.className = 'ac-panel';
    _panel.setAttribute('role', 'dialog');
    _panel.setAttribute('aria-label', _cfg.title || 'Athena');
    _panel.innerHTML =
      '<div class="ac-hdr">' +
        '<div class="ac-hdr-title"><div class="ac-dot"></div>' + (_cfg.title || 'Athena') + '</div>' +
        '<button class="ac-x" id="ac-x" aria-label="Close">' + CLOSE_SVG + '</button>' +
      '</div>' +
      '<div class="ac-msgs" id="ac-msgs"></div>' +
      '<div class="ac-ftr">' +
        '<div class="ac-lvl" id="ac-lvl"><div class="ac-lvl-fill" id="ac-fill"></div></div>' +
        '<div class="ac-vstatus" id="ac-vs"></div>' +
        '<div class="ac-row">' +
          '<textarea class="ac-ta" id="ac-ta" placeholder="Ask anything…" rows="1" autocomplete="off" autocorrect="on"></textarea>' +
          '<button class="ac-icon-btn ac-mic" id="ac-mic" aria-label="Voice input">' + MIC_SVG + '</button>' +
          '<button class="ac-icon-btn ac-send" id="ac-send" aria-label="Send">' + SEND_SVG + '</button>' +
        '</div>' +
        '<div id="ac-key-area"></div>' +
      '</div>';
    document.body.appendChild(_panel);

    _msgList   = document.getElementById('ac-msgs');
    _textInput = document.getElementById('ac-ta');
    _micBtn    = document.getElementById('ac-mic');
    _sendBtn   = document.getElementById('ac-send');

    _renderThread();
    _renderKeyArea();
  }

  /* ─── KEY AREA ───────────────────────────────────────────────────── */
  function _getApiKey() {
    return _cfg.apiKey || localStorage.getItem('athena_anthropic_key') || '';
  }

  function _renderKeyArea() {
    var el = document.getElementById('ac-key-area');
    if (!el) return;
    if (_getApiKey()) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML =
      '<div class="ac-key-prompt">No API key — enter your Anthropic key to start chatting:</div>' +
      '<div class="ac-key-row">' +
        '<input class="ac-key-input" id="ac-key-in" type="password" placeholder="sk-ant-api03-…" autocomplete="off" />' +
        '<button class="ac-key-save" id="ac-key-save">Save</button>' +
      '</div>';
    document.getElementById('ac-key-save').addEventListener('click', function () {
      var v = document.getElementById('ac-key-in').value.trim();
      if (!v) return;
      localStorage.setItem('athena_anthropic_key', v);
      _cfg.apiKey = v;
      _renderKeyArea();
    });
    document.getElementById('ac-key-in').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') document.getElementById('ac-key-save').click();
    });
  }

  /* ─── THREAD RENDER ──────────────────────────────────────────────── */
  function _renderThread() {
    if (!_msgList) return;
    _msgList.innerHTML = '';
    if (_thread.length === 0) {
      _msgList.innerHTML =
        '<div class="ac-empty">' +
          '<div class="ac-empty-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="' + (_cfg.accentColor || '#C9A84C') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div>' +
          '<div>Ask me anything</div>' +
          '<div style="font-size:11px;opacity:0.5;">Your context is loaded — just ask</div>' +
        '</div>';
      return;
    }
    _thread.forEach(function (m) {
      if (m.role === 'user' || m.role === 'assistant') {
        _addBubble(m.role, m.content, false);
      }
    });
    _scrollBottom();
  }

  function _addBubble(role, text, animate) {
    var empty = _msgList.querySelector('.ac-empty');
    if (empty) empty.remove();
    var d = document.createElement('div');
    d.className = 'ac-bubble ' + (role === 'user' ? 'ac-user' : 'ac-asst');
    if (animate === false) d.style.animation = 'none';
    d.textContent = text;
    _msgList.appendChild(d);
    if (animate !== false) _scrollBottom();
    return d;
  }

  function _showTyping() {
    var d = document.createElement('div');
    d.className = 'ac-typing';
    d.id = 'ac-typing';
    d.innerHTML = '<b></b><b></b><b></b>';
    _msgList.appendChild(d);
    _scrollBottom();
  }

  function _hideTyping() {
    var t = document.getElementById('ac-typing');
    if (t) t.remove();
  }

  function _scrollBottom() {
    if (_msgList) _msgList.scrollTop = _msgList.scrollHeight;
  }

  /* ─── EVENTS ─────────────────────────────────────────────────────── */
  function _bindEvents() {
    _fab.addEventListener('click', function () { _isOpen ? _close() : _open(); });
    document.getElementById('ac-x').addEventListener('click', _close);
    _sendBtn.addEventListener('click', _sendMsg);
    _micBtn.addEventListener('click', _toggleVoice);

    _textInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendMsg(); }
    });
    _textInput.addEventListener('input', _autoResize);
  }

  function _autoResize() {
    _textInput.style.height = 'auto';
    _textInput.style.height = Math.min(_textInput.scrollHeight, 100) + 'px';
  }

  function _open() {
    _isOpen = true;
    _panel.classList.add('ac-show');
    _fab.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="color:#0D0F17"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    _fab.setAttribute('aria-label', 'Close chat');
    setTimeout(function () { _textInput.focus(); }, 220);
  }

  function _close() {
    _isOpen = false;
    _panel.classList.remove('ac-show');
    _fab.innerHTML = CHAT_SVG;
    _fab.setAttribute('aria-label', 'Open ' + (_cfg.title || 'Athena') + ' chat');
    _stopVoice();
  }

  /* ─── SEND / API CALL ────────────────────────────────────────────── */
  function _sendMsg() {
    var text = _textInput.value.trim();
    if (!text) return;

    _textInput.value = '';
    _textInput.style.height = 'auto';

    _thread.push({ role: 'user', content: text });
    _addBubble('user', text, true);
    _saveThread();
    _callAPI();
  }

  function _callAPI() {
    var apiKey = _getApiKey();
    _sendBtn.disabled = true;
    _showTyping();

    if (!apiKey) {
      _hideTyping();
      _addBubble('assistant', 'No API key set — please enter your Anthropic key below.', true);
      _sendBtn.disabled = false;
      _renderKeyArea();
      return;
    }

    // Build messages array — last 20 turns
    var msgs = _thread.slice(-20).map(function (m) {
      return { role: m.role, content: m.content };
    });

    // Ensure last message is user role
    while (msgs.length > 0 && msgs[msgs.length - 1].role !== 'user') {
      msgs.pop();
    }

    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':    apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system:     _cfg.systemPrompt || 'You are Athena, a helpful AI copilot.',
        messages:   msgs,
      }),
    })
    .then(function (resp) {
      if (!resp.ok) {
        return resp.json().then(function (e) {
          throw new Error((e && e.error && e.error.message) || 'API error ' + resp.status);
        });
      }
      return resp.json();
    })
    .then(function (data) {
      _hideTyping();
      var content = (data.content && data.content[0] && data.content[0].text) || '';
      _thread.push({ role: 'assistant', content: content });
      _addBubble('assistant', content, true);
      _saveThread();
    })
    .catch(function (err) {
      _hideTyping();
      _addBubble('assistant', 'Error: ' + err.message, true);
    })
    .finally(function () {
      _sendBtn.disabled = false;
    });
  }

  /* ─── VOICE INPUT ────────────────────────────────────────────────── */
  // Pipeline pattern from auth.html:
  // getUserMedia → AudioContext (mic level monitor) → MediaRecorder
  // Transcription: Deepgram REST API if key present, else Web Speech Recognition

  function _toggleVoice() {
    _voiceActive ? _stopVoice() : _startVoice();
  }

  function _startVoice() {
    var status = document.getElementById('ac-vs');
    status.textContent = 'Requesting mic…';
    status.style.color = '#8B8FA4';

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (stream) {
        _mediaStream = stream;

        // AudioContext + analyser — confirms mic is live (pattern from auth.html)
        try {
          _audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
          if (_audioCtx.state === 'suspended') _audioCtx.resume();
          _analyser  = _audioCtx.createAnalyser();
          _analyser.fftSize = 256;
          _audioCtx.createMediaStreamSource(stream).connect(_analyser);
        } catch (e) {
          console.warn('[AthenaChat] AudioContext:', e);
        }

        _voiceActive = true;
        _liveText    = '';
        _recChunks   = [];

        _micBtn.classList.add('ac-rec');
        _micBtn.innerHTML  = STOP_SVG;
        _micBtn.setAttribute('aria-label', 'Stop recording');

        document.getElementById('ac-lvl').style.display = 'block';
        status.textContent = 'Speak now…';

        _runLevelMonitor();

        var dgKey = _cfg.deepgramKey || localStorage.getItem('athena_deepgram_key');
        if (dgKey) {
          _startDeepgram(dgKey);
        } else {
          _startSpeechRecognition();
        }
      })
      .catch(function () {
        var status = document.getElementById('ac-vs');
        status.textContent = 'Mic blocked — check browser permissions.';
        status.style.color = '#f87171';
      });
  }

  /* Level monitor — visualises mic activity; confirms mic is working */
  function _runLevelMonitor() {
    if (!_analyser) return;
    var data       = new Uint8Array(_analyser.fftSize);
    var fill       = document.getElementById('ac-fill');
    var status     = document.getElementById('ac-vs');
    var confirmed  = false;
    var accent     = _cfg.accentColor || '#C9A84C';

    function frame() {
      if (!_voiceActive) return;
      if (_audioCtx && _audioCtx.state === 'suspended') _audioCtx.resume();
      _analyser.getByteTimeDomainData(data);
      var maxDev = 0;
      for (var i = 0; i < data.length; i++) {
        var d = Math.abs(data[i] - 128);
        if (d > maxDev) maxDev = d;
      }
      var level = Math.min(100, Math.round((maxDev / 128) * 100));
      fill.style.width = level + '%';
      fill.style.background = level > 50 ? '#fbbf24' : level > 5 ? '#34d399' : accent;

      if (level > 5 && !confirmed) {
        confirmed = true;
        _micBtn.classList.remove('ac-rec');
        _micBtn.classList.add('ac-micok');
        status.textContent = 'Listening…';
        status.style.color = '#34d399';
      }
      _animFrame = requestAnimationFrame(frame);
    }
    _animFrame = requestAnimationFrame(frame);
  }

  /* Deepgram: record full blob then POST to REST API */
  function _startDeepgram(dgKey) {
    var mimes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', ''];
    var mime  = '';
    for (var i = 0; i < mimes.length; i++) {
      if (!mimes[i] || (window.MediaRecorder && MediaRecorder.isTypeSupported(mimes[i]))) {
        mime = mimes[i]; break;
      }
    }
    var opts = mime ? { mimeType: mime } : {};
    try {
      _mediaRecorder = new MediaRecorder(_mediaStream, opts);
    } catch (e) {
      _mediaRecorder = new MediaRecorder(_mediaStream);
      mime = '';
    }
    _mediaRecorder.ondataavailable = function (e) {
      if (e.data && e.data.size > 0) _recChunks.push(e.data);
    };
    _mediaRecorder.onstop = function () {
      _transcribeWithDeepgram(dgKey, mime || 'audio/webm');
    };
    _mediaRecorder.start();
  }

  function _transcribeWithDeepgram(dgKey, mime) {
    var status = document.getElementById('ac-vs');
    if (status) { status.textContent = 'Transcribing…'; status.style.color = '#8B8FA4'; }

    var blob = new Blob(_recChunks, { type: mime });
    if (blob.size < 800) {
      if (status) status.textContent = 'No audio captured — try again.';
      return;
    }

    fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&language=en-AU', {
      method:  'POST',
      headers: { 'Authorization': 'Token ' + dgKey, 'Content-Type': mime },
      body:    blob,
    })
    .then(function (r) {
      if (!r.ok) throw new Error('Deepgram ' + r.status);
      return r.json();
    })
    .then(function (data) {
      var tx = (data.results &&
                data.results.channels &&
                data.results.channels[0] &&
                data.results.channels[0].alternatives &&
                data.results.channels[0].alternatives[0] &&
                data.results.channels[0].alternatives[0].transcript) || '';
      if (tx.trim()) {
        _textInput.value = tx.trim();
        _autoResize();
        if (status) { status.textContent = 'Done — tap send'; status.style.color = '#34d399'; }
        _textInput.focus();
      } else {
        if (status) status.textContent = 'No speech detected — try again.';
      }
    })
    .catch(function (err) {
      if (status) status.textContent = 'Transcription failed: ' + err.message;
      console.error('[AthenaChat] Deepgram error:', err);
    });
  }

  /* Web Speech Recognition — live transcription fallback */
  function _startSpeechRecognition() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      var s = document.getElementById('ac-vs');
      if (s) s.textContent = 'Voice not supported — type instead.';
      return;
    }

    _speechRec = new SR();
    _speechRec.continuous      = true;
    _speechRec.interimResults  = true;
    _speechRec.lang            = 'en-AU';

    var interim = '';
    _speechRec.onresult = function (ev) {
      var finalPart = '';
      interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) {
          finalPart += ev.results[i][0].transcript;
        } else {
          interim += ev.results[i][0].transcript;
        }
      }
      if (finalPart) _liveText += finalPart;
      var display = _liveText + (interim ? ' ' + interim : '');
      if (display.trim()) {
        _textInput.value = display;
        _autoResize();
      }
    };

    _speechRec.onerror = function (e) {
      if (e.error === 'not-allowed') {
        var s = document.getElementById('ac-vs');
        if (s) { s.textContent = 'Mic blocked — check permissions.'; s.style.color = '#f87171'; }
        _stopVoice();
      }
    };

    // Auto-restart on silence — same pattern as regatta copilot
    _speechRec.onend = function () {
      if (_voiceActive) { try { _speechRec.start(); } catch (e) {} }
    };

    try { _speechRec.start(); } catch (e) {}
  }

  function _stopVoice() {
    if (!_voiceActive && !_mediaRecorder) return;

    _voiceActive = false;

    if (_animFrame)      { cancelAnimationFrame(_animFrame); _animFrame = null; }
    if (_speechRec)      { try { _speechRec.stop(); } catch (e) {} _speechRec = null; }

    // Stop MediaRecorder — onstop fires _transcribeWithDeepgram asynchronously
    if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
      _mediaRecorder.stop();
    }
    _mediaRecorder = null;

    if (_mediaStream)    { _mediaStream.getTracks().forEach(function (t) { t.stop(); }); _mediaStream = null; }
    if (_audioCtx)       { try { _audioCtx.close(); } catch (e) {} _audioCtx = null; _analyser = null; }

    _micBtn.classList.remove('ac-rec', 'ac-micok');
    _micBtn.innerHTML = MIC_SVG;
    _micBtn.setAttribute('aria-label', 'Voice input');

    var lvl = document.getElementById('ac-lvl');
    if (lvl) lvl.style.display = 'none';

    var status = document.getElementById('ac-vs');
    // If using speech recognition path, show "tap send" if we have text
    if (status && _liveText.trim()) {
      status.textContent = 'Tap send to submit';
      status.style.color = '#34d399';
    } else if (status && !(_cfg.deepgramKey || localStorage.getItem('athena_deepgram_key'))) {
      // No deepgram, no text — clear status
      status.textContent = '';
    }
    // If deepgram path: status is managed by _transcribeWithDeepgram

    _liveText = '';
  }

})();
