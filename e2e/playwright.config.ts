import { defineConfig } from '@playwright/test';

/**
 * End-to-end API suite for poonsuk-api. In Jenkins (Lab 10) the API image,
 * Postgres, Redis and the mcr.microsoft.com/playwright container share one
 * Kubernetes pod, so the API is reachable as http://127.0.0.1:3000
 * (E2E_BASE_URL). Locally it can run against backend/docker-compose.ci.yml.
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
