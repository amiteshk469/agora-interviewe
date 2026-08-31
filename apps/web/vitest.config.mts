import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

process.env.NEXT_PUBLIC_API_BASE_URL ??= "http://127.0.0.1:8000";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
