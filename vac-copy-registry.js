// vac-copy-registry.js — F-792 state-keyed copy registry for VAC ceremony flows.
// Single source of truth for all user-facing instruction/coaching/status strings in the
// quick, full, and nameless ceremony tiers. Tier-agnostic strings live under _common.
//
// Structure: COPY[tier][step][key]  →  string | fn(params)
// Tiers:  quick (fast/still-capture)  full (named greeting)  nameless (skipGreeting)  _common (all)
// Steps:  preflight | capture | denied | results | escalation | status | error
//
// resolve(tier, step, key, params) — returns the string for the given tier/step/key, with
// optional {{param}} substitution. Falls back to _common if the tier-specific key is missing.
// Missing keys: LOUD error in dev mode (localhost / qa=1). Never silent fallback.
//
// Exposed as window.VACCopy = { COPY, resolve }.
// Load BEFORE vac-reauth-ceremony.js.
(function () {
'use strict';

var COPY = {

  // ── Strings shared across all tiers ─────────────────────────────────────────
  _common: {
    preflight: {
      camera_active:          'CAMERA ACTIVE',
      awaiting_camera:        'AWAITING CAMERA',
      requesting_access:      'Requesting access…',
      loading_challenge:      'Loading challenge…',
      challenge_load_error:   'Could not load challenge — check your connection and try again.',
      complete_checks:        'Complete the checks above',
      retry_camera:           'Retry Camera Access',
      start_verification:     'Start verification',
      enable_camera:          'Enable Camera & Microphone',
      refresh_av:             'Refresh camera & mic',
      checking_camera:        'Checking your camera…',
      all_set:                'All set ✓  You’re ready to verify',
      speak_to_test_mic:      'Speak now to test your microphone',
      mic_detected:           'Microphone detected',
      mic_not_picking_up:     'Mic not picking up audio?',
      try_clapping:           'Try speaking louder or clapping',
      camera_error:           'Could not access camera/mic. Check browser permissions.',
      privacy_statement:      'We store a text description of your appearance — no photos or video are retained. Recording is analysed in real-time and discarded.',
      face_oval_label:        'Position face in oval',
      step_eyebrow:           'Step 2 of 4',
      header_title:           'Camera & Mic',
    },
    capture: {
      processing:             'Processing…',
      get_ready:              'Get ready…',
      get_ready_title:        'Get ready',
      recording_label:        'Recording',
      recording_in:           'Recording in',
      say_phrase_title:       'Say the phrase',
      all_captured:           'All captured ✓',
      got_it_beat:            '✓  Got it',
      loading_challenge_text: 'Loading challenge…',
      look_at_camera:         'Look at the camera the whole time',
      start_over:             'Start over',
      step3_eyebrow:          'Step 3 of 4',
      step3_title:            'Complete the Challenge',
      how_it_works:           'How it works',
      before_start:           'Before we start',
      ready_start_btn:        'I’m ready — start',
      you_ll_say:             'You’ll say',
      show_say_each:          'then show each AND say it — at the same time',
      no_need_memorise:       'No need to memorise — we’ll guide you through each one.',
      challenge_sub:          'then show each number as you say it, one take',
      enable_camera_btn:      'Enable Camera & Microphone',
      voice_only_fallback:    'Cannot show fingers? Voice-only mode',
      switch_to_finger:       'Switch back to finger mode',
      step4_eyebrow:          'Step 4 of 4',
      verify_step_title:      'Verifying You’re Human',
      verifying_subtitle:     'Sending biometric data to verification engines…',
      uploading:              'Uploading recording…',
      uploading_initial:      'Video + Audio → Gemini + Deepgram',
      reauth_verify_title:    "Confirming it’s still you",
      // Coaching strings — used in CaptureFeedback and live detection loop
      say_phrase_label:       ‘SAY THE PHRASE’,
      coach_nearmiss:         ‘Almost — show your fingers and say it at the same time’,
      coach_voiceonly:        function(p) { var n = p.digit; return ‘Now show your ‘ + n + ‘ finger’ + (n === 1 ? ‘’ : ‘s’) + ‘ as you say “’ + n + ‘”’; },
      coach_gestureonly:      function(p) { return ‘Say “’ + p.digit + ‘” out loud while you hold up your fingers’; },
      coach_lower_rearm:      ‘Lower your hand, then show {{digit}} again’,
      hold_hand:              ‘✋ Hold your hand up beside your cheek’,
      hand_detected:          ‘Hand detected — hold steady.’,
      coach_show_and_say:     ‘Show {{digit}} AND say “{{digit}}” — at the same time’,
      voice_help_louder:      ‘We can’t hear you — a bit louder’,
      coach_rest_sub:         ‘together, in one go’,
      hold_steady_sub:        ‘hold steady’,
      gesture_progress:       function(p) { return ‘Hold steady ‘ + p.pct + ‘%  (‘ + p.step + ‘/’ + p.total + ‘)’; },
      live_got_it_beat:       ‘Got it ✓’,
      live_all_gestures:      ‘All gestures captured ✓’,
    },
    denied: {
      why_it_failed:          'Why it failed',
      try_this:               'Try this',
      retry_btn:              'Retry Verification',
      continue_anyway:        'Continue Anyway',
      generic_reason:         'Verification did not reach the required trust threshold.',
      generic_tip:            'Ensure good lighting, speak clearly, and look directly at the camera.',
      service_unavailable:    'Some verification services are temporarily unavailable. Your voice and location were verified successfully.',
      // FAIL_REASONS entries — reasons are shared; tips are tier-overridden below
      face_liveness_reason:         'Face not detected or liveness check failed.',
      face_liveness_tip:            'Make sure your face is clearly visible, well-lit, and centered in the oval. Remove sunglasses or hats.',
      deepfake_detection_reason:    'Deepfake indicators detected in the video.',
      deepfake_detection_tip:       'Use your device camera directly — screen sharing, virtual cameras, or recorded playback will be rejected.',
      voiceprint_reason:            'Voice not captured clearly enough for analysis.',
      voiceprint_tip:               'Speak the challenge phrase clearly and at normal volume. Reduce background noise if possible.',
      lip_sync_reason:              'Lip movements did not match the spoken audio.',
      lip_sync_tip:                 'Look directly at the camera while speaking. Make sure your mouth is visible and well-lit.',
      challenge_response_reason:    'Spoken words did not match the challenge phrase.',
      // challenge_response_tip is tier-overridden — see quick/full/nameless below
      duress_reason:                'Duress check — monitoring for signs of coercion.',
      duress_tip:                   'This runs silently. If you are safe, this will always pass.',
      finger_gesture_reason:        'Hand gesture did not match the expected digit — shown pose not confirmed by server analysis.',
      // finger_gesture_tip is tier-overridden below; gesture is advisory on-device, validated server-side
      geolocation_reason:           'Location could not be determined.',
      geolocation_tip:              'Allow location access when prompted by your browser.',
    },
    results: {
      modalities_label:       'Verification Modalities',
      checking_label:         'Checking…',
      under_the_hood:         'Under the Hood',
      engines_label:          'Gemini + Deepgram',
      loading_engine_data:    'Loading engine data…',
    },
    escalation: {
      vouch_pending_heading:  'Waiting for vouch',
      vouch_requesting_heading: 'One more step',
      vouch_pending_badge:    'VOUCH PENDING',
      vouch_pending_note:     "We’ll notify you when it’s confirmed",
      vouch_who_label:        'Who can vouch for you?',
      vouch_name_label:       'Their name',
      vouch_email_label:      'Their email',
      vouch_message_label:    'Personal message (optional)',
      vouch_submit:           'Send vouch request',
    },
    status: {
      uploading_recording:    'Uploading recording…',
      analysing_biometrics:   'Analysing biometrics…',
      processing_results:     'Processing results…',
      just_a_moment:          'Just a moment…',
      service_error_detail:   "A couple of checks couldn’t run just now — that’s on our side, not yours. Retrying automatically.",
    },
    error: {
      challenge_load_prompt:  "Couldn’t load your challenge. Tap “Enable Camera & Microphone” to try again.",
      connection_error:       'Connection error — please try again',
      retry_btn:              'Retry',
      verification_unavailable: 'Verification unavailable',
      camera_required:        'Camera access required',
    },
  },

  // ── Full ceremony tier (named greeting + digits) ─────────────────────────────
  full: {
    preflight: {
      header_sub:                        'Let’s check your camera, mic & light — hold your hand up beside your cheek.\nNext step: you’ll say a greeting and show a few numbers.',
      // Policy-drops-voice variant (full re-auth where voice modality is absent from policy)
      header_sub_policy_no_voice:        'Show the number beside your cheek and say it out loud. Wait for the ✓.',
      combined_capture_text:             'Say the greeting, then show each number as you say it. Wait for the ✓. One continuous take, 6 signals verified by AI.',
      combined_capture_text_policy_no_voice: 'Show the number beside your cheek — a quick face + number check. You verified moments ago, so no greeting is needed.',
      hand_zone_label:                   '✋ Hold hand beside your cheek',
      biometric_heading:                 'Biometric verification',
      biometric_desc:                    'You’ll speak a challenge phrase on camera while showing finger gestures. This creates your biometric identity — face, voice, lip sync, and gesture verified by AI.',
      biometric_start_btn:               'Start verification',
    },
    capture: {
      phase_prompt_title:          'Say the greeting',
      phase_prompt_finger_label:   'SAY THE GREETING',
      greeting_confirmed:          'Greeting heard',
      challenge_intro_headline:    'First a greeting,\nthen your numbers.',
      step2_title_with_voice:      'Show your fingers and say the number',
      step2_title_no_voice:        'Show your fingers',
      // Live detection loop coaching — digit co-occurrence (curly quotes match ceremony “/”)
      voice_help_say_digit:        function(p) { return 'We can’t hear you — say “' + p.digit + '”, or tap below'; },
      coach_keep_showing:          function(p) { return 'Keep showing ' + p.digit + ' — say “' + p.digit + '”'; },
      live_show_and_say:           function(p) { var d = p.digit; return 'Show ' + d + ' finger' + (d === 1 ? '' : 's') + ' AND say “' + d + '” — at the same time'; },
    },
    denied: {
      challenge_response_tip:  'Read the challenge phrase exactly as shown — include the greeting and all digits.',
      finger_gesture_tip:      'Show each digit with your fingers near your face. Change your hand clearly between each number — hold, change, hold. Keep fingers spread.',
    },
    results: {
      human_verified:          'Human verified ✓',
      verification_incomplete: 'Verification incomplete',
    },
  },

  // ── Nameless tier (skipGreeting — digits only, no name or greeting) ──────────
  nameless: {
    preflight: {
      header_sub:           'Say your numbers, showing each on your fingers beside your cheek. Wait for the ✓.',
      combined_capture_text:'Say your numbers out loud, then show each on your fingers beside your cheek as you say it — one take. No name or greeting needed; you verified moments ago.',
    },
    capture: {
      phase_prompt_title:         'Say the numbers',
      phase_prompt_finger_label:  'SAY THE NUMBERS',
      greeting_confirmed:         'Numbers heard',
      challenge_intro_headline:   'Just your numbers.',
      step2_title:                'Quick re-confirm',
    },
    denied: {
      // No greeting reference — the user speaks digits only
      challenge_response_tip:  'Say each number clearly out loud — no greeting needed, just the digits as shown on screen.',
      finger_gesture_tip:      'Show each digit with your fingers near your face. Change your hand clearly between each number — hold, change, hold. Keep fingers spread.',
    },
  },

  // ── Quick/fast tier (still-capture, one digit, face embedding) ───────────────
  quick: {
    preflight: {
      header_sub_no_voice:    ‘Hold still for a quick face check — one photo confirms it’s you.’,
      header_sub_with_voice:  ‘Quick camera & mic check — next, you’ll show a number beside your cheek and say it out loud.’,
      // Still-capture post-camera copy (used in run() overrides)
      header_sub_still:       ‘Quick re-verify — show the number beside your cheek and say it out loud. Wait for the ✓.’,
      combined_capture_text_still: ‘Quick re-verify — show the number beside your cheek and say it out loud. A quick face + number check (shown and spoken together); you verified moments ago, so no greeting is needed.’,
    },
    capture: {
      step2_title_with_voice:  ‘Show your fingers and say the number’,
      step2_title_no_voice:    ‘Show your fingers’,
      show_hold_steady:        ‘Show {{digit}} — hold steady’,
      show_fingers_hold:       ‘Show {{digit}} finger(s) — hold steady’,
    },
    denied: {
      // Quick tier: user shows one digit on fingers; no full spoken phrase
      challenge_response_tip:  ‘Show the digit clearly on your fingers beside your face and say it out loud at the same time.’,
      // Gesture is advisory on-device; server validates the pose against the recorded digit
      finger_gesture_tip:      ‘Hold your hand clearly in view beside your cheek with fingers spread wide. Keep it visible and steady — the gesture is verified in the recording.’,
      face_mismatch_heading:   ‘Identity not confirmed’,
      face_mismatch_body:      ‘Face did not match your stored biometric. Full verification provides a stronger identity check.’,
      // Item 1 — renderQuickReauthVerdict deny-reason map corrective actions
      deny_heading:                      ‘Not confirmed’,
      deny_default_msg:                  ‘The quick check did not confirm your identity.’,
      deny_act_face_mismatch:            ‘Move closer, get even lighting, and face the camera straight on.’,
      deny_act_embedding_required:       ‘We couldn’t read a clear face — move closer / better light and try again.’,
      deny_act_no_embedding:             ‘Full verification is required to enroll your face.’,
      deny_act_no_face_reference:        ‘No face on file — full verification required.’,
      deny_act_corrupt_face_reference:   ‘Stored face template is unreadable — full verification required.’,
      deny_act_finger_mismatch:          function(p) { return ‘Show exactly ‘ + p.digit + ‘ finger’ + (p.digit === 1 ? ‘’ : ‘s’) + ‘ to the camera.’; },
      deny_act_finger_mismatch_no_digit: ‘Show the requested number of fingers.’,
      deny_act_spoken_digit_mismatch:    function(p) { return ‘Say “’ + p.digit + ‘” clearly as you show it.’; },
      deny_act_spoken_digit_mismatch_no_digit: ‘Say the number clearly as you show it.’,
      deny_act_not_cooccurring:          ‘Show the number AND say it at the same time.’,
      deny_act_liveness_failed:          ‘Hold still in good, even light and look straight at the camera.’,
      deny_act_liveness_unavailable:     ‘The liveness provider is temporarily unavailable — this is not a problem with your face. Use full verification, or try again shortly.’,
    },
    escalation: {
      upgrade_btn:  ‘Continue with full verification’,
      step_up_info: ‘Security step-up — this is protection working. Full verification confirms your identity with a stronger biometric check.’,
    },
    results: {
      verify_subtitle_pass:  ‘Quick re-auth complete — here is what the backend checked.’,
      verify_subtitle_fail:  ‘Quick re-auth was not confirmed — here is what the backend checked.’,
      face_match_name:       ‘Face match’,
      finger_row_name:       ‘Number on fingers’,
      liveness_row_name:     ‘Passive liveness’,
    },
  },

};

// ── resolve(tier, step, key, params) ────────────────────────────────────────────
// Returns the string for tier→step→key, falling back to _common→step→key.
// params: optional object for {{key}} substitution.
// Missing key: loud error in dev; returns a visible sentinel string.
function resolve(tier, step, key, params) {
  var entry;
  if (tier && tier !== '_common') {
    entry = COPY[tier] && COPY[tier][step] && COPY[tier][step][key];
  }
  if (entry === undefined) {
    entry = COPY._common && COPY._common[step] && COPY._common[step][key];
  }
  if (entry === undefined) {
    var _dev = false;
    try {
      _dev = (typeof location !== 'undefined') &&
             (location.hostname === 'localhost' ||
              location.hostname.indexOf('.local') !== -1 ||
              location.search.indexOf('qa=1') !== -1);
    } catch(_) {}
    var _k = tier + '.' + step + '.' + key;
    if (_dev) console.error('[VACCopy] MISSING KEY: ' + _k);
    return '[VACCopy:MISSING:' + _k + ']';
  }
  if (typeof entry === 'function') return entry(params || {});
  if (params) {
    return String(entry).replace(/\{\{(\w+)\}\}/g, function(_, k) {
      return (params[k] != null) ? String(params[k]) : '';
    });
  }
  return String(entry);
}

window.VACCopy = { COPY: COPY, resolve: resolve };

}());
