import asyncio
import time
from typing import Any
from uuid import UUID

import jwt
import pytest
from fastapi import HTTPException
from httpx import AsyncClient

import app.main as main_module
from app.core.config import Settings
from app.core.database import session_factory
from app.main import DatabaseReleaseNotReady, verify_production_catalog
from app.models import PromptTemplate
from app.services.assessment import StructuredAssessment


def panel(count: int) -> list[dict[str, Any]]:
    return [
        {
            "id": f"panel-{index}",
            "display_name": f"Interviewer {index}",
            "role": "PM Interviewer",
            "expertise": ["product judgment"],
            "voice": "clear-neutral",
            "mood": "professional",
            "behavior": "evidence-seeking",
            "interruption_style": "contextual",
        }
        for index in range(count)
    ]


def test_current_supabase_api_key_aliases() -> None:
    settings = Settings(
        _env_file=None,
        SUPABASE_PUBLISHABLE_KEY="sb_publishable_test",
        SUPABASE_SECRET_KEY="sb_secret_test",
        RENDER_GIT_COMMIT="abcdef0123456789abcdef0123456789abcdef01",
    )
    assert settings.supabase_anon_key == "sb_publishable_test"
    assert settings.supabase_service_role_key == "sb_secret_test"
    assert settings.release_sha == "abcdef0123456789abcdef0123456789abcdef01"


async def test_health_and_product_auth(client: AsyncClient) -> None:
    assert (await client.get("/healthz")).json() == {"status": "ok"}
    assert (await client.get("/health/live")).status_code == 200
    assert (await client.get("/health/ready")).json() == {
        "status": "ready",
        "release_sha": "local",
    }
    assert (await client.get("/v1/tools")).status_code == 401


def production_settings(**overrides: str) -> Settings:
    values = {
        "environment": "production",
        "dev_auth_enabled": False,
        "api_base_url": "https://roundcraft-api.onrender.com",
        "web_base_url": "https://roundcraft.vercel.app",
        "cors_origins": '["https://roundcraft.vercel.app"]',
        "release_sha": "0123456789abcdef0123456789abcdef01234567",
        "database_url": "postgresql+asyncpg://roundcraft:credential@db.project.supabase.co:5432/postgres",
        "agora_app_id": "0123456789abcdef0123456789abcdef",
        "agora_app_certificate": "abcdef0123456789abcdef0123456789",
        "agora_webhook_secret": "webhook-secret-0123456789",
        "agora_custom_llm_url": "https://roundcraft-api.onrender.com/llm/chat/completions",
        "agora_llm_bearer_secret": "bearer-secret-01234567890123456789",
        "supabase_url": "https://project.supabase.co",
        "supabase_service_role_key": "sb_secret_abcdefghijklmnopqrstuvwxyz0123456789",
        "llm_base_url": "https://api.groq.com/openai/v1",
        "llm_api_key": "gsk_abcdefghijklmnopqrstuvwxyz0123456789",
        "llm_model": "qwen/qwen3.8-27b",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_production_settings_accept_complete_release_contract() -> None:
    assert production_settings().environment == "production"
    assert Settings(_env_file=None, environment="test").environment == "test"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("api_base_url", "http://roundcraft-api.onrender.com"),
        ("web_base_url", "https://localhost:3000"),
        ("cors_origins", "*"),
        ("cors_origins", '["https://other.vercel.app"]'),
        ("database_url", "sqlite+aiosqlite:///roundcraft.db"),
        ("database_url", "postgresql+asyncpg://user:credential@YOUR_DB_HOST/postgres"),
        ("release_sha", "not-a-commit"),
        ("agora_app_id", "YOUR_AGORA_APP_ID"),
        ("agora_app_certificate", "replace-with-certificate"),
        ("agora_app_certificate", "00000000000000000000000000000000"),
        ("agora_webhook_secret", "short"),
        ("agora_custom_llm_url", "https://other.onrender.com/llm/chat/completions"),
        ("agora_llm_bearer_secret", "placeholder"),
        ("supabase_url", "http://project.supabase.co"),
        ("supabase_service_role_key", "sb_publishable_not-a-server-key"),
        ("llm_base_url", "https://api.openai.com/v1"),
        ("llm_api_key", "sk_not-a-groq-key-0123456789"),
        ("llm_model", "YOUR_MODEL"),
        ("llm_model", "gpt-4o-mini"),
    ],
)
def test_production_settings_reject_incomplete_or_unsafe_contract(field: str, value: str) -> None:
    with pytest.raises(ValueError):
        production_settings(**{field: value})


