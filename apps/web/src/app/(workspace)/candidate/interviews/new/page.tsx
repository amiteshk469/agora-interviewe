import type { Metadata } from "next";
import { SetupWizard } from "@/components/setup-wizard";
import { AudienceGate } from "@/components/workspace-router";

export const metadata: Metadata = { title: "Create candidate practice" };

export default function CandidatePracticePage() {
  return <AudienceGate audience="candidate"><SetupWizard initialMode="candidate_practice" modeLocked /></AudienceGate>;
}
