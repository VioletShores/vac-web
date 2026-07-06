# F-637 Fast-Reauth Co-Occurrence Fix

**Branch**: `task-f637-fast-reauth-cooccur`  
**Date**: 2026-07-06  
**File**: `vac-reauth-ceremony.js`  

## Root Cause

In `beginStillCapture` (fast/still path), the gesture poll falls back to gesture-only advance when `_voiceGate = null`:

```js
} else {
    _captureNow = (_stable >= _STABLE_NEEDED);   // gesture-only — WRONG when _captureVoice = true
}
```

This fires after ~480ms of stable finger count (4 × 120ms ticks) regardless of voice. The user may not have spoken yet. Result:
- Still captured before/without speech
- Audio clip is short silence (or speech-after-still which the server can't use)
- `still_ts_ms` points to the silent pre-speech period
- Server's bound-digit co-occurrence gate fails closed → false DENY

A secondary issue: when the voice gate DOES fire (co-occurrence detected), the code delays still capture by 350ms for a "✓ Got it" UX beat. During those 350ms the user's voice utterance may have ended, so `still_ts_ms` falls in the post-speech silence rather than mid-utterance.

## Fix

Three targeted changes to `beginStillCapture`:

### 1. No gesture-only advance when voice is required

When `_captureVoice = true` and `_voiceGate = null`, pass `speechMode: 'vad'` with `voiceArmed: false` to `_cooccurAdvanceDecision` (instead of gesture-only). This prevents premature capture. The fail-open is `_GEST_MAX_MS = 6000ms`  — at that point we capture anyway, and the audio clip will contain at minimum what the user said during the 6s window.

### 2. Capture still at co-occurrence moment, not after a 350ms timer

On `_captureNow = true`:
1. Capture still IMMEDIATELY (stillTsMs = `now - _audioStartMs`)
2. Show "✓ Got it" in the UI
3. Continue audio recording for `_POST_STILL_MS = 500ms` tail to capture the utterance tail
4. Then resolve

This ensures `still_ts_ms` lands inside the utterance, not after it.

### 3. Voice gate null + captureVoice: in-poll VAD fallback

When `_voiceGate = null` but `_captureVoice = true` and `audioAnalyser` is available (set by startAudioMonitor), build a lightweight per-tick amplitude check directly in the poll loop. This mirrors the FULL path's `_startSpeechGate` logic without the rAF wrapper — just read the analyser buffer on each 120ms tick. If RMS exceeds `FAST_VAD_SPEECH_RMS` and `_inlineSawSilence` is true, arm inline voice and use `_cooccurAdvanceDecision`.

## Unchanged

- FULL path: `beginRecording`, `_startSpeechGate`, `_cooccurAdvanceDecision` — untouched
- `_makeQuickReauthVoiceGate`: unchanged
- Fail-open 6s timeout: kept (degrade-not-hang)
- When `_captureVoice = false` (gesture-only policy): gesture-only advance unchanged

## Contract Check

`still_ts_ms` is the offset of the still into the audio clip such that the server can verify the spoken digit and the shown gesture co-occurred. With this fix, the still is captured WHILE the voice gate is armed (mid-utterance), so `still_ts_ms ∈ [onset, onset + utterance_len]` rather than falling in the silence tail.
