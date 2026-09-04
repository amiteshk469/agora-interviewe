from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class MiniMaxVoiceProfile:
    voice_id: str
    speed: float
    vol: float
    pitch: int
    emotion: str


DEFAULT_VOICE_ALIAS = "indian-calm"

# MiniMax exposes three Indian timbres. Pace, pitch, volume, and delivery make the
# five built-in interviewers audibly distinct while they continue speaking English.
VOICE_PROFILES: dict[str, MiniMaxVoiceProfile] = {
    "indian-calm": MiniMaxVoiceProfile(
        voice_id="hindi_female_2_v1",
        speed=1.08,
        vol=1.0,
        pitch=-1,
        emotion="calm",
    ),
    "indian-advisor": MiniMaxVoiceProfile(
        voice_id="hindi_male_1_v2",
        speed=1.1,
        vol=1.02,
        pitch=0,
        emotion="calm",
    ),
    "indian-anchor": MiniMaxVoiceProfile(
        voice_id="hindi_female_1_v2",
        speed=1.12,
        vol=1.03,
        pitch=0,
        emotion="fluent",
    ),
    "indian-deep": MiniMaxVoiceProfile(
        voice_id="hindi_male_1_v2",
        speed=1.06,
        vol=1.05,
        pitch=-3,
        emotion="calm",
    ),
    "indian-bright": MiniMaxVoiceProfile(
        voice_id="hindi_female_2_v1",
        speed=1.14,
        vol=0.98,
        pitch=2,
        emotion="fluent",
    ),
}

# Preserve saved interview configurations while moving their sound to the new
# Indian-English defaults.
_LEGACY_ALIASES = {
    "clear-neutral": "indian-calm",
    "warm-analytical": "indian-advisor",
    "precise": "indian-anchor",
    "direct": "indian-deep",
    "nova": "indian-calm",
    "atlas": "indian-advisor",
    "sage": "indian-bright",
    "ember": "indian-anchor",
    "lumen": "indian-deep",
}

_DIRECT_VOICE_IDS = {
    "hindi_male_1_v2",
    "hindi_female_1_v2",
    "hindi_female_2_v1",
    "English_CalmWoman",
    "English_Trustworth_Man",
    "English_Debator",
    "English_Steadymentor",
    "English_Graceful_Lady",
    "English_expressive_narrator",
    "English_captivating_female1",
}


def resolve_minimax_voice(requested_voice: str | None) -> MiniMaxVoiceProfile:
    requested = (requested_voice or "").strip()
    if requested in _DIRECT_VOICE_IDS:
        return MiniMaxVoiceProfile(
            voice_id=requested,
            speed=1.08,
            vol=1.0,
            pitch=0,
            emotion="calm",
        )

    alias = requested.lower()
    alias = _LEGACY_ALIASES.get(alias, alias)
    return VOICE_PROFILES.get(alias, VOICE_PROFILES[DEFAULT_VOICE_ALIAS])


def minimax_tts_params(profile: MiniMaxVoiceProfile) -> dict[str, Any]:
    return {
        "voice_setting": {
            "voice_id": profile.voice_id,
            "speed": profile.speed,
            "vol": profile.vol,
            "pitch": profile.pitch,
            "emotion": profile.emotion,
            "english_normalization": True,
        },
        "language_boost": "English",
    }
