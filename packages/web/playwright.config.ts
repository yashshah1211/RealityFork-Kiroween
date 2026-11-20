import { defineConfig, devices } from "@playwright/test";

const PORT = 5179;
/** RF_E2E_PROD=1 runs the same journeys against the production build (`npm run build` first): node dist-server/prod.js. */
const PROD = process.env.RF_E2E_PROD === "1";

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1280, height: 900 }, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
  webServer: {
    command: PROD ? "node dist-server/prod.js" : `npx vite --port ${PORT} --strictPort`,
    ...(PROD ? { env: { PORT: String(PORT), HOST: "localhost" } } : {}),
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
