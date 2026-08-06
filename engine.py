"""
VAC Verification Engine — Shared Identity Verification
=======================================================
Extracted from FolioAI's video_auth.py as the SHARED service layer.

This engine powers BOTH:
  - VAC standalone (secure video, vouch verification)
  - FolioAI (referrals, 🔐 badge, coach authentication)

Capabilities:
  - Face liveness detection (Gemini visual analysis)
  - Deepfake detection (artifact scanning)
  - Voice verification (Deepgram transcription)
  - Challenge-response liveness (blink, head turn, finger count, voice)
  - Face consistency (is this the same person?)
  - Lip-sync validation (audio matches mouth movement?)

Phase roadmap:
  v1: Email OTP (done)
  v2: + Video liveness (this file) ← NOW
  v3: + Voice biometrics
  v4: + Geolocation

Athena PRINCIPLE: Don't rebuild what already exists.
FolioAI built this engine. VAC extracts and shares it.
"""

import os
import json
import time
import hashlib
import secrets
import random
import re
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
from enum import Enum
from config import (
    GEMINI_MODEL, DEEPGRAM_API_KEY, GEMINI_API_KEY,
    LIVENESS_BLINK_THRESHOLD, CHALLENGE_WORD_MATCH_THRESHOLD,
    CHALLENGE_SKIP_WORDS, LIP_SYNC_MISMATCH_PENALTY, LIP_SYNC_MISMATCH_CAP,
    CHALLENGE_NUM_DIGITS_DEFAULT, CHALLENGE_DIGIT_COUNTS, CHALLENGE_PHRASE_VARIANTS,
    DEEPGRAM_MODEL, DEEPGRAM_LANGUAGE,
    RECORDING_DURATION_MS, MAX_RECORDING_RETRIES, OTP_EXPIRY_MINUTES, OTP_LENGTH,
)

# Optional imports — graceful fallback if not installed
try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

try:
    from google import genai
    HAS_GENAI = True
except ImportError:
    HAS_GENAI = False


# ============================================================
# CONFIG — imported from config.py
# ============================================================

# ============================================================
# ENUMS
# ============================================================
class ChallengeType(str, Enum):
    BLINK = "blink"
    HEAD_TURN = "head_turn"
    FINGER_COUNT = "finger_count"
    VOICE_PHRASE = "voice_phrase"
    COMBO = "combo"


class LivenessResult(str, Enum):
    PASSED = "passed"
    FAILED = "failed"
    INCONCLUSIVE = "inconclusive"


# ============================================================
# PROMPTS — Gemini instructions for each verification type
# ============================================================

LIVENESS_DETECTION_PROMPT = """Analyze this short selfie video for liveness verification.

Check for:
1. FACE PRESENT: Is a real human face clearly visible and centered?
2. BLINK DETECTION: Did the person blink naturally at least once?
3. MICRO-EXPRESSIONS: Are there natural micro-expressions (tiny movements around eyes, mouth)?
4. HEAD MOVEMENT: Any natural small head movements (not perfectly still like a photo)?
5. LIGHTING CONSISTENCY: Is lighting on the face consistent with the environment?
6. EDGE ARTIFACTS: Any unnatural blurring or warping around face edges?

Respond ONLY in this JSON format:
{
  "face_detected": true/false,
  "face_centered": true/false,
  "blink_detected": true/false,
  "blink_count": 0,
  "micro_expressions_detected": true/false,
  "natural_head_movement": true/false,
  "lighting_consistent": true/false,
  "edge_artifacts": false,
  "liveness_score": 0.0-1.0,
  "is_live_person": true/false,
  "person_description": "brief description of the person",
  "notes": "brief explanation"
}"""

DEEPFAKE_DETECTION_PROMPT = """Analyze this video for signs of AI generation or deepfake manipulation.

Look for:
1. FACE: Unnatural skin texture, blurring around edges, inconsistent lighting
2. EYES: Irregular blinking, gaze that doesn't track naturally
3. MOUTH: Lip movements that don't sync with audio, teeth blur
4. HAIR: Edges that shimmer or warp
5. HANDS: Wrong finger count, unnatural poses
6. TEMPORAL: Flickering, frame inconsistencies
7. BACKGROUND: Warping around head, lighting mismatches

Respond ONLY in this JSON format:
{
  "deepfake_likelihood": 0.0-1.0,
  "is_likely_real": true/false,
  "artifacts_detected": [
    {"type": "description", "severity": "low/medium/high"}
  ],
  "liveness_indicators": {
    "natural_blinking": true/false,
    "micro_expressions": true/false,
    "consistent_lighting": true/false,
    "natural_movement": true/false,
    "audio_visual_sync": true/false
  },
  "confidence": 0.0-1.0,
  "notes": "brief explanation"
}"""

FACE_CONSISTENCY_PROMPT = """Compare the person in this video with this previous description:
"{reference_description}"

Determine if they appear to be the SAME person based on:
- General face shape
- Hair style and color
- Glasses or distinctive features
- Overall appearance

This is NOT biometric matching — just visual similarity.

Respond ONLY in this JSON format:
{
  "same_person_likely": true/false,
  "confidence": 0.0-1.0,
  "matching_features": ["feature1", "feature2"],
  "differing_features": [],
  "notes": "brief explanation"
}"""

