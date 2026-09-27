import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const circuitsDir = path.resolve(__dirname, '..', 'circuits');
const webPort = process.env.PLAYWRIGHT_WEB_PORT ?? '3100';
const gatewayPort = process.env.PLAYWRIGHT_GATEWAY_PORT ?? '3101';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: [
    {
      command:
        'cd ../ts && PORT=' +
        gatewayPort +
        ' CIRCUITS_DIR=' +
        circuitsDir +
        ' GATEWAY_SECRET=dev-secret npm run dev',
      url: `http://localhost:${gatewayPort}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        'PORT=' +
        webPort +
        ' GATEWAY_URL=http://localhost:' +
        gatewayPort +
        ' NEXTAUTH_URL=http://localhost:' +
        webPort +
        ' npm run dev',
      url: `http://localhost:${webPort}`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
