import { describe, expect, it } from "vitest";
import { filterAvailableEvidenceLinks, getReportEvidenceLinks } from "@/components/workspace-screens";

describe("report evidence links", () => {
  it("does not invent a linked turn for an empty report", () => {
    expect(getReportEvidenceLinks({
      competencies: [{
        key: "decision_quality",
        label: "Decision quality",
        score: null,
        confidence: 0,
        evidence_turn_ids: [],
        feedback: "Insufficient final transcript evidence.",
      }],
      evidence_map: [],
    })).toEqual([]);
  });

  it("links a cited candidate turn to its real competency feedback", () => {
    expect(getReportEvidenceLinks({
      competencies: [{
        key: "decision_quality",
        label: "Decision quality",
        score: 78,
        confidence: 0.8,
        evidence_turn_ids: ["candidate-turn-2"],
        feedback: "The candidate compared alternatives and named a reversible guardrail.",
      }],
      evidence_map: [{
        competency: "decision_quality",
        transcript_turn_id: "candidate-turn-2",
        excerpt: "I chose the reversible option with a retention guardrail.",
      }],
    })).toEqual([{
      turnId: "candidate-turn-2",
      competencyKey: "decision_quality",
      reason: "The candidate compared alternatives and named a reversible guardrail.",
    }]);
  });

  it("removes citations whose transcript turns are unavailable", () => {
    const links = [
      { turnId: "candidate-turn-2", competencyKey: "decision_quality", reason: "Supported." },
      { turnId: "missing-turn", competencyKey: "decision_quality", reason: "Not in the transcript." },
    ];

    expect(filterAvailableEvidenceLinks(links, ["candidate-turn-2"])).toEqual([links[0]]);
  });
});
