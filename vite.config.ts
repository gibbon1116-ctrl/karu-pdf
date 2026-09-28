/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/karu-pdf/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'かるPDF',
        short_name: 'かるPDF',
        description: 'PDFをパソコンの中だけで編集するアプリ',
        lang: 'ja',
        id: '/karu-pdf/',
        start_url: '/karu-pdf/',
        scope: '/karu-pdf/',
        display: 'standalone',
        theme_color: '#1769aa',
        background_color: '#fafafa',
        icons: [
          { src: '/karu-pdf/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/karu-pdf/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
        file_handlers: [{
          action: '/karu-pdf/',
          accept: { 'application/pdf': ['.pdf'] },
        }],
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,wasm,ttf,png}'],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  worker: { format: 'es' },
  build: { target: 'esnext' },
  optimizeDeps: { exclude: ['mupdf'] },
  test: { include: ['tests/**/*.test.ts'] },
})
