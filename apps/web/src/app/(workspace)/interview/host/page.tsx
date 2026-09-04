import type { Metadata } from "next";
import { InterviewerRoomScreen } from "@/components/interviewer-room";

export const metadata: Metadata = { title: "Interviewer room" };

export default function InterviewerRoomPage() {
  return <InterviewerRoomScreen />;
}
