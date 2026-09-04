import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    pool: "forks",
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "server"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      exclude: [
        "node_modules/**",
        ".next/**",
        "server/**",
        "src/__tests__/**",
        "**/*.d.ts",
        "**/*.config.{ts,js}",
        "**/types/**",
      ],
    },
    // `html` wrote a 1.1MB report to html/ on every local and CI run and nothing ever read it.
    // `npx vitest run --reporter=html` still produces one on demand.
    reporters: ["default"],
    testTimeout: 10000,
    onConsoleLog(log, type) {
      if (type === "stderr" && /^\[ERROR\] \[(Store:File|Chat)\]/.test(log)) {
        return false;
      }
      return true;
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
