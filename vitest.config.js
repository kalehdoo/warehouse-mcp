import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Exclude is applied per-script via package.json so the integration script
    // can opt back in. Vitest CLI --exclude is additive; if we put the
    // integration exclude here, --exclude on the CLI cannot override it.
    testTimeout: 10_000,
  },
});
