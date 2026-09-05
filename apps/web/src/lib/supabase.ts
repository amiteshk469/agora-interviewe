import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
      && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
        || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()),
  );
}

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !publishableKey) {
    throw new Error("RoundCraft authentication is not configured for this deployment.");
  }

  browserClient = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      storageKey: "roundcraft.auth",
    },
  });
  return browserClient;
}

export function safeReturnPath(value?: string | null, fallback = "/dashboard") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.startsWith("/auth/")) return fallback;
  return value;
}
