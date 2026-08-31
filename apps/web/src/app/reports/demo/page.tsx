import type { Metadata } from "next";
import { ReportScreen } from "@/components/workspace-screens";

export const metadata: Metadata = { title: "Sample evidence report" };

export default function DemoReportPage() {
  return <ReportScreen sessionId="demo" />;
}
