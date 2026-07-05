import { defineConfig } from '@playwright/test';

// Authorization matrix against a SECURED Signal K server (the `signalk-secured` compose service).
// API-only (no browser). Pins the real behaviour: signalk-server admin-gates ALL /plugins/* routes,
// so the sk-image REST API is admin-only under security. See e2e/README.md for how to run it.
export default defineConfig({
  testDir: './auth',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.SIGNALK_SECURED_URL || 'http://localhost:3008',
  },
});
