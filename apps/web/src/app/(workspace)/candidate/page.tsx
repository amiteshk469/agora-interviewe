import type { Metadata } from "next";
import { AudienceGate } from "@/components/workspace-router";
import { DashboardScreen } from "@/components/workspace-screens";

export const metadata: Metadata = { title: "Candidate workspace" };

export default function CandidateWorkspacePage() {
  return <AudienceGate audience="candidate"><DashboardScreen audience="candidate" /></AudienceGate>;
}
