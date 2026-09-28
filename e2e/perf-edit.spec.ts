import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'

interface EditResult {
  source: string
  page: number
  drag: { samples: number; p95: number; max: number }
  input: { samples: number; p95: number; max: number }
}

const heavy = path.resolve('test-data/heavy-300p.pdf')
const real = path.resolve('test-data/real/七ヶ浜町_実施設計図.pdf')

async function isolatedPage(browser: Browser): Promise<{ page: Page; close(): Promise<void> }> {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  return { page, close: () => context.close() }
}

async function renderDiagnostics(page: Page, label: string): Promise<void> {
  const state = await page.evaluate(async () => {
    const viewer = document.querySelector<HTMLElement>('[data-testid="viewer"]')
    const viewerRect = viewer?.getBoundingClientRect()
    const visiblePages = [...document.querySelectorAll<HTMLElement>('.page-view')].filter((element) => {
      const rect = element.getBoundingClientRect()
      return Boolean(viewerRect && rect.bottom > viewerRect.top && rect.top < viewerRect.bottom)
    }).map((element) => ({
      page: Number(element.dataset.pageIndex) + 1,
      sharp: element.dataset.sharp,
      visible: element.dataset.visible,
      zoomStable: element.dataset.zoomStable,
      usesDetail: element.dataset.usesDetail,
      detailStage: element.dataset.detailStage,
      detailKey: element.querySelector<HTMLElement>('.detail-canvas')?.dataset.detailKey ?? null,
    }))
    const requests = ((window as Window & { __karuRenderRequests?: unknown[] }).__karuRenderRequests ?? []).slice(-80)
    return {
      scroll: viewer ? { left: viewer.scrollLeft, top: viewer.scrollTop } : null,
      zoomText: document.querySelector('.zoom-output')?.textContent ?? null,
      visiblePages,
      unsharpPages: visiblePages.filter((item) => item.sharp !== 'true').map((item) => item.page),
      requests,
      workers: await Promise.race([
        window.__karu?.getWorkerStats(),
        new Promise((resolve) => window.setTimeout(() => resolve({ timedOut: true }), 2_000)),
      ]),
    }
  })
  console.error(`[render-diagnostics] ${label}`, JSON.stringify(state))
}

async function waitSharp(page: Page, label: string): Promise<void> {
  try {
    await expect.poll(() => page.evaluate(() => window.__karu!.isSharp()), { timeout: 180_000 }).toBe(true)
  } catch (error) {
    await renderDiagnostics(page, label)
    throw error
  }
}

async function measureEditing(page: Page, pdf: string, pageIndex: number, source: string): Promise<EditResult> {
  await page.goto('/karu-pdf/?test=1&workers=3')
  await page.getByTestId('file-input').setInputFiles(pdf)
  await expect(page.locator('.page-view[data-page-index="0"]')).toBeVisible({ timeout: 180_000 })
  await page.evaluate((index) => window.__karu!.scrollToPage(index), pageIndex)
  await expect(page.locator(`.page-view[data-page-index="${pageIndex}"]`)).toBeVisible({ timeout: 180_000 })
  await page.evaluate(() => window.__karu!.setZoom(4))
  await page.waitForTimeout(350)
  await page.evaluate((index) => window.__karu!.scrollToPage(index), pageIndex)
  await waitSharp(page, `${source} p${pageIndex + 1}`)

  const layer = page.getByTestId(`annotation-layer-${pageIndex}`)
  const box = await layer.boundingBox()
  const viewerBox = await page.getByTestId('viewer').boundingBox()
  if (!box) throw new Error(`${source} の対象ページが表示されていません。`)
  if (!viewerBox) throw new Error('PDF表示領域がありません。')
  const startX = Math.max(viewerBox.x + 80, Math.min(viewerBox.x + viewerBox.width - 260, box.x + 180))
  const startY = Math.max(viewerBox.y + 90, Math.min(viewerBox.y + viewerBox.height - 220, box.y + 160))

  await page.getByRole('button', { name: '四角', exact: true }).click()
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  for (let step = 1; step <= 120; step += 1) {
    await page.mouse.move(startX + step * 1.2, startY + step * 0.65)
    await page.waitForTimeout(1000 / 60)
  }
  await page.mouse.up()

  await page.getByRole('button', { name: '文字', exact: true }).click()
  await page.mouse.click(startX, Math.min(viewerBox.y + viewerBox.height - 100, box.y + box.height - 20, startY + 140))
  await expect(page.getByTestId('text-editor')).toBeVisible()
  const characters = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん１２３４５'
  for (const character of [...characters].slice(0, 50)) {
    await page.keyboard.insertText(character)
    await page.waitForTimeout(30)
  }
  await page.waitForTimeout(100)
  const stats = await page.evaluate(() => window.__karu!.getFrameStats())
  await page.keyboard.press('Control+Enter')

  const result: EditResult = { source, page: pageIndex + 1, drag: stats.drag, input: stats.input }
  console.log(`[perf-edit] ${source} p${pageIndex + 1}`, JSON.stringify(result))
  expect(result.drag.samples).toBeGreaterThan(30)
  expect(result.input.samples).toBe(50)
  expect(result.drag.p95).toBeLessThanOrEqual(20)
  expect(result.drag.max).toBeLessThanOrEqual(50)
  expect(result.input.p95).toBeLessThanOrEqual(50)
  return result
}

test('書き込み操作のフレーム時間を計測する', async ({ browser }) => {
  await fs.access(heavy)
  const results: EditResult[] = []
  const heavyRun = await isolatedPage(browser)
  try {
    results.push(await measureEditing(heavyRun.page, heavy, 5, 'heavy-300p.pdf A1'))
  } finally {
    await heavyRun.close()
  }
  try {
    await fs.access(real)
    const realRun = await isolatedPage(browser)
    try {
      results.push(await measureEditing(realRun.page, real, 11, '七ヶ浜町_実施設計図.pdf'))
    } finally {
      await realRun.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    console.log('[perf-edit] 実施設計図がないため p12 の計測をスキップしました。')
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const output = {
    timestamp,
    hardware: { cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, totalMemoryBytes: os.totalmem() },
    results,
  }
  await fs.mkdir('bench-results', { recursive: true })
  await fs.writeFile(`bench-results/perf-edit-${timestamp}.json`, JSON.stringify(output, null, 2))
})
