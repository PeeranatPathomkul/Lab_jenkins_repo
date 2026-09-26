import { defineConfig } from '@playwright/test';

/**
 * End-to-end API suite for poonsuk-api. In Jenkins the API runs from
 * backend/docker-compose.yml + docker-compose.ci.yml and these tests run in the
 * mcr.microsoft.com/playwright container on the same compose network, so the
 * API is reachable as http://api:3000.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  // The specs share one database (seeded demo users/rooms), so run them in order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    ['junit', { outputFile: 'results/junit.xml' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    extraHTTPHeaders: { Accept: 'application/json' },
  },
});
