import type { Metadata } from "next";
import { LiveInterviewScreen } from "@/components/live-interview";

export const metadata: Metadata = { title: "Live interview" };

export default function LiveInterviewPage() {
  return <LiveInterviewScreen />;
}
