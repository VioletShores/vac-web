/*
 * VAC ceremony pacing tuning (S207). Loaded BEFORE vac-reauth-ceremony.js.
 *
 * These are the tunable pacing values for the mic test and the say-the-number step. Edit a value
 * here to tune it without touching the ceremony code. vac-reauth-ceremony.js CLAMPS every value
 * to a safe range (see _vacTune there), so a value outside it is pulled back in, and a missing or
 * non-numeric value falls back to the built-in default. The voice-band and modulation checks that
 * keep background noise out are deliberately NOT tunable here.
 *
 * Defaults are conservative and UNCALIBRATED (24 Nov 2026): to be calibrated against Rob's 13:08
 * ceremony debug events (mic_qualify_pending / mic_pass_on_voiced_run / speech_window_open /
 * speech_cooccur_expired) before release.
 */
window.VAC_CEREMONY_TUNING = {
  micVoicedMs: 1000,        // mic test: voiced time needed, ms          (clamped 600-2000)
  micRmsFloor: 0.035,       // mic test: near-field RMS floor            (clamped 0.031-0.055)
  micAmbientMult: 2.0,      // mic test: x the room's seeded ambient RMS (clamped 1.5-4.0; gate capped at 0.055)
  digitOnsetGraceMs: 300,   // digit: onset this early before the window still counts (clamped 0-500)
  cantHearMinShowMs: 1500,  // digit: "We can't hear you" minimum display time       (clamped 500-4000)
  digitRetryCueMs: 2000     // digit: "Didn't catch that, say N again" display time  (clamped 800-4000)
};
