from app.services.voice_profiles import (
    VOICE_PROFILES,
    minimax_tts_params,
    resolve_minimax_voice,
)


def test_builtin_indian_english_profiles_are_audibly_distinct() -> None:
    assert set(VOICE_PROFILES) == {
        "indian-calm",
        "indian-advisor",
        "indian-anchor",
        "indian-deep",
        "indian-bright",
    }
    assert all(profile.voice_id.startswith("hindi_") for profile in VOICE_PROFILES.values())
    assert all(1.06 <= profile.speed <= 1.14 for profile in VOICE_PROFILES.values())
    signatures = {
        (
            profile.voice_id,
            profile.speed,
            profile.vol,
            profile.pitch,
            profile.emotion,
        )
        for profile in VOICE_PROFILES.values()
    }
    assert len(signatures) == len(VOICE_PROFILES)


def test_legacy_aliases_resolve_to_indian_profiles_and_current_minimax_shape() -> None:
    assert resolve_minimax_voice("Nova") == VOICE_PROFILES["indian-calm"]
    assert resolve_minimax_voice("Atlas") == VOICE_PROFILES["indian-advisor"]
    assert resolve_minimax_voice("Ember") == VOICE_PROFILES["indian-anchor"]
    assert resolve_minimax_voice("Lumen") == VOICE_PROFILES["indian-deep"]
    assert resolve_minimax_voice("Sage") == VOICE_PROFILES["indian-bright"]

    params = minimax_tts_params(resolve_minimax_voice("indian-anchor"))
    assert params == {
        "voice_setting": {
            "voice_id": "hindi_female_1_v2",
            "speed": 1.12,
            "vol": 1.03,
            "pitch": 0,
            "emotion": "fluent",
            "english_normalization": True,
        },
        "language_boost": "English",
    }
