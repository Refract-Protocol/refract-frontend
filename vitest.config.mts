import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // Exclude test setup and pure type declaration files, but keep
      // src/lib/realtime/testing so coverage reports helpers that tests depend
      // on (#562). Pure test files (*.test.*) are excluded by default.
      exclude: [
        "src/test/**",
        "src/**/*.d.ts",
        "src/**/*.stories.{ts,tsx}",
      ],
    },
  },
});
