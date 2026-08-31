import asyncio
import logging
import secrets
import time
from functools import lru_cache
from typing import Annotated, Any, cast

from agora_agent.agentkit import Agent as AgoraAgent
from agora_agent.agentkit.token import generate_convo_ai_token
from agora_agent.agentkit.vendors import DeepgramSTT, MiniMaxTTS, OpenAI
from agora_agent.agentkit.vendors.avatar import (
    AkoolAvatar,
    AnamAvatar,
    GenericAvatar,
    LiveAvatarAvatar,
)
from agora_agent.agentkit.vendors.llm import CustomLLM
from agora_agent.core.domain import Area
from agora_agent.pool_client import AsyncAgora
from fastapi import Depends, HTTPException, status

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

DEFAULT_PROMPT = """You are a RoundCraft Product Management mock interviewer. Ask concise,
adaptive questions, probe unsupported claims, and keep shared context. Do not request a human
reviewer. When evidence is missing, ask another question or mark it insufficient."""
DEFAULT_GREETING = (
    "Welcome to RoundCraft. When you are ready, please introduce yourself."
)

_VOICE_TYPES = {
    "clear-neutral": "English_CalmWoman",
    "warm-analytical": "English_Graceful_Lady",
    "precise": "English_Debator",
    "direct": "English_Trustworth_Man",
    "nova": "English_expressive_narrator",
    "atlas": "English_Trustworth_Man",
    "sage": "English_Steadymentor",
    "ember": "English_Debator",
    "lumen": "English_Graceful_Lady",
}


