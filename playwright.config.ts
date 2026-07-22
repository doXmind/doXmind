import { defineConfig, devices } from "@playwright/test";

const frontendPort = process.env.PLAYWRIGHT_FRONTEND_PORT ?? "3210";
const backendPort = process.env.PLAYWRIGHT_BACKEND_PORT ?? "8210";
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL ?? `http://127.0.0.1:${frontendPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  reporter: "list",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: externalBaseURL
    ? undefined
    : {
        command: `cross-env DOXMIND_FRONTEND_PORT=${frontendPort} DOXMIND_BACKEND_PORT=${backendPort} npm run dev:all`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
