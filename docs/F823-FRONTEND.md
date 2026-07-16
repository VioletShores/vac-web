# F-823 Frontend Plan: Ceremony i18n (Spoken-Language Auto-Adaptation)

## Goal

Internationalise the live ceremony with spoken-language auto-adaptation:
- Initial language from browser locale hint (`navigator.language.startsWith('it')`)
- Mid-ceremony switch when backend analysis returns `detected_language: 'it'`
- Zero behaviour change for English users

## Scope

New file: `vac-ceremony-i18n.js` — i18n string table (en + it) exposing `window.VACi18n`.  
Patched file: `vac-reauth-ceremony.js` — all user-facing strings replaced with `t()`/`tf()` calls.  
Patched file: `auth.html` — `vac-ceremony-i18n.js` loaded before `vac-reauth-ceremony.js`.  
Patched file: `vercel.json` — cache-control header for new JS file.

## Language-Switch State Diagram

```
                          ┌────────────────────────────┐
                          │          INITIAL            │
                          │  _activeLang = null         │
                          └────────────┬───────────────┘
                                       │
                            initLang() on IIFE init
                                       │
              ┌────────────────────────┴──────────────────────────┐
              │  navigator.language.startsWith('it')              │
              │                                                    │
              ▼ YES                                               ▼ NO
       ┌──────────────┐                                   ┌──────────────┐
       │  lang = 'it' │                                   │  lang = 'en' │
       └──────┬───────┘                                   └──────┬───────┘
              │                                                   │
              │ All t() calls → Italian                          │ All t() calls → English
              │                                                   │
              │ ← after authResult = await resp.json()  ────────►│
              │   if (authResult.detected_language === 'it')      │
              │   switchLang('it')                                │
              │                                                   │
              ▼                                                   ▼
       ┌──────────────┐                               ┌────────────────┐
       │  lang = 'it' │                               │ lang = 'en' OR │
       │  (no change) │                               │ switchLang('it')│
       └──────────────┘                               └────────────────┘
                                                          │
                                         switchLang only fires if detected ≠ current
                                         Subsequent retry/error prompts use new lang
```

**Key constraint**: English-browser users who get `detected_language=en` see no change (lang stays 'en'). English-browser users who speak Italian and get `detected_language=it` switch for all subsequent prompts (retry flow, error messages).

---

## String Inventory

Format: `key | en | it | notes`

### AV Check Labels (pre-flight)

| Key | English | Italian | Notes |
|-----|---------|---------|-------|
| `av_light` | `Light` | `Luce` | Initial AV status label |
| `av_mic` | `Mic` | `Mic` | Same in Italian |
| `av_hand` | `Hand` | `Mano` | |
| `av_light_dark` | `Light: too dark` | `Luce: troppo scura` | |
| `av_light_dim` | `Light: dim` | `Luce: scarsa` | |
| `av_light_bright` | `Light: too bright` | `Luce: troppo intensa` | |
| `av_light_good` | `Light: good` | `Luce: buona` | |
| `av_mic_working` | `Mic: working` | `Mic: funzionante` | |
| `av_hand_cheek` | `Hand: beside your cheek` | `Mano: vicino alla guancia` | |
| `av_hand_back` | `Hand: move back` | `Mano: allontana` | |
| `av_hand_closer` | `Hand: move closer` | `Mano: avvicina` | |
| `av_hand_ok` | `Hand ✓` | `Mano ✓` | |
| `av_hand_spread` | `Hand: spread fingers` | `Mano: allarga le dita` | |
| `av_hold_steady` | `Hold steady…` | `Tieni fermo…` | Appears as status + sub |

### AV Hand Hints (below video)

