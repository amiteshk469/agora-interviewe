import type { Metadata } from "next";
import { SetupWizard, type InterviewMode } from "@/components/setup-wizard";

export const metadata: Metadata = { title: "Build your panel" };

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  const initialMode: InterviewMode = mode === "interviewer_led" ? "interviewer_led" : "candidate_practice";
  return <SetupWizard initialMode={initialMode} />;
}
