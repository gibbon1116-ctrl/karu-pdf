/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/karu-pdf/',
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'esnext' },
  optimizeDeps: { exclude: ['mupdf'] },
  test: { include: ['tests/**/*.test.ts'] },
})
