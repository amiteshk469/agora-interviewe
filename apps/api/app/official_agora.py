import logging
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status

from app.core.security import AgoraCompatAccess
from app.schemas import AgoraStartAgentRequest, AgoraStopAgentRequest
from app.services.agora import AgoraDep

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Agora quickstart compatibility"])


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, ValueError):
        return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    logger.exception("Agora route failed", exc_info=exc)
    return HTTPException(status.HTTP_502_BAD_GATEWAY, "Agora operation failed")


@router.get("/get_config")
async def get_config(
    agora: AgoraDep,
    access: AgoraCompatAccess,
    channel: Annotated[str | None, Query(max_length=128)] = None,
    uid: Annotated[int | None, Query()] = None,
) -> dict[str, Any]:
    """Generate the official quickstart Token007 RTC+RTM connection envelope."""
    try:
        return {"code": 0, "data": agora.generate_connection(channel, uid), "msg": "success"}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.post("/startAgent")
async def start_agent(
    request: AgoraStartAgentRequest, agora: AgoraDep, access: AgoraCompatAccess
) -> dict[str, Any]:
    """Start an Agora AgentSession using the official quickstart request shape."""
    try:
        codec = (request.parameters or {}).get("output_audio_codec")
        result = await agora.start(
            channel_name=request.channel_name,
            agent_uid=request.rtc_uid,
            user_uid=request.user_uid,
            output_audio_codec=codec,
        )
        return {"code": 0, "msg": "success", "data": result}
    except Exception as exc:
        raise _http_error(exc) from exc


@router.post("/stopAgent")
async def stop_agent(
    request: AgoraStopAgentRequest, agora: AgoraDep, access: AgoraCompatAccess
) -> dict[str, Any]:
    """Stop an Agora AgentSession, with the SDK stateless fallback preserved."""
    try:
        await agora.stop(request.agent_id)
        return {"code": 0, "msg": "success"}
    except Exception as exc:
        raise _http_error(exc) from exc
