import ast
from collections.abc import Callable
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import Settings
from app.schemas import ToolDefinition

DEFINITIONS = [
    ToolDefinition(
        name="knowledge_search",
        description="Search the uploaded JD and interview transcript for grounded context.",
        requires_network=False,
    ),
    ToolDefinition(
        name="calculator",
        description="Evaluate a bounded arithmetic expression for estimations and metric checks.",
        requires_network=False,
    ),
    ToolDefinition(
        name="web_search",
        description="Search an optional configured web provider for current factual context.",
        requires_network=True,
    ),
    ToolDefinition(
        name="evidence_bookmark",
        description="Link a competency assessment to a specific transcript turn.",
        requires_network=False,
    ),
    ToolDefinition(
        name="replay",
        description="Create a focused replay drill from a weak or missing evidence area.",
        requires_network=False,
    ),
]

_BINARY_OPERATORS: dict[type[ast.operator], Callable[[Decimal, Decimal], Decimal]] = {
    ast.Add: lambda left, right: left + right,
    ast.Sub: lambda left, right: left - right,
    ast.Mult: lambda left, right: left * right,
    ast.Div: lambda left, right: left / right,
    ast.FloorDiv: lambda left, right: left // right,
    ast.Mod: lambda left, right: left % right,
    ast.Pow: lambda left, right: left**right,
}
_UNARY_OPERATORS: dict[type[ast.unaryop], Callable[[Decimal], Decimal]] = {
    ast.UAdd: lambda value: value,
    ast.USub: lambda value: -value,
}


def calculate(expression: str) -> Decimal:
    if not isinstance(expression, str) or not 1 <= len(expression) <= 160:
        raise ValueError("expression must contain 1 to 160 characters")
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as exc:
        raise ValueError("invalid arithmetic expression") from exc

    def evaluate(node: ast.AST) -> Decimal:
        if isinstance(node, ast.Expression):
            return evaluate(node.body)
        if (
            isinstance(node, ast.Constant)
            and isinstance(node.value, int | float)
            and not isinstance(node.value, bool)
        ):
            return Decimal(str(node.value))
        if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPERATORS:
            return _UNARY_OPERATORS[type(node.op)](evaluate(node.operand))
        if isinstance(node, ast.BinOp) and type(node.op) in _BINARY_OPERATORS:
            left, right = evaluate(node.left), evaluate(node.right)
            if isinstance(node.op, ast.Pow) and (abs(right) > 10 or abs(left) > 1_000_000):
                raise ValueError("exponent is outside the safe range")
            return Decimal(str(_BINARY_OPERATORS[type(node.op)](left, right)))
        raise ValueError("only arithmetic operators and numbers are allowed")

    try:
        result = evaluate(tree)
    except (SyntaxError, InvalidOperation, ZeroDivisionError, OverflowError) as exc:
        raise ValueError("invalid arithmetic expression") from exc
    if not result.is_finite() or abs(result) > Decimal("1e18"):
        raise ValueError("result is outside the safe range")
    return result


async def execute_tool(
    name: str,
    arguments: dict[str, Any],
    corpus: list[dict[str, str]],
    settings: Settings,
) -> dict[str, Any]:
    if name == "calculator":
        result = calculate(str(arguments.get("expression", "")))
        return {"value": str(result.normalize())}
    if name == "knowledge_search":
        query = str(arguments.get("query", "")).strip().lower()
        if not query:
            raise ValueError("query is required")
        terms = set(query.split())
        scored = sorted(
            (
                (sum(term in item["text"].lower() for term in terms), item)
                for item in corpus
            ),
            key=lambda pair: pair[0],
            reverse=True,
        )
        return {
            "matches": [
                {"source": item["source"], "excerpt": item["text"][:1200]}
                for score, item in scored[:5]
                if score > 0
            ]
        }
    if name == "web_search":
        if not settings.web_search_enabled or not settings.web_search_base_url:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Web search is not configured")
        query = str(arguments.get("query", "")).strip()
        if not query:
            raise ValueError("query is required")
        base_url = settings.web_search_base_url.rstrip("/")
        url = f"{base_url}/web/search" if base_url.endswith("/res/v1") else base_url
        headers = {"X-Subscription-Token": settings.web_search_api_key}
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                url,
                params={"q": query, "count": 5, "safesearch": "strict"},
                headers=headers,
            )
            response.raise_for_status()
        items = response.json().get("web", {}).get("results", [])
        return {
            "results": [
                {
                    "title": str(item.get("title", ""))[:300],
                    "url": str(item.get("url", ""))[:2000],
                    "description": str(item.get("description", ""))[:1000],
                    "age": item.get("age"),
                }
                for item in items[:5]
            ]
        }
    if name == "evidence_bookmark":
        return {"action": "bookmark", **arguments}
    if name == "replay":
        return {"action": "replay", **arguments}
    raise ValueError(f"Unknown tool: {name}")
