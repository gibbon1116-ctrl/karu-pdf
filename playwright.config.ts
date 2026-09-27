import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 60 * 1000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/karu-pdf/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: 'e2e', testMatch: /(?:smoke|annotate)\.spec\.ts/ },
    { name: 'bench', testMatch: /(?:perf|perf-edit)\.spec\.ts/ },
  ],
})