class FakeCatalogResult:
    def __init__(self, count: int) -> None:
        self.count = count

    def scalar_one(self) -> int:
        return self.count


class FakeCatalogConnection:
    def __init__(self, count: int) -> None:
        self.count = count

    async def execute(self, _query: object) -> FakeCatalogResult:
        return FakeCatalogResult(self.count)


async def test_production_catalog_readiness_requires_all_builtin_templates() -> None:
    await verify_production_catalog(FakeCatalogConnection(12))  # type: ignore[arg-type]
    with pytest.raises(DatabaseReleaseNotReady):
        await verify_production_catalog(FakeCatalogConnection(11))  # type: ignore[arg-type]


async def test_readiness_rejects_an_incompatible_production_catalog(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def reject_catalog(_connection: object) -> None:
        raise DatabaseReleaseNotReady("catalog missing")

    monkeypatch.setattr(main_module.settings, "environment", "production")
    monkeypatch.setattr(main_module, "verify_production_catalog", reject_catalog)
    response = await client.get("/health/ready")
    assert response.status_code == 503
    assert response.json() == {
        "detail": "Database schema and prompt catalog are not release-ready"
    }


async def test_supabase_hs256_jwt_authentication(client: AsyncClient) -> None:
    token = jwt.encode(
        {
            "sub": "00000000-0000-4000-8000-000000000002",
            "role": "authenticated",
            "aud": "authenticated",
            "iss": "https://test.supabase.co/auth/v1",
            "exp": int(time.time()) + 300,
        },
        "test-supabase-jwt-secret-at-least-32-bytes",
        algorithm="HS256",
    )
    response = await client.get(
        "/v1/tools", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200, response.text


async def test_prompt_templates_are_versioned_by_fork(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = await client.post(
        "/v1/prompt-templates",
        headers=auth_headers,
        json={
            "slug": "my-product-sense",
            "name": "My Product Sense",
            "role": "Product Sense Interviewer",
            "prompt": "Ask adaptive product questions and require concrete evidence for each important claim.",
        },
    )
    assert created.status_code == 201, created.text
    source = created.json()
    forked = await client.post(
        f"/v1/prompt-templates/{source['id']}/fork",
        headers=auth_headers,
        json={"prompt": source["prompt"] + " Increase difficulty after a strong answer."},
    )
    assert forked.status_code == 201, forked.text
    assert forked.json()["parent_id"] == source["id"]
    assert forked.json()["version"] == 2
    duplicate = await client.post(
        "/v1/prompt-templates",
        headers=auth_headers,
        json={
            "slug": "my-product-sense",
            "name": "Duplicate Product Sense",
            "role": "Product Sense Interviewer",
            "prompt": "Ask adaptive product questions and require concrete evidence for each important claim.",
        },
    )
    assert duplicate.status_code == 409
    # No mutable template route is exposed: revisions are created only through a fork.
    assert (await client.patch(f"/v1/prompt-templates/{source['id']}", headers=auth_headers)).status_code == 404


async def test_builtin_prompt_tool_policy_is_listed_forked_and_applied(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    builtin_id = UUID("11000000-0000-4000-8000-000000000002")
    async with session_factory() as db:
        db.add(
            PromptTemplate(
                id=builtin_id,
                slug="pm-product-strategy",
                version=1,
                name="Product Strategy",
                role="Product Strategy Interviewer",
                description="Strategic choices and market structure.",
                prompt=(
                    "Adapt every strategy probe to the latest answer, preserve shared context, and require final "
                    "transcript evidence for assessment claims. Never force a round-robin handoff. "
                    "Never request a human reviewer or escalation."
                ),
                knowledge={
                    "case_type": "Strategy choice case",
                    "domains": ["strategy", "market structure"],
                    "scenario_seeds": [
                        "Choose whether a workflow product should enter a regulated market."
                    ],
                    "scoring_focus": ["product judgment", "leadership"],
                    "rubric": [
                        {
                            "key": "strategic_choice",
                            "label": "Strategic choice",
                            "evidence": "States where to play, how to win, and what not to pursue.",
                            "anchors": {
                                "1": "Lists goals without making a strategic choice.",
                                "3": "Makes a defensible choice with a credible alternative.",
                                "5": "Links a sharp choice to advantage and reversal conditions.",
                            },
                        },
                        {
                            "key": "strategic_measurement",
                            "label": "Strategic measurement",
                            "evidence": "Defines signals that would reinforce or reverse the choice.",
                            "anchors": {
                                "1": "Names no decision-linked measure.",
                                "3": "Defines outcomes and a review point.",
                                "5": "Uses leading signals, decision gates, and stopping rules.",
                            },
                        },
                    ],
                },
                behavior={
                    "mood": "auditor-calm",
                    "style": "contrarian-strategy",
                    "interruption": "minimal-and-targeted",
                    "adaptive_probe": "Ask for the irreversible strategic tradeoff.",
                    "allowed_tools": ["knowledge_search", "web_search", "evidence_bookmark", "replay"],
                    "panel_selection": "non_round_robin",
                    "evidence_policy": "final_transcript_turn_ids_only",
                },
                is_builtin=True,
            )
        )
        await db.commit()

    listed = await client.get("/v1/prompt-templates", headers=auth_headers)
    assert listed.status_code == 200
    assert any(item["id"] == str(builtin_id) and item["is_builtin"] for item in listed.json())

    forked = await client.post(
        f"/v1/prompt-templates/{builtin_id}/fork",
        headers=auth_headers,
        json={"name": "My Strategy Interviewer"},
    )
    assert forked.status_code == 201, forked.text
    assert forked.json()["parent_id"] == str(builtin_id)
    assert forked.json()["behavior"]["panel_selection"] == "non_round_robin"
    assert forked.json()["behavior"]["allowed_tools"] == [
        "knowledge_search",
        "web_search",
    ]

    tools = await client.get("/v1/tools", headers=auth_headers)
    assert tools.status_code == 200
    assert {item["name"] for item in tools.json()} == {
        "knowledge_search",
        "calculator",
        "web_search",
    }

    configured_panel = panel(2)
    configured_panel[0]["role"] = "Product Strategy Interviewer"
    configured_panel[0]["prompt_template_id"] = str(builtin_id)
    config = await client.post(
        "/v1/interview-configs",
        headers=auth_headers,
        json={
            "title": "Strategy tools",
            "panel": configured_panel,
            "enabled_tools": [
                "knowledge_search",
                "calculator",
                "web_search",
            ],
        },
    )
    assert config.status_code == 201, config.text
    resolved = config.json()["panel"][0]
    assert resolved["allowed_tools"] == [
        "knowledge_search",
        "web_search",
    ]
    assert resolved["prompt_template_version"] == 1
    assert resolved["template_knowledge"] == {
        "case_type": "Strategy choice case",
        "domains": ["strategy", "market structure"],
        "scenario_seeds": [
            "Choose whether a workflow product should enter a regulated market."
        ],
        "scoring_focus": ["product judgment", "leadership"],
        "rubric": [
            {
                "key": "strategic_choice",
                "label": "Strategic choice",
                "evidence": "States where to play, how to win, and what not to pursue.",
                "anchors": {
                    "1": "Lists goals without making a strategic choice.",
                    "3": "Makes a defensible choice with a credible alternative.",
                    "5": "Links a sharp choice to advantage and reversal conditions.",
                },
            },
            {
                "key": "strategic_measurement",
                "label": "Strategic measurement",
                "evidence": "Defines signals that would reinforce or reverse the choice.",
                "anchors": {
                    "1": "Names no decision-linked measure.",
                    "3": "Defines outcomes and a review point.",
                    "5": "Uses leading signals, decision gates, and stopping rules.",
                },
            },
        ],
    }
    assert resolved["template_behavior"]["mood"] == "auditor-calm"
    assert resolved["template_behavior"]["style"] == "contrarian-strategy"
    assert resolved["template_behavior"]["interruption"] == "minimal-and-targeted"
    assert (
        resolved["template_behavior"]["adaptive_probe"]
        == "Ask for the irreversible strategic tradeoff."
    )
    assert resolved["template_behavior"]["allowed_tools"] == [
        "knowledge_search",
        "web_search",
    ]
    assert resolved["mood"] == "auditor-calm"
    assert resolved["behavior"] == "contrarian-strategy"
    assert resolved["interruption_style"] == "minimal-and-targeted"
    assert resolved["expertise"] == [
        "product judgment",
        "strategy",
        "market structure",
    ]
    assert [item["key"] for item in resolved["role_rubric"]] == [
        "strategic_choice",
        "strategic_measurement",
    ]

    no_tool_panel = panel(2)
    no_tool_panel[0]["role"] = "Product Strategy Interviewer"
    no_tool_panel[0]["prompt_template_id"] = str(builtin_id)
    no_tool_panel[0]["allowed_tools"] = []
    no_tools = await client.post(
        "/v1/interview-configs",
        headers=auth_headers,
        json={
            "title": "Explicitly tool-free interviewer",
            "panel": no_tool_panel,
            "enabled_tools": ["knowledge_search", "web_search"],
        },
    )
    assert no_tools.status_code == 201, no_tools.text
    assert no_tools.json()["panel"][0]["allowed_tools"] == []

    forbidden_tools = await client.post(
        "/v1/interview-configs",
        headers=auth_headers,
        json={
            "title": "Internal tools are not interviewer tools",
            "enabled_tools": ["knowledge_search", "evidence_bookmark", "replay"],
        },
    )
    assert forbidden_tools.status_code == 422


async def test_prompt_metadata_rejects_human_escalation_claims(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    positive_claim = await client.post(
        "/v1/prompt-templates",
        headers=auth_headers,
        json={
            "slug": "human-review-claim",
            "name": "Unsafe interviewer",
            "role": "Product Interviewer",
            "prompt": "Probe the answer carefully, then request a human reviewer whenever the evidence is uncertain.",
        },
    )
    assert positive_claim.status_code == 422

    unsafe_probe = await client.post(
        "/v1/prompt-templates",
        headers=auth_headers,
        json={
            "slug": "human-escalation-probe",
            "name": "Unsafe adaptive probe",
            "role": "Product Interviewer",
            "prompt": "Ask one focused follow-up grounded in the candidate's latest answer and shared context.",
            "behavior": {
                "adaptive_probe": "Trigger human escalation when the candidate gives an ambiguous answer."
            },
        },
    )
    assert unsafe_probe.status_code == 422


async def test_optional_jd_applies_recommendations_or_defaults(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    jd_text = (
        b"Senior Growth Product Manager\n"
        b"Own retention metrics, funnels, experiments, and strategy.\n"
        + b"Detailed product context. " * 200
    )
    upload = await client.post(
        "/v1/job-descriptions",
        headers=auth_headers,
        files={
            "file": (
                "growth-pm.txt",
                jd_text,
                "text/plain",
            )
        },
    )
    assert upload.status_code == 201, upload.text
    jd = upload.json()
    assert jd["recommendations"]["role_title"] == "Senior Growth Product Manager"
    assert client.fake_storage.uploads  # type: ignore[attr-defined]

    with_jd = await client.post(
        "/v1/interview-configs",
        headers=auth_headers,
        json={"title": "Growth PM", "job_description_id": jd["id"]},
    )
    assert with_jd.status_code == 201, with_jd.text
    assert any(member["id"] == "growth" for member in with_jd.json()["panel"])
    assert with_jd.json()["difficulty"] == "challenging"

    without_jd = await client.post(
        "/v1/interview-configs",
        headers=auth_headers,
        json={"title": "Default PM"},
    )
    assert without_jd.status_code == 201, without_jd.text
    assert len(without_jd.json()["panel"]) == 3


async def test_panel_requires_two_to_five_members(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    for invalid_count in (1, 6):
        response = await client.post(
            "/v1/interview-configs",
            headers=auth_headers,
            json={"title": "Invalid panel", "panel": panel(invalid_count)},
        )
        assert response.status_code == 422
    for valid_count in (2, 5):
        response = await client.post(
            "/v1/interview-configs",
            headers=auth_headers,
            json={"title": "Valid panel", "panel": panel(valid_count)},
        )
        assert response.status_code == 201, response.text


async def test_session_start_turn_evidence_report_and_replay(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    config = (
        await client.post(
            "/v1/interview-configs", headers=auth_headers, json={"title": "Full interview"}
        )
    ).json()
    session_response = await client.post(
        "/v1/sessions", headers=auth_headers, json={"interview_config_id": config["id"]}
    )
    assert session_response.status_code == 201, session_response.text
    session = session_response.json()
    started = await client.post(
        f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={}
    )
    assert started.status_code == 200, started.text
    assert started.json()["connection"]["token"] == "test-token007"
    assert client.fake_agora.started[-1]["roundcraft_session_id"] == session["id"]  # type: ignore[attr-defined]
    renewed = await client.post(f"/v1/sessions/{session['id']}/token", headers=auth_headers)
    assert renewed.status_code == 200, renewed.text
    assert renewed.json()["channel_name"] == started.json()["connection"]["channel_name"]
    assert renewed.json()["uid"] == started.json()["connection"]["uid"]
    assert renewed.json()["agent_uid"] == started.json()["connection"]["agent_uid"]

    turn_ids = []
    turns = [
        (1, "candidate", "I found a customer problem and prioritized it using research."),
        (2, "interviewer", "How did you execute it?"),
        (3, "candidate", "I shipped an experiment and measured the result with metrics."),
    ]
    for sequence, speaker, content in turns:
        response = await client.post(
            f"/v1/sessions/{session['id']}/turns",
            headers=auth_headers,
            json={"sequence": sequence, "speaker_type": speaker, "content": content},
        )
        assert response.status_code == 201, response.text
        turn_ids.append(response.json()["id"])

    for competency, turn_id in (
        ("product_judgment", turn_ids[0]),
        ("execution", turn_ids[2]),
        ("analytics", turn_ids[2]),
    ):
        evidence = await client.post(
            f"/v1/sessions/{session['id']}/evidence",
            headers=auth_headers,
            json={"transcript_turn_id": turn_id, "competency": competency, "note": "Observed"},
        )
        assert evidence.status_code == 201, evidence.text

    ended = await client.post(f"/v1/sessions/{session['id']}/end", headers=auth_headers)
    assert ended.status_code == 200

    async def structured_assessment(*args: Any, **kwargs: Any) -> StructuredAssessment:
        del args, kwargs
        return StructuredAssessment.model_validate(
            {
                "criteria": [
                    {
                        "key": "product_judgment",
                        "score": 78,
                        "confidence": 0.76,
                        "feedback": "The candidate linked prioritization to customer research.",
                        "evidence_turn_ids": [UUID(turn_ids[0])],
                    },
                    {
                        "key": "execution",
                        "score": 72,
                        "confidence": 0.72,
                        "feedback": "The candidate described shipping a bounded experiment.",
                        "evidence_turn_ids": [UUID(turn_ids[2])],
                    },
                    {
                        "key": "analytics",
                        "score": 74,
                        "confidence": 0.73,
                        "feedback": "The candidate cited measurement and experiment results.",
                        "evidence_turn_ids": [UUID(turn_ids[2])],
                    },
                    {
                        "key": "leadership",
                        "score": None,
                        "confidence": 0,
                        "feedback": "No final leadership evidence was provided.",
                        "evidence_turn_ids": [],
                    },
                    {
                        "key": "communication",
                        "score": None,
                        "confidence": 0,
                        "feedback": "No distinct communication evidence was provided.",
                        "evidence_turn_ids": [],
                    },
                ]
            }
        )

    monkeypatch.setattr(
        "app.services.assessment.request_structured_assessment",
        structured_assessment,
    )
    report = await client.post(f"/v1/sessions/{session['id']}/report", headers=auth_headers)
    assert report.status_code == 201, report.text
    body = report.json()
    assert body["readiness"] != "insufficient_evidence"
    assert body["evidence_map"]
    drills = await client.post(
        f"/v1/sessions/{session['id']}/replay-drills", headers=auth_headers
    )
    assert drills.status_code == 201, drills.text
    assert drills.json()


async def test_report_marks_missing_evidence_honestly(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    config = (
        await client.post(
            "/v1/interview-configs", headers=auth_headers, json={"title": "Sparse interview"}
        )
    ).json()
    session = (
        await client.post(
            "/v1/sessions", headers=auth_headers, json={"interview_config_id": config["id"]}
        )
    ).json()
    assert (
        await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    ).status_code == 200
    assert (
        await client.post(f"/v1/sessions/{session['id']}/end", headers=auth_headers)
    ).status_code == 200
    report = await client.post(f"/v1/sessions/{session['id']}/report", headers=auth_headers)
    assert report.status_code == 201, report.text
    assert report.json()["readiness"] == "insufficient_evidence"
    assert all(item["score"] is None for item in report.json()["competencies"])


async def test_failed_agora_start_does_not_leave_session_starting(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    config = (
        await client.post(
            "/v1/interview-configs", headers=auth_headers, json={"title": "Failure test"}
        )
    ).json()
    session = (
        await client.post(
            "/v1/sessions", headers=auth_headers, json={"interview_config_id": config["id"]}
        )
    ).json()

    async def fail_start(**kwargs: Any) -> list[dict[str, Any]]:
        del kwargs
        raise HTTPException(502, "Agora start failed")

    client.fake_agora.start_panel = fail_start  # type: ignore[attr-defined]
    failed = await client.post(
        f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={}
    )
    assert failed.status_code == 502
    stored = await client.get(f"/v1/sessions/{session['id']}", headers=auth_headers)
    assert stored.json()["status"] == "failed"


async def test_concurrent_start_atomically_claims_once(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    config = (
        await client.post(
            "/v1/interview-configs", headers=auth_headers, json={"title": "Race test"}
        )
    ).json()
    session = (
        await client.post(
            "/v1/sessions", headers=auth_headers, json={"interview_config_id": config["id"]}
        )
    ).json()
    results = await asyncio.gather(
        client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={}),
        client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={}),
    )
    assert sorted(response.status_code for response in results) == [200, 409]
    assert len(client.fake_agora.started) == 1  # type: ignore[attr-defined]
