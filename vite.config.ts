import { defineConfig } from "vitest/config";
import pkg from "./package.json";

export default defineConfig({
  // Relative asset paths so the build works from any host path (and later inside Capacitor).
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
