import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: [path.resolve(__dirname, "tests/setup/env.ts")],
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: path.resolve(__dirname, "coverage"),
      exclude: [
        "**/*.d.ts",
        "**/dist/**",
        "**/node_modules/**",
        "**/.next/**",
        "**/*.config.*",
        "client/**",
        "tests/**",
      ],
    },
  },
});