| Key | English | Italian | Notes |
|-----|---------|---------|-------|
| `av_hint_cheek` | `✋ Move your hand beside your cheek` | `✋ Porta la mano vicino alla guancia` | |
| `av_hint_back` | `Move your hand back — keep the whole hand in view` | `Allontana la mano — tieni tutta la mano in campo` | |
| `av_hint_closer` | `Move your hand closer — fill the oval with your hand` | `Avvicina la mano — riempi l'ovale con la mano` | |
| `av_hint_spread` | `Spread your fingers — make sure all are clearly visible` | `Allarga le dita — assicurati che siano tutte visibili` | |
| `av_hint_show` | `Hold your hand beside your cheek — we'll show it tracked` | `Tieni la mano vicino alla guancia — vedrai il tracciamento` | |

### Setup Guide Steps (updateAVReady)

| Key | English | Italian | Notes |
|-----|---------|---------|-------|
| `guide_step1` | fn(n) → `Step 1 of N — find good lighting...` | fn(n) → `Passo 1 di N — trova buona illuminazione...` | Template fn |
| `guide_step2` | fn(n) → `Step 2 of N — say a few words...` | fn(n) → `Passo 2 di N — di' qualche parola...` | Template fn |
| `guide_step3` | `Step 3 of 3 — hold your hand up...` | `Passo 3 di 3 — alza la mano...` | |
| `guide_setup` | `Finishing setup, one moment...` | `Completamento configurazione, un momento...` | |
| `guide_ready` | `All set ✓  You're ready to verify` | `Pronto ✓  Puoi verificare` | |
| `btn_start_verify` | `Start verification` | `Inizia la verifica` | |
| `btn_checks_above` | `Complete the checks above` | `Completa i controlli qui sopra` | |

### Microphone Tips

| Key | English | Italian | Notes |
|-----|---------|---------|-------|
| `mic_detected` | `Microphone detected` | `Microfono rilevato` | |
| `mic_louder` | `Try speaking louder or clapping` | `Prova a parlare più forte o a battere le mani` | |
| `mic_speak_now` | `Speak now to test your microphone` | `Parla ora per testare il microfono` | |
| `mic_no_access` | `Could not access camera/mic. Check browser permissions.` | `Impossibile accedere a fotocamera/mic. Controlla i permessi del browser.` | |

### Canvas Overlay Guide (drawn by _drawFingerTargetGuide)

| Key | English | Italian | Notes |
|-----|---------|---------|-------|
| `canvas_fist` | `Make a fist beside your cheek` | `Fai un pugno vicino alla guancia` | N === 0 |
| `canvas_show5` | `Show 5 — spread your fingers WIDE, beside your cheek` | `Mostra 5 — allarga le dita AL MASSIMO, vicino alla guancia` | N === 5 |
| `canvas_show4` | `Show 4 — tuck your thumb in, beside your cheek` | `Mostra 4 — piega il pollice, vicino alla guancia` | N === 4 |
| `canvas_show_n` | fn(n) → `Hold N finger(s) beside your cheek` | fn(n) → `Tieni N dito/dita vicino alla guancia` | Template fn |
| `canvas_hand` | `Hold your hand beside your cheek` | `Tieni la mano vicino alla guancia` | N < 0 fallback |

### Coaching / Challenge Prompts

