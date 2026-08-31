import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth-screens";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const params = await searchParams;
  return <AuthScreen mode="sign-in" nextPath={Array.isArray(params.next) ? params.next[0] : params.next} />;
}
