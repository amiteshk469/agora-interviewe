import type { Metadata } from "next";
import { ReportScreen } from "@/components/workspace-screens";

export const metadata: Metadata = { title: "Interview assessment" };

export default async function SessionReportPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <ReportScreen sessionId={sessionId} />;
}
