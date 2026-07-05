import { defineConfig } from '@playwright/test';

// Authorization matrix against a SECURED Signal K server (the `signalk-secured` compose service).
// API-only (no browser). Pins the plugin's two-mount access model under security: the /plugins/*
// alias is admin-only (server-gated), while /signalk/v1/api/sk-image is crew-reachable and gated by
// the plugin's own auth. See e2e/README.md for how to run it.
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
