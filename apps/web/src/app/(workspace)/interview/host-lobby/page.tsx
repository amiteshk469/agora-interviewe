import type { Metadata } from "next";
import { InterviewerLobbyScreen } from "@/components/interviewer-room";

export const metadata: Metadata = { title: "Interviewer lobby" };

export default function InterviewerLobbyPage() {
  return <InterviewerLobbyScreen />;
}
