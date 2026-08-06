import { defineConfig, devices } from '@playwright/test';

// Self-contained browser smoke: builds the web app, serves it with `next
// start`, and asserts the landing page renders. Used by CI (M3.5) and locally.
// The hosted E2E (M4.1) exercises the full sign-in -> buy -> LLM-call flow
// against the deployed URLs and is gated on M3.2/3.3/3.4.
//
// E2E_PORT overrides the port when local dev servers occupy 3000 (e.g.
// `E2E_PORT=3210 npm run test:e2e`).
const PORT = Number(process.env.E2E_PORT || 3000);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // AUTH_URL makes next-auth trust the local host so the session endpoint
    // responds normally during the smoke (otherwise harmless UntrustedHost
    // errors spam the server log). AUTH_SECRET is required by next-auth v5
    // in production mode (`next start`); without it every page 500s with
    // MissingSecret. This value is test-only configuration, not a credential.
    command: `npm run build && AUTH_URL=http://127.0.0.1:${PORT} AUTH_SECRET=stellar-launch-e2e-test-secret-not-for-production ENABLE_DEV_LOGIN=1 npm run start -- -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});