| Key | English | Italian | Notes |
|-----|---------|---------|-------|
| `say_phrase_title` | `Say the phrase` | `Di' la frase` | Phase title |
| `say_greeting_title` | `Say the greeting` | `Di' il saluto` | Phase title |
| `say_phrase_label` | `SAY THE PHRASE` | `DI' LA FRASE` | ARIA label text |
| `say_greeting_label` | `SAY THE GREETING` | `DI' IL SALUTO` | ARIA label text |
| `then_show_numbers` | `then show each number as you say it, one take` | `poi mostra ogni numero mentre lo dici, in un'unica ripresa` | Sub-label |
| `show_fingers_label` | `SHOW FINGERS` | `MOSTRA LE DITA` | ARIA label text |
| `show_next_gesture` | `Show next gesture from the phrase` | `Mostra il gesto successivo dalla frase` | |
| `almost_nearmiss` | `Almost — show your fingers and say it at the same time` | `Quasi — mostra le dita e dì il numero contemporaneamente` | coachHintMsg |
| `voice_only_hint` | fn(n) → `Now show your N finger(s) as you say "N"` | fn(n) → `Ora mostra N dito/dita mentre dici «N»` | Template fn |
| `gesture_only_hint` | fn(n) → `Say "N" out loud while you hold up your fingers` | fn(n) → `Di' «N» ad alta voce mentre tieni su le dita` | Template fn |
| `all_captured` | `All captured ✓` | `Tutto catturato ✓` | |
| `got_it` | `✓  Got it` | `✓  Ricevuto` | |
| `lower_hand_reshow` | fn(n) → `Lower your hand, then show N again` | fn(n) → `Abbassa la mano, poi mostra N di nuovo` | Template fn |
| `show_n_hold` | fn(n) → `Show N — hold steady` | fn(n) → `Mostra N — tieni fermo` | Template fn |
| `show_n_and_say` | fn(n) → `Show N AND say "N" — at the same time` | fn(n) → `Mostra N E di' «N» — allo stesso tempo` | Template fn |
| `show_n_finger_hold` | fn(n) → `Show N finger(s) — hold steady` | fn(n) → `Mostra N dito/dita — tieni fermo` | Template fn |
| `show_n_finger_and_say` | fn(n) → `Show N finger(s) AND say "N" — at the same time` | fn(n) → `Mostra N dito/dita E di' «N» — allo stesso tempo` | Template fn |
| `hand_near_cheek` | `✋ Hold your hand up beside your cheek` | `✋ Tieni la mano alzata vicino alla guancia` | |
| `hand_detected_hold` | `Hand detected — hold steady.` | `Mano rilevata — tieni fermo.` | |
| `hold_steady` | `hold steady` | `tieni fermo` | lowercase sub |
| `cant_hear` | `We can't hear you — a bit louder` | `Non ti sentiamo — un po' più forte` | |
| `together` | `together, in one go` | `insieme, in un'unica ripresa` | |

### Capture Timing / Countdown

| Key | English | Italian | Notes |
|-----|---------|---------|-------|
| `processing` | `Processing…` | `Elaborazione…` | Finger-phase in-progress |
| `get_ready` | `Get ready…` | `Preparati…` | Countdown display |
| `timer_recording` | `Recording` | `Registrazione` | Timer label during capture |
| `timer_recording_in` | `Recording in` | `Registrazione tra` | Timer label pre-countdown |
| `quick_reconfirm` | `Quick re-confirm` | `Riconferma rapida` | |

### Challenge Intro Screen

| Key | English | Italian | Notes |
|-----|---------|---------|-------|
| `btn_ready` | `I'm ready — start` | `Sono pronto — inizia` | Static button in CEREMONY_HTML |
| `intro_headline` | `First a greeting,\nthen your numbers.` | `Prima un saluto,\npoi i tuoi numeri.` | Newline → `<br>` |
| `btn_enable_camera` | `Enable Camera & Microphone` | `Abilita fotocamera e microfono` | |

### Processing Step Strings (runRealVerification)

| Key | English | Italian | Notes |
|-----|---------|---------|-------|
| `upload_recording` | `Uploading recording…` | `Caricamento registrazione…` | |
| `analysing_biometrics` | `Analysing biometrics…` | `Analisi dei dati biometrici…` | |
| `processing_results` | `Processing results…` | `Elaborazione risultati…` | |
| `progress_uploading` | `Uploading recording...` | `Caricamento registrazione...` | Progress bar step |
| `progress_face` | `Face liveness check...` | `Controllo liveness volto...` | |
| `progress_deepfake` | `Deepfake analysis...` | `Analisi deepfake...` | |
| `progress_voice` | `Voice transcription...` | `Trascrizione voce...` | |
| `progress_lip` | `Lip sync correlation...` | `Correlazione labiale...` | |
| `progress_finger` | `Finger gesture analysis...` | `Analisi gesti delle dita...` | |
| `progress_score` | `Computing trust score...` | `Calcolo punteggio di fiducia...` | |
| `connection_retry` | fn(n,t) → `Connection dropped — retrying upload (N/total)…` | fn(n,t) → `Connessione interrotta — nuovo tentativo (N/totale)…` | Template fn |

