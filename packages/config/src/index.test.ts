import assert from "node:assert/strict";
import test from "node:test";

import { createPublicConfig, parseEnvFile, validateProductionEnvironment } from "./index.ts";

test("demo configuration allows an absent Agora app ID", () => {
  assert.deepEqual(
    createPublicConfig({
      NEXT_PUBLIC_API_BASE_URL: "https://api.example.com/",
      NEXT_PUBLIC_DEMO_MODE: "true",
    }),
    {
      apiBaseUrl: "https://api.example.com",
      agoraAppId: null,
      demoMode: true,
    },
  );
});

test("live configuration requires an Agora app ID", () => {
  assert.throws(() => createPublicConfig({}), /NEXT_PUBLIC_AGORA_APP_ID/);
});

const productionEnvironment = {
  NEXT_PUBLIC_API_BASE_URL: "https://roundcraft-api.onrender.com",
  NEXT_PUBLIC_AGORA_APP_ID: "0123456789abcdef0123456789abcdef",
  NEXT_PUBLIC_DEMO_MODE: "false",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuvwxyz0123456789",
  AGENT_BACKEND_URL: "https://roundcraft-api.onrender.com/",
};

test("production configuration accepts a shared public Render origin", () => {
  assert.doesNotThrow(() => validateProductionEnvironment(productionEnvironment));
  const { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: _, ...legacyEnvironment } = productionEnvironment;
  assert.doesNotThrow(() => validateProductionEnvironment({
    ...legacyEnvironment,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.signature",
  }));
});

test("production configuration rejects demo mode and non-public API origins", () => {
  assert.throws(
    () => validateProductionEnvironment({ ...productionEnvironment, NEXT_PUBLIC_AGORA_APP_ID: "" }),
    /Missing production variable/,
  );
  assert.throws(
    () => validateProductionEnvironment({ ...productionEnvironment, NEXT_PUBLIC_DEMO_MODE: "true" }),
    /must be false/,
  );
  for (const value of [
    "http://localhost:8000",
    "https://localhost.",
    "https://api.example.com",
    "https://api.example.org",
    "https://example.com.",
    "https://REPLACE_WITH_API_HOST",
    "https://127.0.0.1",
    "https://10.1.2.3",
    "https://192.168.1.2",
    "https://[::1]",
  ]) {
    assert.throws(
      () =>
        validateProductionEnvironment({
          ...productionEnvironment,
          NEXT_PUBLIC_API_BASE_URL: value,
          AGENT_BACKEND_URL: value,
        }),
      /HTTPS|public non-example host|placeholder/,
    );
  }
  assert.throws(
    () =>
      validateProductionEnvironment({
        ...productionEnvironment,
        NEXT_PUBLIC_API_BASE_URL: "https://roundcraft-api.onrender.com/v1",
      }),
    /only the API origin/,
  );
  assert.throws(
    () =>
      validateProductionEnvironment({
        ...productionEnvironment,
        AGENT_BACKEND_URL: "https://other-api.onrender.com",
      }),
    /same origin/,
  );
});

test("production configuration rejects invalid public project identifiers and URLs", () => {
  for (const value of ["production-app-id", "00000000000000000000000000000000", "YOUR_AGORA_APP_ID"]) {
    assert.throws(
      () => validateProductionEnvironment({ ...productionEnvironment, NEXT_PUBLIC_AGORA_APP_ID: value }),
      /Agora App ID|placeholder/,
    );
  }

  for (const value of [
    "http://project.supabase.co",
    "https://example.supabase.test",
    "https://YOUR_PROJECT.supabase.co",
    "https://project.supabase.co/auth/v1",
  ]) {
    assert.throws(
      () => validateProductionEnvironment({ ...productionEnvironment, NEXT_PUBLIC_SUPABASE_URL: value }),
      /HTTPS|public non-example host|placeholder|only the API origin/,
    );
  }
});

test("production configuration never accepts server credentials in browser public keys", () => {
  const unsafeKeys = [
    "sb_secret_abcdefghijklmnopqrstuvwxyz0123456789",
    "gsk_abcdefghijklmnopqrstuvwxyz0123456789",
    "service_role_abcdefghijklmnopqrstuvwxyz",
    "0123456789abcdef0123456789abcdef",
    "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature",
    "YOUR_SUPABASE_KEY",
  ];
  for (const value of unsafeKeys) {
    assert.throws(
      () =>
        validateProductionEnvironment({
          ...productionEnvironment,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: value,
        }),
      /browser-safe|privileged|placeholder/,
    );
  }

  assert.throws(
    () =>
      validateProductionEnvironment({
        ...productionEnvironment,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz0123456789",
      }),
    /browser-safe/,
  );
});

test("Vercel env files parse quoted values without sourcing them", () => {
  assert.deepEqual(parseEnvFile('NEXT_PUBLIC_DEMO_MODE="false"\nAGENT_BACKEND_URL=\'https://api.test.dev\'\n'), {
    NEXT_PUBLIC_DEMO_MODE: "false",
    AGENT_BACKEND_URL: "https://api.test.dev",
  });
});
