import { defineConfig } from '@playwright/test'

const fixedOnly = process.argv.includes('--project=fixed') || (process.argv.includes('--project') && process.argv[process.argv.indexOf('--project') + 1] === 'fixed')
const pagesServer = {
  command: 'npm run preview -- --host 127.0.0.1 --port 4173',
  url: 'http://127.0.0.1:4173/karu-pdf/', reuseExistingServer: true, timeout: 120_000,
}
const fixedServer = {
  command: 'node scripts/serve-fixed.mjs', url: 'http://127.0.0.1:4174/karu-pdf/',
  reuseExistingServer: false, timeout: 120_000,
}
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
  webServer: fixedOnly ? fixedServer : pagesServer,
  projects: [
    { name: 'e2e', testMatch: /(?:smoke|annotate)\.spec\.ts/ },
    { name: 'fixed', testMatch: /fixed-.*\.spec\.ts/, outputDir: 'test-results/fixed', timeout: 120_000, use: { baseURL: 'http://127.0.0.1:4174', serviceWorkers: 'allow' } },
    { name: 'bench', testMatch: /(?:perf|perf-edit|perf-organize)\.spec\.ts/ },
  ],
})
