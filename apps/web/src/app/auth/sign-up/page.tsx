import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth-screens";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; audience?: string | string[] }> }) {
  const params = await searchParams;
  const rawAudience = Array.isArray(params.audience) ? params.audience[0] : params.audience;
  return <AuthScreen mode="sign-up" nextPath={Array.isArray(params.next) ? params.next[0] : params.next} initialAudience={rawAudience === "recruiter" ? "recruiter" : "candidate"} />;
}
