import type { Metadata } from "next";
import { HistoryScreen } from "@/components/workspace-screens";

export const metadata: Metadata = { title: "Interview history" };

export default function HistoryPage() {
  return <HistoryScreen />;
}
