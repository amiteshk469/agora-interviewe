import type { Metadata } from "next";
import { AuthCallbackScreen } from "@/components/auth-screens";

export const metadata: Metadata = { title: "Confirm account" };

export default async function AuthCallbackPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const params = await searchParams;
  return <AuthCallbackScreen nextPath={Array.isArray(params.next) ? params.next[0] : params.next} />;
}
