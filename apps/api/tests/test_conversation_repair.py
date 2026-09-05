import pytest

from app.custom_llm import _director_continuation
from app.domain import PanelDirector
from app.schemas import PanelistInput, PanelState


@pytest.mark.parametrize("utterance,expected", [
    ("Yes. I am ready to begin the interview.", "introduce yourself"),
    ("I am not able to understand what tradeoff", "Let's simplify"),
    ("I don't know. Can we try another question?", "different question"),
    ("Am I audible?", "received your audio"),
])
def test_social_and_repair_turns_are_not_evidence_probes(utterance: str, expected: str) -> None:
    panel = [PanelistInput(id="one", display_name="Ira", role="technical")]
    result = PanelDirector.choose_next(panel, PanelState(), utterance)
    assert expected in result.suggested_question
    assert "verify that claim" not in result.suggested_question


def test_private_objective_is_not_spoken_as_generic_probe() -> None:
    assert "tradeoff" not in _director_continuation("Ask an adaptive question")
    assert "couldn't complete" in _director_continuation("Ask an adaptive question")
