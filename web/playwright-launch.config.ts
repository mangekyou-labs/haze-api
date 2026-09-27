import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'retain-except-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command:
        'cd ../ts && CIRCUITS_DIR=../circuits PORT=$PORT GATEWAY_SECRET=dev-secret GATEWAY_SECRET_KEY=dev-gateway-key EVALUATION_HMAC_SECRET=dev-evaluation-hmac DATABASE_URL=file:./tmp/playwright-launch.db EVALUATION_STORE=memory npm run dev',
      env: { PORT: '3101' },
      url: 'http://localhost:3101/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        'cd ../web && CIRCUITS_DIR=../circuits PORT=$WEB_PORT GATEWAY_URL=http://localhost:3101 NEXTAUTH_URL=http://localhost:$WEB_PORT GATEWAY_SECRET=dev-secret STRIPE_SECRET_KEY= DISCOUNT_BONUS_PERCENT=10 EVALUATION_HMAC_SECRET=dev-evaluation-hmac DATABASE_URL=file:./tmp/playwright-launch.db EVALUATION_STORE=memory npm run dev',
      env: { PORT: '3100', WEB_PORT: '3100' },
      url: 'http://localhost:3100',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