### Static DOM Elements (patched by _applyI18nToDOM after renderDOM)

| Key | English | Italian | Element selector |
|-----|---------|---------|-----------------|
| `look_at_camera` | `Look at the camera the whole time` | `Guarda sempre la fotocamera` | `.camera-challenge-sub` |
| `hand_zone_label` | `HAND ZONE` | `ZONA MANO` | `.hand-zone-label` |
| `how_it_works_text` | (static long copy) | (not patched — kept English) | `#combinedCaptureText` |

---

## Module API: window.VACi18n

```js
window.VACi18n = {
  initLang()       // reads navigator.language, sets _activeLang
  switchLang(lang) // sets _activeLang to 'it' or 'en'
  t(key)           // returns string for _activeLang; falls back to 'en'
  tf(key)          // returns template function for _activeLang
  lang()           // returns current _activeLang
}
```

Adapter in `vac-reauth-ceremony.js` (top of IIFE):
```js
var _i18n = window.VACi18n || null;
function t(k){ return _i18n ? _i18n.t(k) : k; }
function tf(k){ return _i18n ? _i18n.tf(k) : function(){ return k; }; }
if (_i18n) _i18n.initLang();
```

Language switch point (in `runRealVerification`, after `authResult = await resp.json()`):
```js
if (_i18n && authResult && authResult.detected_language) {
    _i18n.switchLang(authResult.detected_language);
}
```

---

## Patch Locations in vac-reauth-ceremony.js

| Function | ~Line | Change |
|----------|-------|--------|
| IIFE top | 10 | Add `_i18n`, `t()`, `tf()`, `initLang()` |
| `startAVChecks()` | 532 | 3 label strings → `t()` |
| `runAVFrame()` | 655 | 4 light strings → `t()` |
| `runAVFrame()` | 633 | 1 mic string → `t()` |
| `runAVFrame()` | 710 | 5 hand status + 6 hint strings → `t()` |
| `_drawFingerTargetGuide()` | 874 | 5 canvas strings → `t()`/`tf()` |
| `CaptureFeedback.updatePhasePrompt()` | 987 | 7 label strings → `t()` |
| `CaptureFeedback.coachHintMsg()` | 1055 | 3 coaching strings → `t()`/`tf()` |
| `CaptureFeedback.renderGuided()` | 1128 | 12 prompt strings → `t()`/`tf()` |
| `CaptureFeedback.renderFingerPhase()` | 1204 | 3 strings → `t()`/`tf()` |
| `CaptureFeedback.checkHandFraming()` | 1249 | 3 strings → `t()` |
| `updateMicTips()` | 1294 | 2 strings → `t()` |
| `updateAVReady()` | 1335 | 7 strings → `t()`/`tf()` |
| `retryAVSetup()` | 1400 | 2 strings → `t()` |
| `showChallengeIntro()` | (late) | Patch static btn + headline for i18n |
| `startCountdown()` | 1702 | 2 strings → `t()` |
| `beginRecording()` | 1736 | 1 string → `t()` |
| `beginRecording()` | 1881 | 2 quick-reconfirm strings → `t()` |
| `runRealVerification()` | 3865 | 3 + 7 processing strings → `t()` |
| `runRealVerification()` | 3958 | 1 retry string → `tf()` |
| `runRealVerification()` | 4001 | **Language switch point** |
| `renderDOM()` / `run()` | 5363 | Call `_applyI18nToDOM()` after mount |
| module bottom | 5500+ | Define `_applyI18nToDOM()` |
