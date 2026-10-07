/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { META_CSP } from './scripts/fixed-policy.mjs'
import { sourceSnapshot } from './scripts/source-snapshot.mjs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const fixed = mode === 'fixed'
  const single = mode === 'single'
  const base = fixed ? env.VITE_BASE_PATH : '/karu-pdf/'
  if (!base || !base.startsWith('/') || !base.endsWith('/') || base.includes('//') || /[?#\\%]/.test(base)
    || new URL(base, 'https://base.invalid').pathname !== base) throw new Error('VITE_BASE_PATH must start and end with / and be a normalised local path')
  let gitCommit = 'unknown'
  try { gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { /* Git is optional. */ }
  const snapshot = fixed || single ? sourceSnapshot() : null
  const build = { version: env.VITE_APP_VERSION || '1.0.0-fixed', buildDate: new Date().toISOString(), gitCommit, gitShort: gitCommit.slice(0, 12), base, mode, sourceHash: snapshot?.sourceHash, sourceDirty: snapshot?.sourceDirty }
  const runtimePackages = new Set<string>()
  function distributionPlugin(): Plugin {
    return {
      name: 'distribution-regions', enforce: 'pre',
      transform(code, id) {
        if ((fixed || single) && id.includes('/node_modules/')) {
          const match = id.replaceAll('\\', '/').match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)\//)
          if (match) runtimePackages.add(match[1])
        }
        if (single && id.includes('/node_modules/mupdf/')) code = code.replaceAll('import.meta.url', 'self.location.href')
        if (!id.includes('/src/')) return single ? code : undefined
        // These regions preserve the original pages source exactly; fixed code
        // is selected before TS/JSX compilation in both the app and Workers.
        while (/@(?:fixed|pages|single|server):start/.test(code)) code = code.replace(/(?:\{)?\/\* @(fixed|pages|single|server):start \*\/(?:\})?([\s\S]*?)(?:\{)?\/\* @\1:end \*\/(?:\})?/g,
          (_all, region: string, body: string) => (region === 'server' ? !single : region === 'single' ? single : region === 'fixed' ? fixed : !fixed && !single) ? body : '')
        if (single && id.endsWith('.css')) code = code.replace(/@font-face\s*\{[^}]*\}/g, '')
        if (single) code = code.replace(/new Worker\(new URL\('\.\.\/worker\/(?:pdf|image|symbolSearch)\.worker\.ts', import\.meta\.url\), \{ type: 'module' \}\)/g, 'undefined')
        if (fixed && id.endsWith('.css')) code = code.replaceAll('/karu-pdf/', base)
        return code
      },
      transformIndexHtml(html) {
        if (single) return html.replace(/\s*<link rel="preload"[^>]*\/>/, '')
        if (!fixed) return html
        return html.replace('/karu-pdf/fonts/', `${base}fonts/`).replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${META_CSP}" />\n    <link rel="icon" href="${base}icons/icon-192.png" />`)
      },
    }
  }
  return {
    base,
    // Pages receives no new definitions or emitted metadata.
    define: fixed ? { __FIXED_BUILD__: JSON.stringify(build) } : single ? { __SINGLE_BUILD__: JSON.stringify(build) } : {},
    plugins: [
      distributionPlugin(),
      react(),
      ...(!single ? [VitePWA({
        registerType: 'prompt',
        manifest: {
          name: 'かるPDF', short_name: 'かるPDF', description: 'PDFをパソコンの中だけで編集するアプリ', lang: 'ja',
          id: base, start_url: base, scope: base, display: 'standalone', theme_color: '#1769aa', background_color: '#fafafa',
          icons: [
            { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
            { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          ],
          file_handlers: [{ action: base, accept: { 'application/pdf': ['.pdf'] } }],
        },
        workbox: {
          globPatterns: [fixed ? '**/*.{html,js,css,wasm,ttf,png,webmanifest}' : '**/*.{html,js,css,wasm,ttf,png}'],
          maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
          cleanupOutdatedCaches: true,
        },
      })] : []),
      ...(single ? [{ name: 'single-build-metadata', closeBundle() {
        writeFileSync('dist-single/build-info.json', JSON.stringify({ ...build, sourceFiles: snapshot?.sourceFiles, runtimePackages: [...runtimePackages].sort() }, null, 2) + '\n')
      } } satisfies Plugin] : []),
      ...(fixed ? [{
        name: 'fixed-build-metadata',
        closeBundle() {
          // Workbox's generated runtime imports these modules (not its build tools).
          for (const name of ['workbox-core', 'workbox-precaching', 'workbox-routing', 'workbox-strategies']) runtimePackages.add(name)
          writeFileSync('dist-fixed/build-info.json', JSON.stringify({ ...build, sourceFiles: snapshot?.sourceFiles, runtimePackages: [...runtimePackages].sort() }, null, 2) + '\n')
        },
      } satisfies Plugin] : []),
    ],
    worker: { format: 'es', plugins: () => [distributionPlugin()] },
    build: { target: 'esnext', ...(fixed ? { outDir: 'dist-fixed' } : single ? { outDir: 'dist-single', copyPublicDir: false, modulePreload: false, rolldownOptions: { output: { codeSplitting: false } } } : {}) },
    optimizeDeps: { exclude: ['mupdf'] },
    test: { include: ['tests/**/*.test.ts'] },
  }
})
