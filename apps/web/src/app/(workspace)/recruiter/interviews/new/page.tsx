import type { Metadata } from "next";
import { SetupWizard } from "@/components/setup-wizard";
import { AudienceGate } from "@/components/workspace-router";

export const metadata: Metadata = { title: "Create candidate interview" };

export default function RecruiterInterviewPage() {
  return <AudienceGate audience="recruiter"><SetupWizard initialMode="interviewer_led" modeLocked /></AudienceGate>;
}