VOICE_VERIFICATION_PROMPT = """Listen to this video clip. The person should be speaking a verification phrase.

Extract:
1. What words/numbers they said
2. Whether a real person is visibly speaking (not just audio)
3. Whether lip movements match the audio

Respond ONLY in this JSON format:
{
  "transcript": "what they said",
  "spoken_words": ["word1", "word2"],
  "spoken_digits": [1, 2, 3],
  "person_visible_speaking": true/false,
  "lip_sync_matches": true/false,
  "voice_confidence": 0.0-1.0,
  "notes": "brief explanation"
}"""


# ============================================================
# CHALLENGE GENERATOR
# ============================================================

WORD_POOL = [
    "kia ora", "manaakitanga", "aroha", "whanau",
    "sunflower", "pineapple", "butterfly", "rainbow",
    "elephant", "chocolate", "adventure", "harmony",
]


def generate_challenge(challenge_type: ChallengeType = None) -> Dict[str, Any]:
    """Generate a random liveness challenge. Unpredictable = anti-deepfake."""
    if challenge_type is None:
        challenge_type = random.choice(list(ChallengeType))

    challenge_id = f"ch_{secrets.token_hex(6)}"
    base = {
        "challenge_id": challenge_id,
        "type": challenge_type.value,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    if challenge_type == ChallengeType.BLINK:
        return {**base,
            "instruction": "Look at the camera and blink twice",
            "expected": {"blink_count": 2},
            "expires_seconds": 15}

    elif challenge_type == ChallengeType.HEAD_TURN:
        direction = random.choice(["left", "right"])
        return {**base,
            "instruction": f"Slowly turn your head to the {direction}",
            "expected": {"direction": direction},
            "expires_seconds": 15}

    elif challenge_type == ChallengeType.FINGER_COUNT:
        n = random.randint(1, 5)
        hand = random.choice(["left", "right"])
        return {**base,
            "instruction": f"Hold up {n} finger{'s' if n > 1 else ''} on your {hand} hand",
            "expected": {"finger_count": n, "hand": hand},
            "expires_seconds": 15}

    elif challenge_type == ChallengeType.VOICE_PHRASE:
        word = random.choice(WORD_POOL)
        digits = [random.randint(1, 5) for _ in range(3)]
        phrase = f"{word} {' '.join(str(d) for d in digits)}"
        return {**base,
            "instruction": f'Say: "{phrase}"',
            "expected": {"phrase": phrase, "word": word, "digits": digits},
            "expires_seconds": 20}

    elif challenge_type == ChallengeType.COMBO:
        n = random.randint(1, 5)
        word = random.choice(WORD_POOL)
        return {**base,
            "instruction": f'Hold up {n} finger{"s" if n > 1 else ""} and say "{word}"',
            "expected": {"finger_count": n, "word": word},
            "expires_seconds": 20}

    return base


def generate_single_gesture_challenge(risk_level: str = "medium") -> Dict[str, Any]:
    """
    Generate a Single Gesture challenge that captures all 4 modalities
    in one 5-second action. Challenge complexity scales with risk level.

    Patent Claim Group 5: Single Gesture Multi-Modal Verification Protocol
    Claim 5e: Adaptive Challenge Complexity Based on Risk Level
    """
    challenge_id = f"sg_{secrets.token_hex(6)}"

    # Greeting pool (rotated to prevent prediction)
    greetings = ["Kia ora", "Hello", "Hey there", "Good morning", "Hi there"]
    greeting = random.choice(greetings)

    # OTP digit count scales with risk (Claim 5e)
    digit_counts = {
        "low": 3,
        "medium": 3,
        "high": 4,
        "critical": 5,
    }
    num_digits = digit_counts.get(risk_level, 3)
    # Ensure all digits are different — prevents "hold same fingers" confusion
    # and makes each gesture visually distinct for Gemini detection
    # Also reject sequential runs (5,4,3 or 1,2,3) — too easy to game by just adding/dropping one finger
    def _non_sequential_digits(n):
        for _ in range(50):  # max attempts
            d = random.sample(range(1, 6), n)
            sequential = True
            for i in range(len(d) - 1):
                if abs(d[i+1] - d[i]) != 1:
                    sequential = False
                    break
            if not sequential:
                return d
        return random.sample(range(1, 6), n)  # fallback
    digits = _non_sequential_digits(num_digits)
    otp_code = "".join(str(d) for d in digits)
    spoken_digits = " ".join(str(d) for d in digits)

    # The phrase the user sees and speaks
    phrase = f"{greeting} {spoken_digits}"

    return {
        "challenge_id": challenge_id,
        "type": "single_gesture",
        "phrase": phrase,
        "otp_code": otp_code,
        "greeting": greeting,
        "num_digits": num_digits,
        "risk_level": risk_level,
        "instruction": f'Look at the camera and say: "{phrase}"',
        "modalities_captured": [
            "video_liveness",
            "voice_biometric",
            "otp_verification",
            "geolocation",
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_seconds": 120,
    }


# ============================================================
# VERIFICATION ENGINE
# ============================================================

class VerificationEngine:
    """
    Core engine for identity verification.
    Uses Gemini for visual analysis, Deepgram for audio.
    Runs in simulated mode when API keys not present.
    """

    def __init__(self):
        self.simulated = not GEMINI_API_KEY
        if self.simulated:
            print("[VAC ENGINE] Running in SIMULATED mode (no GEMINI_API_KEY)")

    # ------ LIVENESS CHECK ------

    async def check_liveness(self, video_url: str) -> Dict[str, Any]:
        """
        Check if the video contains a live person.
        Uses Gemini to detect blinks, micro-expressions, natural movement.

        Returns:
            {result: passed/failed, score: 0-1, details: {...}}
        """
        if self.simulated:
            return self._sim_liveness()

        try:
            result = await self._gemini_analyze(video_url, LIVENESS_DETECTION_PROMPT)
            score = result.get("liveness_score", 0)
            is_live = result.get("is_live_person", False)

            return {
                "result": LivenessResult.PASSED.value if is_live and score >= LIVENESS_BLINK_THRESHOLD else LivenessResult.FAILED.value,
                "score": score,
                "face_detected": result.get("face_detected", False),
                "blink_detected": result.get("blink_detected", False),
                "micro_expressions": result.get("micro_expressions_detected", False),
                "natural_movement": result.get("natural_head_movement", False),
                "person_description": result.get("person_description", ""),
                "notes": result.get("notes", ""),
            }
        except Exception as e:
            return {"result": LivenessResult.INCONCLUSIVE.value, "error": str(e), "score": 0}

    # ------ DEEPFAKE DETECTION ------

    async def check_deepfake(self, video_url: str) -> Dict[str, Any]:
        """
        Scan video for deepfake/AI-generation artifacts.

        Returns:
            {is_real: bool, likelihood: 0-1, artifacts: [...]}
        """
        if self.simulated:
            return self._sim_deepfake()

        try:
            result = await self._gemini_analyze(video_url, DEEPFAKE_DETECTION_PROMPT)
            likelihood = result.get("deepfake_likelihood", 0)

            return {
                "is_real": result.get("is_likely_real", True),
                "deepfake_likelihood": likelihood,
                "blocked": likelihood >= DEEPFAKE_BLOCK_THRESHOLD,
                "artifacts": result.get("artifacts_detected", []),
                "liveness_indicators": result.get("liveness_indicators", {}),
                "confidence": result.get("confidence", 0),
                "notes": result.get("notes", ""),
            }
        except Exception as e:
            return {"is_real": None, "error": str(e), "deepfake_likelihood": 0.5}

    # ------ FACE CONSISTENCY ------

    async def check_face_match(self, video_url: str, reference_description: str) -> Dict[str, Any]:
        """
        Check if person in video matches a stored reference description.
        NOT biometric — visual similarity via Gemini.

        Returns:
            {matches: bool, confidence: 0-1, features: [...]}
        """
        if self.simulated:
            return self._sim_face_match()

        try:
            prompt = FACE_CONSISTENCY_PROMPT.replace("{reference_description}", reference_description)
            result = await self._gemini_analyze(video_url, prompt)

            return {
                "matches": result.get("same_person_likely", False),
                "confidence": result.get("confidence", 0),
                "matching_features": result.get("matching_features", []),
                "differing_features": result.get("differing_features", []),
                "notes": result.get("notes", ""),
            }
        except Exception as e:
            return {"matches": False, "error": str(e), "confidence": 0}

    # ------ VOICE VERIFICATION ------

    async def verify_voice(self, video_url: str, expected_phrase: str = None) -> Dict[str, Any]:
        """
        Extract and verify spoken content from video.
        Primary: Gemini (visual + audio). Future: Deepgram for accuracy.

        Returns:
            {transcript: str, matches_expected: bool, lip_sync: bool}
        """
        if self.simulated:
            return self._sim_voice(expected_phrase)

        try:
            result = await self._gemini_analyze(video_url, VOICE_VERIFICATION_PROMPT)
            transcript = result.get("transcript", "").lower()
            matches = True
            if expected_phrase:
                matches = expected_phrase.lower() in transcript

            return {
                "transcript": result.get("transcript", ""),
                "spoken_words": result.get("spoken_words", []),
                "spoken_digits": result.get("spoken_digits", []),
                "matches_expected": matches,
                "lip_sync": result.get("lip_sync_matches", True),
                "person_visible": result.get("person_visible_speaking", False),
                "confidence": result.get("voice_confidence", 0),
            }
        except Exception as e:
            return {"transcript": "", "error": str(e), "matches_expected": False}

    # ------ CHALLENGE VERIFICATION ------

    async def verify_challenge(self, video_url: str, challenge: Dict[str, Any]) -> Dict[str, Any]:
        """
        Verify a liveness challenge response.
        Combines liveness + deepfake + challenge-specific checks.

        Returns:
            {passed: bool, liveness: {...}, deepfake: {...}, challenge_check: {...}}
        """
        # Run checks in parallel (conceptually — sequential for simplicity)
        liveness = await self.check_liveness(video_url)
        deepfake = await self.check_deepfake(video_url)

        # Challenge-specific verification
        challenge_type = challenge.get("type", "")
        challenge_check = {"passed": True}

        if challenge_type in ["voice_phrase", "combo"]:
            expected = challenge.get("expected", {})
            phrase = expected.get("phrase", expected.get("word", ""))
            voice = await self.verify_voice(video_url, phrase)
            challenge_check = {
                "passed": voice.get("matches_expected", False),
                "transcript": voice.get("transcript", ""),
                "lip_sync": voice.get("lip_sync", False),
            }

        # Overall verdict
        liveness_passed = liveness.get("result") == LivenessResult.PASSED.value
        deepfake_clear = not deepfake.get("blocked", False)
        challenge_passed = challenge_check.get("passed", True)

        all_passed = liveness_passed and deepfake_clear and challenge_passed

        return {
            "passed": all_passed,
            "liveness": liveness,
            "deepfake": deepfake,
            "challenge_check": challenge_check,
            "trust_score_component": liveness.get("score", 0) * 0.35 if all_passed else 0,
        }

    # ------ COMPOSITE TRUST SCORE ------

    def compute_trust_score(self,
        otp_verified: bool = False,
        liveness_score: float = 0,
        voice_score: float = 0,
        location_verified: bool = False,
        finger_gesture_score: float = 0,
    ) -> Dict[str, Any]:
        """
        Compute composite trust score from all modalities.
        Weights (updated with finger gesture):
          Video liveness:  0.30
          Voice biometric: 0.20
          OTP/text:        0.15
          Finger gesture:  0.20
          Geolocation:     0.15
        """
        otp_component = 0.15 if otp_verified else 0
        video_component = liveness_score * 0.30
        voice_component = voice_score * 0.20
        finger_component = finger_gesture_score * 0.20
        geo_component = 0.15 if location_verified else 0

        total = otp_component + video_component + voice_component + finger_component + geo_component
        total = round(min(1.0, total), 2)

        modalities_used = sum([otp_verified, liveness_score > 0, voice_score > 0, finger_gesture_score > 0, location_verified])

        return {
            "score": total,
            "level": "high" if total >= 0.7 else "medium" if total >= 0.4 else "low",
            "modalities_used": modalities_used,
            "breakdown": {
                "otp": otp_component,
                "video_liveness": round(video_component, 3),
                "voice_biometric": round(voice_component, 3),
                "finger_gesture": round(finger_component, 3),
                "geolocation": geo_component,
            },
            # Adaptive threshold guidance
            "sufficient_for": {
                "low_risk": total >= 0.20,      # OTP alone
                "medium_risk": total >= 0.40,    # OTP + 1 biometric
                "high_risk": total >= 0.70,      # OTP + 2 biometrics
                "critical": total >= 0.90,       # All modalities
            }
        }

    # ------ DEEPGRAM API ------

    async def _deepgram_transcribe(self, audio_bytes: bytes, mimetype: str = "audio/webm") -> Dict[str, Any]:
        """Send audio to Deepgram for transcription + voice analysis.
        
        Returns transcript, confidence, and word-level timing for lip-sync correlation.
        Note: Deepgram can extract audio from video containers. We normalize
        video/webm → audio/webm since the audio codec (opus) is the same.
        """
        if not DEEPGRAM_API_KEY:
            raise RuntimeError("Deepgram API not available (no DEEPGRAM_API_KEY)")

        # Normalize mimetype — Deepgram handles webm audio extraction but
        # sometimes rejects video/* content types. Force audio/* for better compat.
        dg_mimetype = mimetype
        if "webm" in mimetype:
            dg_mimetype = "audio/webm"
        elif "mp4" in mimetype or "mpeg" in mimetype:
            dg_mimetype = "audio/mp4"
        
        print(f"[DEEPGRAM] Sending {len(audio_bytes)} bytes as {dg_mimetype} (original: {mimetype})")

        async with httpx.AsyncClient() as http:
            resp = await http.post(
                "https://api.deepgram.com/v1/listen",
                params={
                    "model": "nova-3",
                    "smart_format": "true",
                    "utterances": "true",
                    "diarize": "true",
                },
                headers={
                    "Authorization": f"Token {DEEPGRAM_API_KEY}",
                    "Content-Type": dg_mimetype,
                },
                content=audio_bytes,
                timeout=30,
            )
            if resp.status_code != 200:
                raise RuntimeError(f"Deepgram error {resp.status_code}: {resp.text[:200]}")
            return resp.json()

    async def transcribe_audio(self, audio_bytes: bytes, expected_phrase: str = None, mimetype: str = "audio/webm") -> Dict[str, Any]:
        """Transcribe audio and check against expected phrase.
        
        Returns:
            {transcript, confidence, matches_expected, word_count, words: [{word, start, end, confidence}]}
        """
        if self.simulated:
            return self._sim_voice(expected_phrase)

        try:
            result = await self._deepgram_transcribe(audio_bytes, mimetype)
            
            # Extract transcript from Deepgram response
            channels = result.get("results", {}).get("channels", [])
            if not channels:
                return {"transcript": "", "confidence": 0, "matches_expected": False, "error": "No audio channels found"}
            
            alt = channels[0].get("alternatives", [{}])[0]
            transcript = alt.get("transcript", "").strip()
            confidence = alt.get("confidence", 0)
            words = alt.get("words", [])
            
            # Check against expected phrase
            matches = True
            if expected_phrase:
                # Normalize both for comparison
                expected_norm = expected_phrase.lower().strip()
                transcript_norm = transcript.lower().strip()
                
                # Normalize number words to digits for comparison
                # task-653: mirror _CONTENT_DIGIT_MAP homophones (whitelist only — no fuzzy matching).
                number_map = {"zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
                              "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
                              "ten": "10",
                              # transcription homophones — same list as client _CONTENT_DIGIT_MAP
                              "for": "4", "fore": "4",         # four → 4
                              "won": "1", "juan": "1",          # one → 1
                              "to": "2", "too": "2", "tu": "2", # two → 2
                              "tree": "3", "free": "3",         # three → 3
                              "fife": "5",                      # five → 5
                              "ate": "8",                       # eight → 8
                              "oh": "0", "o": "0",              # zero → 0
                              "niner": "9",                     # nine → 9 (NATO)
                             }
                import re
                def normalize_words(text):
                    # Strip punctuation, normalize numbers, split concatenated digits
                    words = re.findall(r'\w+', text.lower())
                    result = set()
                    for w in words:
                        w = number_map.get(w, w)
                        # Split concatenated digits: "421" -> {"4","2","1"}
                        if w.isdigit() and len(w) > 1:
                            for ch in w:
                                result.add(ch)
                        else:
                            result.add(w)
                    return result
                
                expected_words = normalize_words(expected_norm)
                transcript_words = normalize_words(transcript_norm)
                # Remove common filler/greeting words that Deepgram might miss or add
                skip_words = CHALLENGE_SKIP_WORDS
                expected_core = expected_words - skip_words
                transcript_core = transcript_words - skip_words
                overlap = expected_core & transcript_core
                match_ratio = len(overlap) / len(expected_core) if expected_core else 0
                matches = match_ratio >= CHALLENGE_WORD_MATCH_THRESHOLD
            
            return {
                "transcript": transcript,
                "confidence": round(confidence, 3),
                "matches_expected": matches,
                "match_ratio": round(match_ratio, 3) if expected_phrase else 1.0,
                "word_count": len(words),
                "words": [{"word": w["word"], "start": w["start"], "end": w["end"], "confidence": round(w["confidence"], 3)} for w in words[:20]],
                "provider": "deepgram_nova3",
                "_expected_core": sorted(list(expected_core)) if expected_phrase else [],
                "_transcript_core": sorted(list(transcript_core)) if expected_phrase else [],
                "_overlap": sorted(list(overlap)) if expected_phrase else [],
            }
        except Exception as e:
            return {"transcript": "", "confidence": 0, "matches_expected": False, "error": str(e)}

    # ------ GEMINI API ------

    async def _gemini_analyze(self, video_url: str, prompt: str) -> Dict[str, Any]:
        """Send video to Gemini for analysis."""
        if not HAS_GENAI or not GEMINI_API_KEY:
            raise RuntimeError("Gemini API not available")

        client = genai.Client(api_key=GEMINI_API_KEY)

        # For URL-based videos, use inline data
        # For local files, upload first
        if video_url.startswith("http"):
            # Fetch video bytes
            async with httpx.AsyncClient() as http:
                resp = await http.get(video_url, timeout=30)
                video_bytes = resp.content
        else:
            with open(video_url, "rb") as f:
                video_bytes = f.read()

        import base64
        b64 = base64.b64encode(video_bytes).decode()

        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[
                {"role": "user", "parts": [
                    {"inline_data": {"mime_type": "video/mp4", "data": b64}},
                    {"text": prompt},
                ]}
            ],
            config={"response_mime_type": "application/json", "temperature": 0.1},
        )

        return json.loads(response.text)

    # ------ FULL BIOMETRIC VERIFICATION (Phase 2) ------

    async def verify_biometrics(
        self,
        video_bytes: bytes,
        audio_bytes: bytes,
        expected_phrase: str,
        video_mimetype: str = "video/webm",
        audio_mimetype: str = "audio/webm",
        expected_digits: list = None,
    ) -> Dict[str, Any]:
        """
        Run all 6 biometric modalities against real video + audio data.
        
        Modalities:
            1. Face liveness (Gemini) — is this a live person?
            2. Deepfake detection (Gemini) — any AI generation artifacts?
            3. Voiceprint / transcription (Deepgram) — what did they say?
            4. Lip-sync correlation (Gemini) — does mouth match audio?
            5. Challenge response (Deepgram + match) — did they say the right phrase?
            6. Geolocation (browser) — passed through from frontend
        
        Returns composite result with per-modality scores.
        """
        import base64
        import tempfile
        import asyncio

        results = {
            "face_liveness": None,
            "deepfake_detection": None,
            "voiceprint": None,
            "lip_sync": None,
            "challenge_response": None,
            "geolocation": None,  # Not used in initial auth — reserved for groups/cultural governance (claims 168-241)
            "duress": None,  # Silent alarm — claims cover duress detection with emergency key transfer
        }
        errors = []

        # Write video to temp file for Gemini (it needs a file path or base64)
        video_b64 = base64.b64encode(video_bytes).decode()

        # --- Run Gemini + Deepgram in PARALLEL ---
        t_start = time.time()
        
        # --- Run Gemini checks (liveness + deepfake + lip-sync) ---
        if HAS_GENAI and GEMINI_API_KEY:
            try:
                client = genai.Client(api_key=GEMINI_API_KEY)
                
                # Build expected digits string for finger gesture verification
                expected_digits_str = ", ".join(str(d) for d in (expected_digits or []))
                
                # Single Gemini call with comprehensive prompt (more efficient than 3 separate calls)
                comprehensive_prompt = f"""Analyze this video recording for identity verification. The person should be speaking the phrase: "{expected_phrase}"

Perform ALL of the following analyses and respond in a single JSON object:

1. LIVENESS: Is this a real, live person? Check for blinks, micro-expressions, natural head movement.
2. DEEPFAKE: Any signs of AI generation? Check face edges, skin texture, temporal consistency.
3. LIP SYNC: Do the person's lip movements match the audio? Is the person visibly speaking?
4. CHALLENGE: Can you detect them saying something? Does their mouth movement suggest they spoke the expected phrase?
5. FINGER GESTURE: After speaking, the person should hold up fingers near their face to show digits sequentially. There should be EXACTLY {len(expected_digits or [])} distinct finger poses. You must COUNT THE EXACT NUMBER OF FINGERS held up in each distinct pose. Do NOT guess or assume. Look carefully at each hand pose and count only extended fingers (thumb counts). The hand must be visible near the face. If no finger gestures detected, set fingers_detected to false. CRITICAL: Report ONLY what you actually see. Accuracy is more important than passing. If you see 2 fingers report 2, if you see a fist report 0.
6. DURESS DETECTION: Analyze whether the person appears to be under coercion or distress. Check for: unusual rapid eye movements (glancing at someone off-camera), forced or unnatural facial expression, visible tension or fear, trembling, unnaturally stiff posture, signs the person is being directed by someone else, mismatch between spoken words and emotional state. This is a SECURITY-CRITICAL check. If ANY signs of duress are detected, report them. False positives are acceptable — false negatives are dangerous.

Respond ONLY in this exact JSON format:
{{
  "liveness": {{
    "is_live_person": true/false,
    "score": 0.0-1.0,
    "face_detected": true/false,
    "blink_detected": true/false,
    "micro_expressions": true/false,
    "natural_movement": true/false,
    "person_description": "brief description"
  }},
  "deepfake": {{
    "is_likely_real": true/false,
    "deepfake_likelihood": 0.0-1.0,
    "confidence": 0.0-1.0,
    "artifacts": []
  }},
  "lip_sync": {{
    "lip_movement_detected": true/false,
    "matches_audio": true/false,
    "confidence": 0.0-1.0
  }},
  "visual_speech": {{
    "person_speaking": true/false,
    "estimated_words": "what you think they said based on lip reading",
    "confidence": 0.0-1.0
  }},
  "finger_gesture": {{
    "fingers_detected": true/false,
    "digit_sequence_seen": [],
    "hand_near_face": true/false,
    "confidence": 0.0-1.0
  }},
  "duress": {{
    "under_duress": false,
    "duress_likelihood": 0.0-1.0,
    "indicators": [],
    "confidence": 0.0-1.0,
    "eye_movement_unusual": false,
    "expression_forced": false,
    "visible_tension": false,
    "directed_by_other": false
  }}
}}"""

                # Determine mime type for Gemini
                gemini_mime = "video/webm" if "webm" in video_mimetype else "video/mp4"
                
                # Run Gemini in background thread (sync API → async via to_thread)
                def _gemini_call():
                    return client.models.generate_content(
                        model=GEMINI_MODEL,
                        contents=[
                            {"role": "user", "parts": [
                                {"inline_data": {"mime_type": gemini_mime, "data": video_b64}},
                                {"text": comprehensive_prompt},
                            ]}
                        ],
                        config={"response_mime_type": "application/json", "temperature": 0.1},
                    )
                response = await asyncio.to_thread(_gemini_call)
                gemini_result = json.loads(response.text)

                # Extract liveness
                lv = gemini_result.get("liveness", {})
                results["face_liveness"] = {
                    "status": "verified" if lv.get("is_live_person") else "failed",
                    "score": lv.get("score", 0),
                    "face_detected": lv.get("face_detected", False),
                    "blink_detected": lv.get("blink_detected", False),
                    "person_description": lv.get("person_description", ""),
                    "provider": "gemini",
                }

                # Extract deepfake
                df = gemini_result.get("deepfake", {})
                results["deepfake_detection"] = {
                    "status": "verified" if df.get("is_likely_real") else "failed",
                    "score": df.get("confidence", 0),
                    "deepfake_likelihood": df.get("deepfake_likelihood", 0),
                    "artifacts": df.get("artifacts", []),
                    "provider": "gemini",
                }

                # Extract lip sync
                ls = gemini_result.get("lip_sync", {})
                lip_matched = ls.get("matches_audio", False)
                lip_confidence = ls.get("confidence", 0)
                # If matches_audio is false, score should reflect that even if Gemini is "confident" in its assessment
                lip_score = lip_confidence if lip_matched else min(lip_confidence * LIP_SYNC_MISMATCH_PENALTY, LIP_SYNC_MISMATCH_CAP)
                results["lip_sync"] = {
                    "status": "verified" if lip_matched else "inconclusive",
                    "score": round(lip_score, 2),
                    "lip_movement_detected": ls.get("lip_movement_detected", False),
                    "provider": "gemini",
                }
                
                # Capture visual speech analysis (lip reading) — for "Under the Hood" display
                vs = gemini_result.get("visual_speech", {})
                if vs:
                    results["lip_sync"]["visual_speech"] = {
                        "person_speaking": vs.get("person_speaking", False),
                        "estimated_words": vs.get("estimated_words", ""),
                        "confidence": vs.get("confidence", 0),
                    }

                # Extract finger gesture verification
                fg = gemini_result.get("finger_gesture", {})
                digits_seen = fg.get("digit_sequence_seen", [])
                digits_expected = expected_digits or []
                # Score: how many sequential digits matched
                fg_matches = 0
                for i, exp in enumerate(digits_expected):
                    if i < len(digits_seen) and digits_seen[i] == exp:
                        fg_matches += 1
                fg_total = max(len(digits_expected), 1)
                all_correct = (fg_matches == fg_total) and fg_total > 0
                fg_score_val = fg_matches / fg_total if fg.get("fingers_detected") else 0.0
                if fg.get("hand_near_face") and fg_score_val > 0:
                    fg_score_val = min(fg_score_val + 0.1, 1.0)
                results["finger_gesture"] = {
                    "status": "verified" if all_correct else "failed",
                    "score": round(fg_score_val, 2),
                    "digits_expected": digits_expected,
                    "digits_seen": digits_seen,
                    "hand_near_face": fg.get("hand_near_face", False),
                    "sequence_correct": all_correct,
                    "provider": "gemini",
                }

                # Extract duress detection (7th modality — silent alarm)
                dr = gemini_result.get("duress", {})
                duress_indicators = dr.get("indicators", [])
                if dr.get("eye_movement_unusual"): duress_indicators.append("unusual_eye_movement")
                if dr.get("expression_forced"): duress_indicators.append("forced_expression")
                if dr.get("visible_tension"): duress_indicators.append("visible_tension")
                if dr.get("directed_by_other"): duress_indicators.append("directed_by_other")
                results["duress"] = {
                    "status": "alert" if dr.get("under_duress") else "clear",
                    "score": round(1.0 - dr.get("duress_likelihood", 0), 2),  # Invert: higher = safer
                    "duress_likelihood": dr.get("duress_likelihood", 0),
                    "indicators": duress_indicators,
                    "under_duress": dr.get("under_duress", False),
                    "provider": "gemini",
                }
                if dr.get("under_duress") or dr.get("duress_likelihood", 0) > 0.6:
                    print(f"[DURESS ALERT] User {expected_phrase[:30]}... — likelihood: {dr.get('duress_likelihood')}, indicators: {duress_indicators}")

            except Exception as e:
                errors.append(f"Gemini: {str(e)}")
                # Fallback to simulated for Gemini modalities
                results["face_liveness"] = {"status": "error", "score": 0, "error": str(e), "provider": "gemini"}
                results["deepfake_detection"] = {"status": "error", "score": 0, "error": str(e), "provider": "gemini"}
                results["lip_sync"] = {"status": "error", "score": 0, "error": str(e), "provider": "gemini"}
                results["finger_gesture"] = {"status": "error", "score": 0, "error": str(e), "provider": "gemini"}
                results["duress"] = {"status": "clear", "score": 1.0, "duress_likelihood": 0, "indicators": [], "under_duress": False, "provider": "fallback"}
            t_gemini = time.time()
            print(f"[TIMING] Gemini: {t_gemini - t_start:.1f}s")
        else:
            # No Gemini — use simulated
            sim_lv = self._sim_liveness()
            results["face_liveness"] = {"status": "verified", "score": sim_lv["score"], "provider": "simulated"}
            sim_df = self._sim_deepfake()
            results["deepfake_detection"] = {"status": "verified", "score": sim_df["confidence"], "provider": "simulated"}
            results["lip_sync"] = {"status": "verified", "score": 0.88, "provider": "simulated"}
            results["finger_gesture"] = {"status": "verified", "score": 0.85, "digits_expected": expected_digits or [], "digits_seen": expected_digits or [], "hand_near_face": True, "provider": "simulated"}
            results["duress"] = {"status": "clear", "score": 1.0, "duress_likelihood": 0, "indicators": [], "under_duress": False, "provider": "simulated"}

        # --- Run Deepgram check (voiceprint + challenge) ---
        if DEEPGRAM_API_KEY and audio_bytes:
            try:
                dg_result = await self.transcribe_audio(audio_bytes, expected_phrase, audio_mimetype)
                
                results["voiceprint"] = {
                    "status": "verified" if dg_result.get("confidence", 0) > 0.5 else "failed",
                    "score": dg_result.get("confidence", 0),
                    "transcript": dg_result.get("transcript", ""),
                    "word_count": dg_result.get("word_count", 0),
                    "provider": "deepgram_nova3",
                }

                results["challenge_response"] = {
                    "status": "verified" if dg_result.get("matches_expected") else "failed",
                    "score": dg_result.get("match_ratio", 0),
                    "expected": expected_phrase,
                    "heard": dg_result.get("transcript", ""),
                    "provider": "deepgram_nova3",
                }
                # Debug: log what was heard vs expected
                print(f"[CHALLENGE] Expected: '{expected_phrase}'")
                print(f"[CHALLENGE] Heard:    '{dg_result.get('transcript', '')}'")
                print(f"[CHALLENGE] Expected core: {dg_result.get('_expected_core', 'N/A')}")
                print(f"[CHALLENGE] Heard core:    {dg_result.get('_transcript_core', 'N/A')}")
                print(f"[CHALLENGE] Overlap:       {dg_result.get('_overlap', 'N/A')}")
                print(f"[CHALLENGE] Match:    {dg_result.get('match_ratio', 0)} (threshold: 0.85)")
            except Exception as e:
                errors.append(f"Deepgram: {str(e)}")
                results["voiceprint"] = {"status": "error", "score": 0, "error": str(e), "provider": "deepgram"}
                results["challenge_response"] = {"status": "error", "score": 0, "error": str(e), "provider": "deepgram"}
            t_deepgram = time.time()
            print(f"[TIMING] Deepgram: {t_deepgram - t_gemini:.1f}s" if 't_gemini' in dir() else f"[TIMING] Deepgram: {t_deepgram - t_start:.1f}s")
        else:
            sim_v = self._sim_voice(expected_phrase)
            results["voiceprint"] = {"status": "verified", "score": sim_v["confidence"], "provider": "simulated"}
            results["challenge_response"] = {"status": "verified", "score": 0.90, "provider": "simulated"}

        t_total = time.time()
        print(f"[TIMING] Total verification: {t_total - t_start:.1f}s")
        
        # --- Compute composite trust score ---
        liveness_score = results["face_liveness"].get("score", 0) if results["face_liveness"].get("status") == "verified" else 0
        voice_score = results["voiceprint"].get("score", 0) if results["voiceprint"].get("status") == "verified" else 0
        deepfake_ok = results["deepfake_detection"].get("status") == "verified"
        challenge_ok = results["challenge_response"].get("status") == "verified"
        fg_score = results.get("finger_gesture", {}).get("score", 0)
        
        trust = self.compute_trust_score(
            otp_verified=challenge_ok,
            liveness_score=liveness_score,
            voice_score=voice_score,
            location_verified=False,
            finger_gesture_score=fg_score,
        )

        # Overall pass/fail
        modality_statuses = [r.get("status") for r in results.values() if r]
        failed_count = modality_statuses.count("failed")
        error_count = modality_statuses.count("error")
        
        overall_passed = failed_count == 0 and trust["score"] >= 0.4

        return {
            "passed": overall_passed,
            "overall_score": trust["score"],
            "trust_level": trust["level"],
            "modalities": results,
            "trust_breakdown": trust["breakdown"],
            "sufficient_for": trust["sufficient_for"],
            "errors": errors if errors else None,
            "real_biometrics": bool(GEMINI_API_KEY or DEEPGRAM_API_KEY),
        }

    # ------ SIMULATED RESPONSES (dev mode) ------

    def _sim_liveness(self) -> Dict[str, Any]:
        return {
            "result": LivenessResult.PASSED.value,
            "score": 0.92,
            "face_detected": True, "blink_detected": True,
            "micro_expressions": True, "natural_movement": True,
            "person_description": "Person looking at camera, natural expression, well-lit",
            "notes": "[SIMULATED] Liveness passed",
        }

    def _sim_deepfake(self) -> Dict[str, Any]:
        return {
            "is_real": True, "deepfake_likelihood": 0.05, "blocked": False,
            "artifacts": [], "confidence": 0.93,
            "liveness_indicators": {
                "natural_blinking": True, "micro_expressions": True,
                "consistent_lighting": True, "natural_movement": True,
                "audio_visual_sync": True,
            },
            "notes": "[SIMULATED] No deepfake artifacts",
        }

    def _sim_face_match(self) -> Dict[str, Any]:
        return {
            "matches": True, "confidence": 0.88,
            "matching_features": ["face shape", "hair", "general appearance"],
            "differing_features": [],
            "notes": "[SIMULATED] Face match",
        }

    def _sim_voice(self, expected: str = None) -> Dict[str, Any]:
        return {
            "transcript": expected or "kia ora three five seven",
            "spoken_words": ["kia", "ora"],
            "spoken_digits": [3, 5, 7],
            "matches_expected": True,
            "lip_sync": True, "person_visible": True, "confidence": 0.90,
        }


# ============================================================
# SINGLETON
# ============================================================
_engine: Optional[VerificationEngine] = None

def get_engine() -> VerificationEngine:
    global _engine
    if _engine is None:
        _engine = VerificationEngine()
    return _engine
