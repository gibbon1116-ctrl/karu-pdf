import { expect, test } from '@playwright/test'
import { DEFAULT_IMAGE_PDF_SETTINGS } from '../src/core/imagePdfLayout'

test('4000×3000 JPEG30枚を標準・元のままで1回ずつ計測', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await expect.poll(() => page.evaluate(() => Boolean(window.__karu))).toBe(true)
  const results = await page.evaluate(async settings => {
    const canvas = document.createElement('canvas'); canvas.width = 4000; canvas.height = 3000
    const ctx = canvas.getContext('2d')!
    // A textured photograph-like workload instead of a tiny solid-color JPEG.
    for (let y = 0; y < 3000; y += 20) for (let x = 0; x < 4000; x += 20) { ctx.fillStyle = `rgb(${(x * 13 + y * 7) % 256},${(x * 3 + y * 17) % 256},${(x * 11 + y * 5) % 256})`; ctx.fillRect(x, y, 20, 20) }
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/jpeg', .92))
    canvas.width = 0; canvas.height = 0
    const files = Array.from({ length: 30 }, (_, i) => new File([blob], `photo-${i}.jpg`, { type: 'image/jpeg' }))
    const results = []
    for (const quality of ['standard', 'original'] as const) {
      const frames: number[] = []; let last = performance.now(), running = true, frameId = 0
      const frame = (now: number) => { frames.push(now - last); last = now; if (running) frameId = requestAnimationFrame(frame) }
      frameId = requestAnimationFrame(frame)
      const start = performance.now()
      try {
        const bytes = await window.__karu!.imagesToPdfToBytes(files, { ...settings, quality })
        const ms = performance.now() - start; frames.sort((a, b) => a - b)
        results.push({ quality, ms, bytes: bytes.length, frameCount: frames.length, frameP95: frames[Math.max(0, Math.ceil(frames.length * .95) - 1)] ?? null })
      } finally { running = false; cancelAnimationFrame(frameId) }
    }
    return results
  }, DEFAULT_IMAGE_PDF_SETTINGS)
  console.log('images-to-pdf performance', JSON.stringify(results))
  await test.info().attach('images-to-pdf-performance.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' })
  expect(results[0].ms).toBeLessThanOrEqual(30000)
  expect(results[0].frameP95).not.toBeNull(); expect(results[0].frameP95!).toBeLessThanOrEqual(20)
})
