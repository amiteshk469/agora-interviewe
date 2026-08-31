import type { Metadata } from "next";
import { ReplayScreen } from "@/components/workspace-screens";

export const metadata: Metadata = { title: "Replay drills" };

export default function ReplayPage() {
  return <ReplayScreen />;
}
