import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset paths so the build works from any host path (and later inside Capacitor).
  base: "./",
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
