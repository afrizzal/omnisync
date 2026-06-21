import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./",
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
  },
  // No webServer — the docker compose stack is started externally by the CI job / demo.sh.
});
