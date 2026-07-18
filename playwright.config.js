'use strict';

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test/playwright',
  timeout: 20_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    // Keep API calls going to the real dev server (started externally via `npm run dev`)
    headless: true,
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // No webServer block — tests run against `npm run dev` (already running).
  // Gate: RUN_PLAYWRIGHT=1 enforced inside the spec with test.skip().
});
