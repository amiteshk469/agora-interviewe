import { JoinExperience } from "@/components/join-experience";

export const metadata = {
  title: "Join interview · RoundCraft",
  // An invite link is a bearer credential; keep it out of search indexes.
  robots: { index: false, follow: false },
};

export default async function JoinInterviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <JoinExperience token={token} />;
}
