import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  webServer: [
    {
      command: 'tsx e2e/mock-gateway.ts',
      url: 'http://127.0.0.1:3100/health/live',
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
    },
    {
      command:
        'env NODE_ENV=development DASHBOARD_HOST=127.0.0.1 DASHBOARD_PORT=3101 DASHBOARD_PUBLIC_URL=http://127.0.0.1:3101 GATEWAY_PUBLIC_URL=http://127.0.0.1:3100 node dist/server.js',
      url: 'http://127.0.0.1:3101/health',
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
    },
  ],
  use: {
    baseURL: 'http://127.0.0.1:3101',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  outputDir: 'test-results',
});
