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
    // Off in CI, where nothing uploads the artifact: the workflow has no `upload-artifact` step, so
    // every action was being recorded and then discarded with the runner. Kept locally, where the
    // trace viewer is the reason to have it.
    trace: process.env.CI ? "off" : "retain-on-failure",
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
        // `/editor`, not `/`. `next dev` compiles a route on demand at its first request, and every
        // test in this suite navigates to `/editor`. Waiting on `/` let the run start with that
        // compile still ahead of it, and the workers then raced it: on a sharded CI run the first
        // test took 29.4s against the 6.6s the same test costs warm, the server logged
        // `SyntaxError: Unexpected end of JSON input` for page `/editor`, and the second test hit
        // the 60s timeout. Readiness has to mean the route the tests actually open.
        url: `${baseURL}/editor`,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
