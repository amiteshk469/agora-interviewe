import { AuthGate } from "@/components/auth-gate";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
