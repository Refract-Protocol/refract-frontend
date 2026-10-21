import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // tsconfig uses `jsx: preserve` for Next; tests need JSX compiled.
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["src/**/*.test.ts"] },
});
