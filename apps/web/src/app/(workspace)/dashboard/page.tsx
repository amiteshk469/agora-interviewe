import type { Metadata } from "next";
import { WorkspaceRouter } from "@/components/workspace-router";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return <WorkspaceRouter />;
}
