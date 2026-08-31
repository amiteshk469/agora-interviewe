import type { Metadata } from "next";
import { ReplayScreen } from "@/components/workspace-screens";

export const metadata: Metadata = { title: "Replay drill" };

export default async function SessionReplayPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <ReplayScreen sessionId={sessionId} />;
}
