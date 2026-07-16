/* vac-ceremony-i18n.js — F-823: Ceremony internationalisation (en + it)
 * Load BEFORE vac-reauth-ceremony.js. Exposes window.VACi18n.
 */
(function () {
    'use strict';

    var _activeLang = 'en';

    // Template-function helpers used for keys whose values are functions.
    // Calling t('key') on a fn-valued key returns the function itself.
    // Use tf('key') to always get a callable.

    // String tables: simple strings as strings, dynamic strings as functions.
    var STRINGS = {
        en: {
            // AV check labels
            av_light:          'Light',
            av_mic:            'Mic',
            av_hand:           'Hand',
            av_light_dark:     'Light: too dark',
            av_light_dim:      'Light: dim',
            av_light_bright:   'Light: too bright',
            av_light_good:     'Light: good',
            av_mic_working:    'Mic: working',
            av_hand_cheek:     'Hand: beside your cheek',
            av_hand_back:      'Hand: move back',
            av_hand_closer:    'Hand: move closer',
            av_hand_ok:        'Hand ✓',
            av_hand_spread:    'Hand: spread fingers',
            av_hold_steady:    'Hold steady…',
            // AV hand hints
            av_hint_cheek:     '✋ Move your hand beside your cheek',
            av_hint_back:      'Move your hand back — keep the whole hand in view',
            av_hint_closer:    'Move your hand closer — fill the oval with your hand',
            av_hint_spread:    'Spread your fingers — make sure all are clearly visible',
            av_hint_show:      'Hold your hand beside your cheek — we\'ll show it tracked',
            // Setup guide
            guide_step1:       function (n) { return 'Step 1 of ' + n + ' — find good lighting...'; },
            guide_step2:       function (n) { return 'Step 2 of ' + n + ' — say a few words...'; },
            guide_step3:       'Step 3 of 3 — hold your hand up...',
            guide_setup:       'Finishing setup, one moment...',
            guide_ready:       'All set ✓  You\'re ready to verify',
            btn_start_verify:  'Start verification',
            btn_checks_above:  'Complete the checks above',
            // Mic tips
            mic_detected:      'Microphone detected',
            mic_louder:        'Try speaking louder or clapping',
            mic_speak_now:     'Speak now to test your microphone',
            mic_no_access:     'Could not access camera/mic. Check browser permissions.',
            // Canvas overlay
            canvas_fist:       'Make a fist beside your cheek',
            canvas_show5:      'Show 5 — spread your fingers WIDE, beside your cheek',
            canvas_show4:      'Show 4 — tuck your thumb in, beside your cheek',
            canvas_show_n:     function (n) { return 'Hold ' + n + ' finger' + (n === 1 ? '' : 's') + ' beside your cheek'; },
            canvas_hand:       'Hold your hand beside your cheek',
            // Phase titles / labels
            say_phrase_title:      'Say the phrase',
            say_greeting_title:    'Say the greeting',
            say_phrase_label:      'SAY THE PHRASE',
            say_greeting_label:    'SAY THE GREETING',
            then_show_numbers:     'then show each number as you say it, one take',
            show_fingers_label:    'SHOW FINGERS',
            show_next_gesture:     'Show next gesture from the phrase',
            // Coaching hints
            almost_nearmiss:       'Almost — show your fingers and say it at the same time',
            voice_only_hint:       function (n) { return 'Now show your ' + n + ' finger' + (n === 1 ? '' : 's') + ' as you say “' + n + '”'; },
            gesture_only_hint:     function (n) { return 'Say “' + n + '” out loud while you hold up your fingers'; },
            all_captured:          'All captured ✓',
            got_it:                '✓  Got it',
            lower_hand_reshow:     function (n) { return 'Lower your hand, then show ' + n + ' again'; },
            show_n_hold:           function (n) { return 'Show ' + n + ' — hold steady'; },
            show_n_and_say:        function (n) { return 'Show ' + n + ' AND say “' + n + '” — at the same time'; },
            show_n_finger_hold:    function (n) { return 'Show ' + n + ' finger' + (n === 1 ? '' : 's') + ' — hold steady'; },
            show_n_finger_and_say: function (n) { return 'Show ' + n + ' finger' + (n === 1 ? '' : 's') + ' AND say “' + n + '” — at the same time'; },
            hand_near_cheek:       '✋ Hold your hand up beside your cheek',
            hand_detected_hold:    'Hand detected — hold steady.',
            hold_steady:           'hold steady',
            cant_hear:             'We can\'t hear you — a bit louder',
            together:              'together, in one go',
            // Timing / countdown
            processing:            'Processing…',
            get_ready:             'Get ready…',
            timer_recording:       'Recording',
            timer_recording_in:    'Recording in',
            quick_reconfirm:       'Quick re-confirm',
            // Challenge intro
            btn_ready:             'I\'m ready — start',
            intro_headline:        'First a greeting,\nthen your numbers.',
            btn_enable_camera:     'Enable Camera & Microphone',
            // Processing / analysis
            upload_recording:      'Uploading recording…',
            analysing_biometrics:  'Analysing biometrics…',
            processing_results:    'Processing results…',
            progress_uploading:    'Uploading recording...',
            progress_face:         'Face liveness check...',
            progress_deepfake:     'Deepfake analysis...',
            progress_voice:        'Voice transcription...',
            progress_lip:          'Lip sync correlation...',
            progress_finger:       'Finger gesture analysis...',
            progress_score:        'Computing trust score...',
            connection_retry:      function (n, total) { return 'Connection dropped — retrying upload (' + n + '/' + total + ')…'; },
            // Static DOM elements
            look_at_camera:        'Look at the camera the whole time',
            hand_zone_label:       'HAND ZONE'
        },

        it: {
            // AV check labels
            av_light:          'Luce',
            av_mic:            'Mic',
            av_hand:           'Mano',
            av_light_dark:     'Luce: troppo scura',
            av_light_dim:      'Luce: scarsa',
            av_light_bright:   'Luce: troppo intensa',
            av_light_good:     'Luce: buona',
            av_mic_working:    'Mic: funzionante',
            av_hand_cheek:     'Mano: vicino alla guancia',
            av_hand_back:      'Mano: allontana',
            av_hand_closer:    'Mano: avvicina',
            av_hand_ok:        'Mano ✓',
            av_hand_spread:    'Mano: allarga le dita',
            av_hold_steady:    'Tieni fermo…',
            // AV hand hints
            av_hint_cheek:     '✋ Porta la mano vicino alla guancia',
            av_hint_back:      'Allontana la mano — tieni tutta la mano in campo',
            av_hint_closer:    'Avvicina la mano — riempi l\'ovale con la mano',
            av_hint_spread:    'Allarga le dita — assicurati che siano tutte visibili',
            av_hint_show:      'Tieni la mano vicino alla guancia — vedrai il tracciamento',
            // Setup guide
            guide_step1:       function (n) { return 'Passo 1 di ' + n + ' — trova buona illuminazione...'; },
            guide_step2:       function (n) { return 'Passo 2 di ' + n + ' — di\' qualche parola...'; },
            guide_step3:       'Passo 3 di 3 — alza la mano...',
            guide_setup:       'Completamento configurazione, un momento...',
            guide_ready:       'Pronto ✓  Puoi verificare',
            btn_start_verify:  'Inizia la verifica',
            btn_checks_above:  'Completa i controlli qui sopra',
            // Mic tips
            mic_detected:      'Microfono rilevato',
            mic_louder:        'Prova a parlare più forte o a battere le mani',
            mic_speak_now:     'Parla ora per testare il microfono',
            mic_no_access:     'Impossibile accedere a fotocamera/mic. Controlla i permessi del browser.',
            // Canvas overlay
            canvas_fist:       'Fai un pugno vicino alla guancia',
            canvas_show5:      'Mostra 5 — allarga le dita AL MASSIMO, vicino alla guancia',
            canvas_show4:      'Mostra 4 — piega il pollice, vicino alla guancia',
            canvas_show_n:     function (n) { return 'Tieni ' + n + ' dito' + (n === 1 ? '' : ' dita') + ' vicino alla guancia'; },
            canvas_hand:       'Tieni la mano vicino alla guancia',
            // Phase titles / labels
            say_phrase_title:      'Di’ la frase',
            say_greeting_title:    'Di’ il saluto',
            say_phrase_label:      'DI’ LA FRASE',
            say_greeting_label:    'DI’ IL SALUTO',
            then_show_numbers:     'poi mostra ogni numero mentre lo dici, in un\'unica ripresa',
            show_fingers_label:    'MOSTRA LE DITA',
            show_next_gesture:     'Mostra il gesto successivo dalla frase',
            // Coaching hints
            almost_nearmiss:       'Quasi — mostra le dita e di’ il numero contemporaneamente',
            voice_only_hint:       function (n) { return 'Ora mostra ' + n + ' dito' + (n === 1 ? '' : ' dita') + ' mentre dici «' + n + '»'; },
            gesture_only_hint:     function (n) { return 'Di’ «' + n + '» ad alta voce mentre tieni su le dita'; },
            all_captured:          'Tutto catturato ✓',
            got_it:                '✓  Ricevuto',
            lower_hand_reshow:     function (n) { return 'Abbassa la mano, poi mostra ' + n + ' di nuovo'; },
            show_n_hold:           function (n) { return 'Mostra ' + n + ' — tieni fermo'; },
            show_n_and_say:        function (n) { return 'Mostra ' + n + ' E di’ «' + n + '» — allo stesso tempo'; },
            show_n_finger_hold:    function (n) { return 'Mostra ' + n + ' dito' + (n === 1 ? '' : ' dita') + ' — tieni fermo'; },
            show_n_finger_and_say: function (n) { return 'Mostra ' + n + ' dito' + (n === 1 ? '' : ' dita') + ' E di’ «' + n + '» — allo stesso tempo'; },
            hand_near_cheek:       '✋ Tieni la mano alzata vicino alla guancia',
            hand_detected_hold:    'Mano rilevata — tieni fermo.',
            hold_steady:           'tieni fermo',
            cant_hear:             'Non ti sentiamo — un po’ più forte',
            together:              'insieme, in un\'unica ripresa',
            // Timing / countdown
            processing:            'Elaborazione…',
            get_ready:             'Preparati…',
            timer_recording:       'Registrazione',
            timer_recording_in:    'Registrazione tra',
            quick_reconfirm:       'Riconferma rapida',
            // Challenge intro
            btn_ready:             'Sono pronto — inizia',
            intro_headline:        'Prima un saluto,\npoi i tuoi numeri.',
            btn_enable_camera:     'Abilita fotocamera e microfono',
            // Processing / analysis
            upload_recording:      'Caricamento registrazione…',
            analysing_biometrics:  'Analisi dei dati biometrici…',
            processing_results:    'Elaborazione risultati…',
            progress_uploading:    'Caricamento registrazione...',
            progress_face:         'Controllo liveness volto...',
            progress_deepfake:     'Analisi deepfake...',
            progress_voice:        'Trascrizione voce...',
            progress_lip:          'Correlazione labiale...',
            progress_finger:       'Analisi gesti delle dita...',
            progress_score:        'Calcolo punteggio di fiducia...',
            connection_retry:      function (n, total) { return 'Connessione interrotta — nuovo tentativo (' + n + '/' + total + ')…'; },
            // Static DOM elements
            look_at_camera:        'Guarda sempre la fotocamera',
            hand_zone_label:       'ZONA MANO'
        }
    };

    function _resolve(lang, key) {
        var table = STRINGS[lang] || STRINGS['en'];
        return (table && (key in table)) ? table[key] : (STRINGS['en'][key] !== undefined ? STRINGS['en'][key] : key);
    }

    window.VACi18n = {
        initLang: function () {
            var nav = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : '';
            _activeLang = nav.toLowerCase().indexOf('it') === 0 ? 'it' : 'en';
        },
        switchLang: function (lang) {
            if (lang && typeof lang === 'string' && STRINGS[lang]) {
                _activeLang = lang;
            }
        },
        lang: function () {
            return _activeLang;
        },
        t: function (key) {
            return _resolve(_activeLang, key);
        },
        tf: function (key) {
            var val = _resolve(_activeLang, key);
            if (typeof val === 'function') { return val; }
            return function () { return val; };
        }
    };
}());
