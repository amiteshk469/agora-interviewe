import { notFound } from "next/navigation";
import { LiveInterviewScreen } from "@/components/live-interview";
import { AuthScreen, MarketingPage } from "@/components/marketing";
import { LobbyScreen, SetupWizard } from "@/components/setup-wizard";
import { DashboardScreen, HistoryScreen, PromptLibraryScreen, ReplayScreen, ReportScreen, SettingsScreen } from "@/components/workspace-screens";

export function RoundCraft({ screen }: { screen: string }) {
  if (screen.startsWith("reports/")) return <ReportScreen sessionId={screen.slice("reports/".length)} />;
  if (screen.startsWith("replay/")) return <ReplayScreen sessionId={screen.slice("replay/".length)} />;
  switch (screen) {
    case "home": return <MarketingPage />;
    case "auth/sign-in": return <AuthScreen mode="sign-in" />;
    case "auth/sign-up": return <AuthScreen mode="sign-up" />;
    case "dashboard": return <DashboardScreen />;
    case "setup": return <SetupWizard />;
    case "interview/lobby": return <LobbyScreen />;
    case "interview/live": return <LiveInterviewScreen />;
    case "history": return <HistoryScreen />;
    case "replay": return <ReplayScreen />;
    case "prompts": return <PromptLibraryScreen />;
    case "settings": return <SettingsScreen />;
    default: notFound();
  }
}