class AgoraAgentService:
    """Adapted from the inspected official Python quickstart AgentSession flow."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client: AsyncAgora[Any] | None = None
        if settings.agora_app_id and settings.agora_app_certificate:
            area = {
                "US": Area.US,
                "EU": Area.EU,
                "AP": Area.AP,
                "INDIA": Area.AP,
                "CN": Area.CN,
            }.get(settings.agora_area.strip().upper(), Area.AP)
            self.client = AsyncAgora(
                area=area,
                app_id=settings.agora_app_id,
                app_certificate=settings.agora_app_certificate,
            )
        self._sessions: dict[str, Any] = {}

    def _require_client(self) -> AsyncAgora[Any]:
        if self.client is None:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Agora is not configured. Set AGORA_APP_ID and AGORA_APP_CERTIFICATE.",
            )
        return self.client

    def generate_connection(
        self,
        channel: str | None = None,
        uid: int | None = None,
        agent_uid: int | None = None,
    ) -> dict[str, Any]:
        self._require_client()
        user_uid = (
            secrets.randbelow(9_998_999) + 1000 if uid is None or uid <= 0 else uid
        )
        resolved_agent_uid = str(
            agent_uid
            if agent_uid is not None and agent_uid > 0
            else secrets.randbelow(89_999_999) + 10_000_000
        )
        channel_name = (
            channel or f"roundcraft-{int(time.time())}-{secrets.randbelow(9000) + 1000}"
        )
        token = generate_convo_ai_token(
            app_id=self.settings.agora_app_id,
            app_certificate=self.settings.agora_app_certificate,
            channel_name=channel_name,
            uid=user_uid,
            token_expire=3600,
        )
        return {
            "app_id": self.settings.agora_app_id,
            "token": token,
            "uid": str(user_uid),
            "channel_name": channel_name,
            "agent_uid": resolved_agent_uid,
        }

    def avatar_profile(
        self, panelist: dict[str, Any], avatar_uid: int
    ) -> dict[str, Any]:
        vendor = str(panelist.get("avatar_vendor") or self.settings.agora_avatar_vendor)
        requested_avatar_id = str(panelist.get("avatar_id") or "")
        avatar_ids = self.settings.avatar_id_map
        avatar_id = (
            str(
                avatar_ids.get(f"{vendor}:{requested_avatar_id}")
                or avatar_ids.get(requested_avatar_id)
                or avatar_ids.get(str(panelist["id"]))
                or requested_avatar_id
                or avatar_ids.get("default")
                or ""
            )
            or None
        )
        avatar_image = str(panelist.get("avatar_image") or "") or None
        configured = bool(
            self.settings.agora_avatar_enabled and self._avatar_api_key(vendor)
        )
        if vendor in {"generic", "anam"} and not avatar_id:
            configured = False
        if vendor == "generic" and not self.settings.agora_avatar_api_base_url:
            configured = False
        return {
            "avatar_uid": avatar_uid,
            "avatar_vendor": vendor if configured else None,
            "avatar_id": avatar_id,
            "avatar_image": avatar_image,
            "video_mode": "avatar"
            if configured
            else ("static" if avatar_image else "audio"),
        }

    def generate_panel_connection(self, panel: list[dict[str, Any]]) -> dict[str, Any]:
        if not 2 <= len(panel) <= 5:
            raise ValueError("Agora panel must contain two to five participants")
        connection = self.generate_connection()
        first_agent_uid = int(connection["agent_uid"])
        participants: list[dict[str, Any]] = []
        used = {int(connection["uid"]), first_agent_uid}
        for index, member in enumerate(panel):
            agent_uid = (
                first_agent_uid
                if index == 0
                else self._unique_uid(used, 10_000_000, 89_999_999)
            )
            used.add(agent_uid)
            avatar_uid = self._unique_uid(used, 100_000_000, 899_999_999)
            used.add(avatar_uid)
            participants.append(
                {
                    "panelist_id": str(member["id"]),
                    "display_name": str(member["display_name"]),
                    "role": str(member["role"]),
                    "agent_uid": agent_uid,
                    **self.avatar_profile(member, avatar_uid),
                }
            )
        connection["panelists"] = [
            {
                "panelist_id": item["panelist_id"],
                "agent_uid": str(item["agent_uid"]),
                "avatar_uid": str(item["avatar_uid"]),
                "video_mode": item["video_mode"],
            }
            for item in participants
        ]
        return {"connection": connection, "participants": participants}

    def _avatar_api_key(self, vendor: str) -> str:
        vendor_key = {
            "liveavatar": self.settings.agora_liveavatar_api_key,
            "generic": self.settings.agora_generic_avatar_api_key,
            "akool": self.settings.agora_akool_api_key,
            "anam": self.settings.agora_anam_api_key,
        }.get(vendor, "")
        return vendor_key or self.settings.agora_avatar_api_key

    @staticmethod
    def _unique_uid(used: set[int], floor: int, span: int) -> int:
        for _ in range(100):
            value = secrets.randbelow(span) + floor
            if value not in used:
                return value
        raise RuntimeError("Could not allocate a unique Agora UID")

    @staticmethod
    def _agent_name(panelist_id: str | None) -> str:
        safe_panelist = "".join(
            character if character.isalnum() else "-"
            for character in (panelist_id or "interviewer").lower()
        ).strip("-")[:24]
        return f"roundcraft-{safe_panelist or 'interviewer'}-{secrets.token_hex(6)}"

    def _avatar(self, profile: dict[str, Any]) -> Any | None:
        vendor = profile.get("avatar_vendor")
        if not vendor or profile.get("video_mode") != "avatar":
            return None
        api_key = self._avatar_api_key(str(vendor))
        avatar_id = cast(str | None, profile.get("avatar_id"))
        if vendor == "liveavatar":
            return LiveAvatarAvatar(
                api_key=api_key,
                avatar_id=avatar_id,
                quality=self.settings.agora_avatar_quality,
                agora_uid=str(profile["avatar_uid"]),
            )
        if vendor == "generic":
            return GenericAvatar(
                api_key=api_key,
                avatar_id=cast(str, avatar_id),
                api_base_url=self.settings.agora_avatar_api_base_url,
                agora_uid=str(profile["avatar_uid"]),
            )
        if vendor == "akool":
            return AkoolAvatar(
                api_key=api_key,
                avatar_id=avatar_id,
                additional_params={"agora_uid": str(profile["avatar_uid"])},
            )
        if vendor == "anam":
            return AnamAvatar(
                api_key=api_key,
                avatar_id=cast(str, avatar_id),
                additional_params={"agora_uid": str(profile["avatar_uid"])},
            )
        return None

    async def start(
        self,
        channel_name: str,
        agent_uid: int,
        user_uid: int,
        output_audio_codec: str | None = None,
        instructions: str = DEFAULT_PROMPT,
        greeting: str = DEFAULT_GREETING,
        roundcraft_session_id: str | None = None,
        panelist_id: str | None = None,
        panelist_voice: str = "clear-neutral",
        avatar_profile: dict[str, Any] | None = None,
        manual_turn_control: bool = False,
    ) -> dict[str, Any]:
        client = self._require_client()
        if not channel_name.strip() or agent_uid <= 0 or user_uid <= 0:
            raise ValueError("channel_name and positive agent/user UIDs are required")

        custom_configured = bool(
            self.settings.agora_custom_llm_url and self.settings.agora_llm_bearer_secret
        )
        if roundcraft_session_id and custom_configured:
            headers = (
                {
                    "X-RoundCraft-Session-Id": roundcraft_session_id,
                    **(
                        {"X-RoundCraft-Panelist-Id": panelist_id} if panelist_id else {}
                    ),
                }
                if roundcraft_session_id
                else None
            )
            llm: CustomLLM | OpenAI = CustomLLM(
                api_key=self.settings.agora_llm_bearer_secret,
                base_url=self.settings.agora_custom_llm_url,
                model="roundcraft-panel",
                headers=headers,
                greeting_message=greeting,
                failure_message="Please wait a moment.",
                max_history=15,
                max_tokens=1024,
                temperature=0.7,
                top_p=0.95,
            )
        elif roundcraft_session_id and self.settings.environment not in {
            "development",
            "test",
        }:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "RoundCraft custom LLM is required for product sessions",
            )
        else:
            llm = OpenAI(
                model="gpt-4o-mini",
                greeting_message=greeting,
                failure_message="Please wait a moment.",
                max_history=15,
                max_tokens=1024,
                temperature=0.7,
                top_p=0.95,
            )
        stt = DeepgramSTT(model="nova-3", language="en")
        avatar = self._avatar(avatar_profile or {})
        vendor = (avatar_profile or {}).get("avatar_vendor")
        sample_rate = 16_000 if vendor == "akool" else 24_000
        tts = MiniMaxTTS(
            model="speech_2_6_turbo",
            voice_id=_VOICE_TYPES.get(
                panelist_voice.lower(), "English_captivating_female1"
            ),
            sample_rate=sample_rate if avatar is not None else None,
        )
        parameters: dict[str, Any] = {
            "audio_scenario": "chorus",
            "data_channel": "rtm",
            "enable_error_message": True,
            "enable_metrics": True,
        }
        if output_audio_codec and output_audio_codec.strip():
            parameters["output_audio_codec"] = output_audio_codec.strip()

        turn_detection = (
            {
                "config": {
                    "start_of_speech": {"mode": "manual"},
                    "end_of_speech": {"mode": "manual"},
                }
            }
            if manual_turn_control
            else {
                "config": {
                    "speech_threshold": 0.5,
                    "start_of_speech": {
                        "mode": "vad",
                        "vad_config": {
                            "interrupt_duration_ms": 160,
                            "prefix_padding_ms": 300,
                        },
                    },
                    "end_of_speech": {
                        "mode": "vad",
                        "vad_config": {"silence_duration_ms": 480},
                    },
                }
            }
        )
        agora_agent = AgoraAgent(
            client=client,
            instructions=instructions,
            greeting=greeting,
            failure_message="Please wait a moment.",
            max_history=50,
            turn_detection=turn_detection,
            advanced_features=cast(Any, {"enable_rtm": True, "enable_tools": True}),
            parameters=cast(Any, parameters),
        )
        agora_agent = agora_agent.with_stt(stt).with_llm(llm).with_tts(tts)
        if avatar is not None:
            agora_agent = agora_agent.with_avatar(avatar)
        session: Any | None = None
        agent_id: str | None = None
        for attempt in range(2):
            session = agora_agent.create_async_session(
                channel=channel_name,
                agent_uid=str(agent_uid),
                remote_uids=[str(user_uid)],
                name=self._agent_name(panelist_id),
                enable_string_uid=False,
                idle_timeout=self.settings.agora_agent_idle_timeout_seconds,
                expires_in=self.settings.agora_session_expires_seconds,
            )
            try:
                agent_id = await session.start()
                break
            except Exception as exc:
                if attempt == 0 and getattr(exc, "status_code", None) == 409:
                    logger.warning(
                        "Agora agent name collision; retrying with a fresh name"
                    )
                    continue
                raise
        if session is None or agent_id is None:
            raise RuntimeError("Agora agent did not return a runtime ID")
        self._sessions[agent_id] = session
        logger.info("Started Agora agent %s in channel %s", agent_id, channel_name)
        return {
            "agent_id": agent_id,
            "channel_name": channel_name,
            "status": "started",
            "panelist_id": panelist_id,
        }

    async def start_panel(
        self,
        *,
        channel_name: str,
        user_uid: int,
        participants: list[dict[str, Any]],
        panel: list[dict[str, Any]],
        instructions: str,
        roundcraft_session_id: str,
        output_audio_codec: str | None = None,
    ) -> list[dict[str, Any]]:
        panelist_ids = {str(item["id"]) for item in panel}
        participant_ids = {str(item["panelist_id"]) for item in participants}
        if not 2 <= len(participants) <= 5 or panelist_ids != participant_ids:
            raise ValueError(
                "Agora panel participants must match two to five configured panelists"
            )

        started: dict[str, Any] | None = None
        try:
            # Logical panelists share one always-listening Agora session. The custom LLM
            # chooses the audible role on every candidate turn and updates MiniMax voice
            # parameters in first-packet metadata.
            started = await self.start(
                channel_name=channel_name,
                agent_uid=int(participants[0]["agent_uid"]),
                user_uid=user_uid,
                output_audio_codec=output_audio_codec,
                instructions=instructions,
                greeting=DEFAULT_GREETING,
                roundcraft_session_id=roundcraft_session_id,
                panelist_id=None,
                manual_turn_control=False,
            )
            return [
                {**started, "panelist_id": str(participant["panelist_id"])}
                for participant in participants
            ]
        except Exception as exc:
            if started and started.get("agent_id"):
                await asyncio.gather(
                    self.stop(str(started["agent_id"])),
                    return_exceptions=True,
                )
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                "Agora panel failed to start; the shared agent was rolled back",
            ) from exc

    @staticmethod
    def _unique_agent_ids(agent_ids: list[str]) -> list[str]:
        return list(
            dict.fromkeys(
                agent_id.strip() for agent_id in agent_ids if agent_id.strip()
            )
        )

    async def stop_panel(self, agent_ids: list[str]) -> None:
        unique_agent_ids = self._unique_agent_ids(agent_ids)
        results = await asyncio.gather(
            *(self.stop(agent_id) for agent_id in unique_agent_ids),
            return_exceptions=True,
        )
        if any(isinstance(item, BaseException) for item in results):
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                "One or more Agora panel agents could not be stopped",
            )

    async def dispatch_turn(
        self,
        agent_id: str,
        candidate_text: str,
        panelist_id: str,
        *,
        channel_name: str | None = None,
        agent_uid: int | None = None,
    ) -> str:
        session = self._sessions.get(agent_id)
        options = {
            "text": candidate_text,
            "on_listening_action": "interrupt",
            "on_thinking_action": "interrupt",
            "on_speaking_action": "interrupt",
            "interruptable": True,
            "metadata": {"roundcraft_panelist_id": panelist_id},
        }
        if session is not None:
            await session.think(**options)
            return "think_injected"

        client = self._require_client()
        agent_management = getattr(client, "agent_management", None)
        if agent_management is None:
            return "client_manual_required"
        token = generate_convo_ai_token(
            app_id=self.settings.agora_app_id,
            app_certificate=self.settings.agora_app_certificate,
            channel_name=channel_name or "think",
            uid=agent_uid or 0,
        )
        await agent_management.agent_think(
            self.settings.agora_app_id,
            agent_id,
            **options,
            request_options={
                "additional_headers": {"Authorization": f"agora token={token}"}
            },
        )
        return "think_injected"

    async def interrupt(self, agent_id: str) -> None:
        client = self._require_client()
        session = self._sessions.get(agent_id)
        if session is not None:
            try:
                await session.interrupt()
                return
            except Exception:
                logger.warning(
                    "Session interrupt failed, using stateless Agora interrupt",
                    exc_info=True,
                )
        token = generate_convo_ai_token(
            app_id=self.settings.agora_app_id,
            app_certificate=self.settings.agora_app_certificate,
            channel_name="interrupt",
            uid=0,
        )
        await client.agents.interrupt(
            self.settings.agora_app_id,
            agent_id,
            request_options={
                "additional_headers": {"Authorization": f"agora token={token}"}
            },
        )

    async def interrupt_panel(self, agent_ids: list[str]) -> None:
        unique_agent_ids = self._unique_agent_ids(agent_ids)
        results = await asyncio.gather(
            *(self.interrupt(agent_id) for agent_id in unique_agent_ids),
            return_exceptions=True,
        )
        if any(isinstance(item, BaseException) for item in results):
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, "Agora panel interruption failed"
            )

    async def stop(self, agent_id: str) -> None:
        client = self._require_client()
        if not agent_id.strip():
            raise ValueError("agent_id is required")
        session = self._sessions.pop(agent_id, None)
        if session is not None:
            try:
                await session.stop()
                return
            except Exception:
                logger.warning(
                    "Session stop failed, using stateless Agora stop", exc_info=True
                )
        await client.stop_agent(agent_id)


@lru_cache
def _service() -> AgoraAgentService:
    return AgoraAgentService(get_settings())


def get_agora_service() -> AgoraAgentService:
    return _service()


AgoraDep = Annotated[AgoraAgentService, Depends(get_agora_service)]
