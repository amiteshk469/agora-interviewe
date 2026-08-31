import type { Metadata } from "next";
import { LobbyScreen } from "@/components/setup-wizard";

export const metadata: Metadata = { title: "Interview lobby" };

export default function InterviewLobbyPage() {
  return <LobbyScreen />;
}
