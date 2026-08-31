import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth-screens";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const params = await searchParams;
  return <AuthScreen mode="sign-up" nextPath={Array.isArray(params.next) ? params.next[0] : params.next} />;
}
