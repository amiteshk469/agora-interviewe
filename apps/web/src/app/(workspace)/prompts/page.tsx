import type { Metadata } from "next";
import { PromptLibraryScreen } from "@/components/workspace-screens";

export const metadata: Metadata = { title: "Prompt library" };

export default function PromptsPage() {
  return <PromptLibraryScreen />;
}
