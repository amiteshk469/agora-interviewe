export interface PublicEnvironment {
  NEXT_PUBLIC_API_BASE_URL?: string;
  NEXT_PUBLIC_AGORA_APP_ID?: string;
  NEXT_PUBLIC_DEMO_MODE?: string;
}

export interface PublicConfig {
  apiBaseUrl: string;
  agoraAppId: string | null;
  demoMode: boolean;
}

export function createPublicConfig(environment: PublicEnvironment): PublicConfig {
  const demoMode = environment.NEXT_PUBLIC_DEMO_MODE === "true";
  const apiBaseUrl = normalizeHttpUrl(
    environment.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000",
    "NEXT_PUBLIC_API_BASE_URL",
  );
  const agoraAppId = environment.NEXT_PUBLIC_AGORA_APP_ID?.trim() || null;

  if (!demoMode && !agoraAppId) {
    throw new Error("NEXT_PUBLIC_AGORA_APP_ID is required when demo mode is disabled");
  }

  return { apiBaseUrl, agoraAppId, demoMode };
}

function normalizeHttpUrl(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }

  return parsed.toString().replace(/\/$/, "");
}
