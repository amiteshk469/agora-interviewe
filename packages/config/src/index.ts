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

const PRODUCTION_KEYS = [
  "NEXT_PUBLIC_API_BASE_URL",
  "NEXT_PUBLIC_AGORA_APP_ID",
  "NEXT_PUBLIC_DEMO_MODE",
  "NEXT_PUBLIC_SUPABASE_URL",
  "AGENT_BACKEND_URL",
] as const;

export function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const sourceLine of contents.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    result[key] = unquote(rawValue.trim(), key);
  }
  return result;
}

export function validateProductionEnvironment(environment: Record<string, string | undefined>): void {
  for (const key of PRODUCTION_KEYS) {
    if (!environment[key]?.trim()) throw new Error(`Missing production variable: ${key}`);
  }
  if (!environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() && !environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()) {
    throw new Error("Missing production variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }

  if (environment.NEXT_PUBLIC_DEMO_MODE?.trim().toLowerCase() !== "false") {
    throw new Error("NEXT_PUBLIC_DEMO_MODE must be false in Production");
  }

  const publicApi = productionOriginUrl(environment.NEXT_PUBLIC_API_BASE_URL!, "NEXT_PUBLIC_API_BASE_URL");
  const serverApi = productionOriginUrl(environment.AGENT_BACKEND_URL!, "AGENT_BACKEND_URL");
  if (publicApi.origin !== serverApi.origin) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL and AGENT_BACKEND_URL must use the same origin");
  }

  productionOriginUrl(environment.NEXT_PUBLIC_SUPABASE_URL!, "NEXT_PUBLIC_SUPABASE_URL");

  const agoraAppId = environment.NEXT_PUBLIC_AGORA_APP_ID!.trim();
  if (!/^[a-f0-9]{32}$/i.test(agoraAppId) || /^0{32}$/.test(agoraAppId)) {
    throw new Error("NEXT_PUBLIC_AGORA_APP_ID must be a valid 32-character Agora App ID");
  }

  for (const key of ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const) {
    const value = environment[key]?.trim();
    if (value) validateBrowserPublicKey(value, key);
  }
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

function productionOriginUrl(value: string, name: string): URL {
  if (containsPlaceholder(value)) {
    throw new Error(`${name} contains a placeholder`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL`);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const nonPublic =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "::" ||
    /^127(?:\.\d{1,3}){0,3}$/.test(hostname) ||
    isPrivateIpAddress(hostname);
  const example =
    /(?:^|\.)example\.(?:com|net|org)$/.test(hostname) ||
    hostname.endsWith(".example") ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".test");

  if (parsed.protocol !== "https:") throw new Error(`${name} must use HTTPS in Production`);
  if (nonPublic || example) throw new Error(`${name} must use a public non-example host`);
  if (parsed.username || parsed.password) throw new Error(`${name} must not contain credentials`);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`${name} must contain only the API origin, with no path, query, or fragment`);
  }
  return parsed;
}

function validateBrowserPublicKey(value: string, name: string): void {
  if (containsPlaceholder(value)) throw new Error(`${name} contains a placeholder`);

  const obviousServerCredential =
    /^(?:sb_secret_|gsk_|sk[_-]|fc-|akia|bearer\s|postgres(?:ql)?(?:\+[^:]*)?:\/\/)/i.test(value) ||
    /(?:service[_-]?role|supabase[_-]?secret|-----begin [^-]+private key-----)/i.test(value) ||
    /^[a-f0-9]{32}$/i.test(value);
  if (obviousServerCredential) {
    throw new Error(`${name} must contain only a browser-safe Supabase publishable or anon key`);
  }

  if (value.length < 20) {
    throw new Error(`${name} is not a valid Supabase publishable or anon key`);
  }

  const jwtParts = value.split(".");
  if (jwtParts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(jwtParts[1], "base64url").toString("utf8")) as { role?: unknown };
      if (payload.role === "service_role" || payload.role === "supabase_admin") {
        throw new Error(`${name} must not contain a privileged Supabase JWT`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("privileged Supabase JWT")) throw error;
      throw new Error(`${name} is not a valid Supabase publishable or anon key`);
    }
  }
}

function containsPlaceholder(value: string): boolean {
  return /(?:replace[_-]?with|placeholder|change[_-]?me|<[^>]+>|\$\{[^}]+\}|your(?:[_-][a-z0-9]+)*[_-](?:key|url|id|host|project))/i.test(
    value,
  );
}

function isPrivateIpAddress(hostname: string): boolean {
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return true;
    return (
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254)
    );
  }

  return /^(?:f[cd]|fe[89ab])/i.test(hostname);
}

function unquote(value: string, key: string): string {
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      throw new Error(`Invalid quoted value for ${key}`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new Error(`Invalid quoted value for ${key}`);
    return value.slice(1, -1);
  }
  return value;
}
