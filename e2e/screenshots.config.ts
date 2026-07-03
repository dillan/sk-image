import { defineConfig, devices } from '@playwright/test';

// Documentation screenshots — deterministic geometry, retina-crisp text, Chromium only.
// Targets the already-running Docker stack via SIGNALK_URL (see capture.sh).
export default defineConfig({
  testDir: './screenshots',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.SIGNALK_URL || 'http://localhost:3000',
    actionTimeout: 15_000,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'docs', use: {} }],
});
