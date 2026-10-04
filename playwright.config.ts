import { defineConfig } from '@playwright/test'

const fixedOnly = process.argv.includes('--project=fixed') || (process.argv.includes('--project') && process.argv[process.argv.indexOf('--project') + 1] === 'fixed')
const singleOnly = process.argv.includes('--project=single') || (process.argv.includes('--project') && process.argv[process.argv.indexOf('--project') + 1] === 'single')
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
  // On GitHub Actions, also report failures as annotations: the job log needs
  // a signed-in admin, but annotations can be read through the public API.
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    actionTimeout: 30_000,
    baseURL: 'http://127.0.0.1:4173',
    channel: process.env.PLAYWRIGHT_CHANNEL === 'chromium' ? undefined : 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: singleOnly ? undefined : fixedOnly ? fixedServer : pagesServer,
  projects: [
    { name: 'e2e', testMatch: /(?:smoke|annotate)\.spec\.ts/, outputDir: 'test-results/e2e' },
    { name: 'single', testMatch: /single-.*\.spec\.ts/, outputDir: 'test-results/single', timeout: 120_000, use: { serviceWorkers: 'block' } },
    { name: 'fixed', testMatch: /fixed-.*\.spec\.ts/, outputDir: 'test-results/fixed', timeout: 120_000, use: { baseURL: 'http://127.0.0.1:4174', serviceWorkers: 'allow' } },
    { name: 'bench', testMatch: /(?:perf|perf-edit|perf-organize)\.spec\.ts/ },
  ],
})
