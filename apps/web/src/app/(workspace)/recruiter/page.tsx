import type { Metadata } from "next";
import { AudienceGate } from "@/components/workspace-router";
import { DashboardScreen } from "@/components/workspace-screens";

export const metadata: Metadata = { title: "Recruiter workspace" };

export default function RecruiterWorkspacePage() {
  return <AudienceGate audience="recruiter"><DashboardScreen audience="recruiter" /></AudienceGate>;
}
