import assert from "node:assert/strict";
import test from "node:test";

import { createPublicConfig } from "./index.ts";

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
