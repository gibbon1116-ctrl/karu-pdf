import mupdf from 'mupdf'
import { expect, type Page } from '@playwright/test'

export function makeSplitPdf(count: number, width = 600, height = 1000, blue = false): number[] {
  const doc = new mupdf.PDFDocument()
  const font = new mupdf.Font('Helvetica')
  const fontObject = doc.addSimpleFont(font)
  try {
    for (let index = 0; index < count; index++) {
      const color = blue ? '0 0 1' : '1 0 0'
      const obj = doc.addPage([0, 0, width, height], 0, { Font: { F1: fontObject } },
        `${color} rg ${width * .1} ${height * .75} ${width * .2} ${height * .1} re f\n` +
        `0 0 0 rg BT /F1 24 Tf ${width * .1} ${height * .65} Td (${blue ? 'BLUE' : 'RED'} page ${index + 1}) Tj ET`)
      try { doc.insertPage(-1, obj) } finally { obj.destroy() }
    }
    const page = doc.loadPage(0)
    try {
      const annotation = page.createAnnotation('Square')
      try {
        annotation.setRect([width * .4, height * .4, width * .5, height * .5])
        annotation.setColor([0, 1, 0]); annotation.setInteriorColor([0, 1, 0]); annotation.update()
      } finally { annotation.destroy() }
    } finally { page.destroy() }
    const buffer = doc.saveToBuffer('compress')
    try { return Array.from(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally { fontObject.destroy(); font.destroy(); doc.destroy() }
}

export async function openSplitPair(page: Page, leftCount = 5, rightCount = 4, rightWidth = 600, rightHeight = 1000) {
  await page.goto('/karu-pdf/?test=1&workers=4')
  await page.waitForFunction(() => Boolean(window.__karu))
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'left.pdf'), makeSplitPdf(leftCount))
  const leftId = await page.evaluate(() => window.__karu!.listTabs()[0].docId)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, 'right.pdf'), makeSplitPdf(rightCount, rightWidth, rightHeight, true))
  await page.evaluate(id => window.__karu!.activateTab(id), leftId)
  await page.getByRole('button', { name: '表示▼', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: /左右に並べて表示/ }).click()
  await expect(page.getByTestId('right-viewer')).toBeVisible()
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect.poll(() => page.getByTestId('right-viewer').locator('.page-view[data-page-index="0"]').getAttribute('data-sharp')).toBe('true')
}

export async function panePosition(page: Page, side: 'left' | 'right') {
  return page.getByTestId(side === 'left' ? 'viewer' : 'right-viewer').evaluate(el => {
    const anchor = el.scrollTop + el.clientHeight / 3
    const pages = [...el.querySelectorAll<HTMLElement>('.page-empty')]
    const page = pages.reverse().find(p => p.offsetTop <= anchor)!
    return { page: Number(page.textContent), fraction: (anchor - page.offsetTop) / page.offsetHeight,
      widthRatio: page.offsetWidth / (el.clientWidth - 32), top: el.scrollTop, zoom: Number((el as HTMLElement).dataset.zoom) }
  })
}

/** Check source geometry and actual raster pixels, including text size in PDF points. */
export async function checkRaster(page: Page, side: 'left' | 'right', blue: boolean, height = 1000) {
  const viewer = page.getByTestId(side === 'left' ? 'viewer' : 'right-viewer')
  await expect.poll(() => viewer.locator('.page-view[data-page-index="0"]').getAttribute('data-sharp')).toBe('true')
  const result = await viewer.locator('.page-view[data-page-index="0"] .preview-canvas').evaluate((el, pageHeight) => {
    const canvas = el as HTMLCanvasElement, ctx = canvas.getContext('2d')!
    const pixel = (x: number, y: number) => [...ctx.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data].slice(0, 3)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let minY = Infinity, maxY = -Infinity
    for (let y = Math.floor(canvas.height * .29); y < canvas.height * .36; y++) {
      for (let x = Math.floor(canvas.width * .09); x < canvas.width * .5; x++) {
        const i = (y * canvas.width + x) * 4
        if (pixels[i] < 80 && pixels[i + 1] < 80 && pixels[i + 2] < 80) { minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
      }
    }
    return { color: pixel(.2, .2), outside: pixel(.32, .2), saved: pixel(.45, .45), textHeightPt: (maxY - minY + 1) * pageHeight / canvas.height }
  }, height)
  expect(result.color).toEqual(blue ? [0, 0, 255] : [255, 0, 0])
  expect(result.outside).toEqual([255, 255, 255])
  expect(result.saved).toEqual([0, 255, 0])
  expect(result.textHeightPt).toBeGreaterThan(14)
  expect(result.textHeightPt).toBeLessThan(28)
}

export async function waitForRightSharp(page: Page) {
  try {
    await expect.poll(() => page.getByTestId('right-viewer').locator('.page-view[data-page-index="0"]').getAttribute('data-sharp')).toBe('true')
  } catch (error) {
    console.error('[split-render-diagnostics]', JSON.stringify(await page.evaluate(() => ({
      panes: [...document.querySelectorAll<HTMLElement>('.viewer')].map(el => ({ docId: el.dataset.docId, zoom: el.dataset.zoom,
        top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight,
        pages: [...el.querySelectorAll<HTMLElement>('.page-view')].map(p => ({ ...p.dataset, width: p.offsetWidth, height: p.offsetHeight,
          canvas: p.querySelector<HTMLCanvasElement>('canvas')?.width })) })),
      requests: (window as Window & { __karuWorkerRenderRequests?: unknown[] }).__karuWorkerRenderRequests?.slice(-30),
    }))))
    throw error
  }
}
