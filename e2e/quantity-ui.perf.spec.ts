import { expect, test, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance as nodePerformance } from 'node:perf_hooks'
import mupdf from 'mupdf'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { applyEdits } from '../src/core/annotations'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { createFontResource } from '../src/core/fontMetrics'

type PerfCounters = Record<string, {
  count: number
  totalMs: number
  maxMs: number
}>

interface LongTaskSample {
  start: number
  duration: number
}

declare global {
  interface Window {
    __karuPerf?: {
      get(): PerfCounters
      reset(): void
    }
    __perfLastInput?: number
    __perfInputSequence: number
    __perfLongTasks: LongTaskSample[] | null
    __perfLongTaskObserver?: PerformanceObserver
  }
}

interface GroupResult {
  samples: number[]
  median: number
  p95: number
  max: number
  counters: PerfCounters | null
  longTasks: {
    count: number
    totalMs: number
    maxMs: number
  } | null
  heapBefore: number | null
  heapAfter: number | null
}

type Sample = (
  action: () => Promise<void>,
  settled?: () => Promise<void>,
) => Promise<void>

const configurations = {
  S: { F: 100, M: 1_000, P: 10 },
  L: { F: 1_000, M: 10_000, P: 100 },
} as const

type Size = keyof typeof configurations

const requestedSizes = (process.env.KARU_PERF_SIZES ?? 'S,L')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)

if (requestedSizes.length === 0) {
  throw new Error('KARU_PERF_SIZES に S または L を指定してください。')
}

const sizes = [...new Set(requestedSizes.map(value => {
  if (value !== 'S' && value !== 'L') {
    throw new Error(`KARU_PERF_SIZES の構成が不正です: ${value}`)
  }
  return value as Size
}))]

const runs = Number(process.env.KARU_PERF_RUNS ?? '1')
if (!Number.isSafeInteger(runs) || runs < 1) {
  throw new Error('KARU_PERF_RUNS は1以上の整数で指定してください。')
}

const label = process.env.KARU_PERF_LABEL ?? 'run'
const filenameLabel = encodeURIComponent(label)
const viewport = { width: 1600, height: 1400 }
const readyTimeout = 30 * 60_000
const categories = [
  '電灯', 'コンセント', '幹線', '動力', '弱電',
  '火報', '空調', '衛生', '建築', 'その他',
] as const

const fixtureName = (index: number) =>
  `F${String(index).padStart(4, '0')} 項目${index}`

const table = (page: Page) =>
  page.getByRole('region', { name: '数量の集計表', exact: true })

function commitHash(): string | null {
  try {
    return execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null
  } catch {
    return null
  }
}

async function generatePdf(size: Size) {
  const started = nodePerformance.now()
  const { F, M, P } = configurations[size]
  const pdfPath = path.resolve(
    'test-results', 'perf-quantity', `quantity-${size}.pdf`,
  )
  const doc = new mupdf.PDFDocument()
  let font: ReturnType<typeof createFontResource> | undefined

  try {
    const store = new AnnotationStore()
    font = createFontResource(new Uint8Array(
      await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf'),
    ))
    const fixtures: CountFixture[] = Array.from(
      { length: F },
      (_, i): CountFixture => ({
        id: `f${i}`,
        code: `F${String(i).padStart(4, '0')}`,
        name: `項目${i}`,
        category: categories[i % categories.length]!,
        order: i,
        kind: 'count',
        style: nextCountStyle([]),
        ...(i % 10 === 0 ? {
          breakdown: {
            book: '電気設備' as const,
            section: '庁舎',
            subject: '電灯設備',
            middle: '電灯分岐',
            item: '分電盤',
          },
        } : {}),
      }),
    )

    for (let p = 0; p < P; p++) {
      const pdfPage = doc.addPage([0, 0, 500, 600], 0, {}, '')
      try {
        doc.insertPage(-1, pdfPage)
      } finally {
        pdfPage.destroy()
      }
    }

    // Explicitly mark the fixture list as changed so it is saved into the PDF.
    await store.ensureCountFixtures(async () => [], async () => {})
    store.setCountFixtures(fixtures)

    for (let j = 0; j < M; j++) {
      const x = 20 + (j % 40) * 11
      const y = 20 + (Math.floor(j / 40) % 50) * 11
      store.create({
        kind: 'symbol',
        symbol: 'circle',
        pageIndex: (j * 7) % P,
        rect: [x - 5, y - 5, x + 5, y + 5],
        count: {
          version: 2,
          id: `m${j}`,
          fixtureId: `f${j % F}`,
        },
      })
    }

    expect(
      applyEdits(doc, store.toEdits(), { BIZUDGothic: font }).errors,
    ).toEqual([])

    const buffer = doc.saveToBuffer('compress')
    try {
      await fs.mkdir(path.dirname(pdfPath), { recursive: true })
      await fs.writeFile(pdfPath, buffer.asUint8Array())
    } finally {
      buffer.destroy()
    }
  } finally {
    try {
      font?.font.destroy()
    } finally {
      doc.destroy()
    }
  }

  return { pdfPath, generateMs: nodePerformance.now() - started }
}

async function installMeasurement(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('karu-pdf:fixture-panel-settings-open', 'true')
    window.__perfInputSequence = 0

    const record = (event: Event) => {
      window.__perfLastInput = event.timeStamp
      window.__perfInputSequence++
    }
    for (const name of ['pointerdown', 'keydown', 'wheel', 'input']) {
      document.addEventListener(name, record, { capture: true })
    }

    window.__perfLongTasks = null
    if (typeof PerformanceObserver === 'undefined') return

    const supported = PerformanceObserver.supportedEntryTypes
    if (supported && !supported.includes('longtask')) return

    try {
      const observer = new PerformanceObserver(list => {
        window.__perfLongTasks?.push(...list.getEntries().map(entry => ({
          start: entry.startTime,
          duration: entry.duration,
        })))
      })
      window.__perfLongTasks = []
      observer.observe({ type: 'longtask', buffered: true })
      window.__perfLongTaskObserver = observer
    } catch {
      window.__perfLongTasks = null
    }
  })
}

async function measureGroup(
  page: Page,
  expectedSamples: number,
  work: (sample: Sample) => Promise<void>,
): Promise<GroupResult> {
  const before = await page.evaluate(() => {
    window.__karuPerf?.reset()
    // Discard deliveries queued before the group starts.
    window.__perfLongTaskObserver?.takeRecords()
    if (window.__perfLongTasks) window.__perfLongTasks.length = 0
    const memory = (performance as Performance & {
      memory?: { usedJSHeapSize: number }
    }).memory
    return {
      heap: memory?.usedJSHeapSize ?? null,
      sequence: window.__perfInputSequence,
    }
  })

  let sequence = before.sequence
  const samples: number[] = []

  const sample: Sample = async (action, settled) => {
    await action()
    if (settled) await settled()

    const response = await page.evaluate(previousSequence =>
      new Promise<{ ms: number; sequence: number }>(resolve => {
        const measure = () => {
          requestAnimationFrame(() => {
            setTimeout(() => {
              // Wheel dispatch can lag behind Playwright's wheel completion.
              // Wait for this operation's input instead of reusing an old one.
              if (window.__perfInputSequence <= previousSequence
                || window.__perfLastInput === undefined) {
                measure()
                return
              }
              resolve({
                ms: performance.now() - window.__perfLastInput,
                sequence: window.__perfInputSequence,
              })
            }, 0)
          })
        }
        measure()
      }), sequence,
    )

    samples.push(response.ms)
    sequence = response.sequence
  }

  await work(sample)

  const after = await page.evaluate(() => {
    const pending = window.__perfLongTaskObserver?.takeRecords() ?? []
    window.__perfLongTasks?.push(...pending.map(entry => ({
      start: entry.startTime,
      duration: entry.duration,
    })))
    const tasks = window.__perfLongTasks
    const memory = (performance as Performance & {
      memory?: { usedJSHeapSize: number }
    }).memory

    return {
      counters: window.__karuPerf?.get() ?? null,
      longTasks: tasks === null ? null : {
        count: tasks.length,
        totalMs: tasks.reduce((sum, task) => sum + task.duration, 0),
        maxMs: tasks.reduce((max, task) => Math.max(max, task.duration), 0),
      },
      heap: memory?.usedJSHeapSize ?? null,
    }
  })

  expect(samples).toHaveLength(expectedSamples)
  const sorted = [...samples].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!

  return {
    samples,
    median,
    p95: sorted[Math.ceil(0.95 * sorted.length) - 1]!,
    max: sorted[sorted.length - 1]!,
    counters: after.counters,
    longTasks: after.longTasks,
    heapBefore: before.heap,
    heapAfter: after.heap,
  }
}

async function chooseFixture(page: Page, index: number) {
  const button = page.getByTestId('fixture-panel').getByRole('button', {
    name: fixtureName(index),
    exact: true,
  })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', {
    name: '数量拾い',
    exact: true,
  })).toHaveAttribute('aria-pressed', 'true')
}

async function clickPoint(
  page: Page,
  pageIndex: number,
  x: number,
  y: number,
) {
  const layer = page.getByTestId(`annotation-layer-${pageIndex}`)
  const position = await layer.evaluate((element, point) => {
    const svg = element as SVGSVGElement
    const box = svg.getBoundingClientRect()
    return {
      x: point.x * box.width / svg.viewBox.baseVal.width,
      y: point.y * box.height / svg.viewBox.baseVal.height,
    }
  }, { x, y })
  await layer.click({ position })
}

const editableCount = (page: Page) =>
  page.evaluate(() => window.__karu!.getEditableAnnotations(0).length)

test.describe.configure({ mode: 'serial' })

for (const size of sizes) {
  test(`数量画面の操作応答 ${size}`, async ({ browser, baseURL }) => {
    test.setTimeout(30 * 60_000)

    const { F, M, P } = configurations[size]
    // Generate once per configuration; every repetition opens the same PDF.
    const { pdfPath, generateMs } = await generatePdf(size)
    const commit = commitHash()

    for (let run = 1; run <= runs; run++) {
      const context = await browser.newContext({
        baseURL: baseURL ?? 'http://127.0.0.1:4173',
        viewport,
      })

      try {
        const page = await context.newPage()
        await installMeasurement(page)
        await page.goto('/karu-pdf/?test=1&perf=1&workers=3')
        await page.waitForFunction(() => !!window.__karu, undefined, {
          timeout: readyTimeout,
        })

        const openStarted = nodePerformance.now()
        await page.getByTestId('file-input').setInputFiles(pdfPath)
        await expect(page.locator('.page-view[data-page-index="0"]'))
          .toBeVisible({ timeout: readyTimeout })
        await page.getByRole('tab', { name: '数量', exact: true }).click()
        await expect.poll(
          () => page.evaluate(() => window.__karu!.getCountFixtures().length),
          { timeout: readyTimeout },
        ).toBe(F)
        await expect.poll(
          () => page.evaluate(
            () => window.__karu!.getDrawingScanMetrics().scanning,
          ),
          { timeout: readyTimeout },
        ).toBe(false)
        const openMs = nodePerformance.now() - openStarted
        await page.evaluate(() => window.__karu!.setZoom(1))

        const tableStarted = nodePerformance.now()
        await page.getByTestId('fixture-panel').getByRole('button', {
          name: '集計表を開く',
          exact: true,
        }).click()
        await expect(table(page)).toBeVisible({ timeout: readyTimeout })
        const tableOpenMs = nodePerformance.now() - tableStarted

        const selectionCount = Math.min(100, F)
        const select = await measureGroup(page, selectionCount, async sample => {
          const visited = new Set<number>()
          for (let k = 0; k < selectionCount; k++) {
            const index = (k * 7) % F
            expect(visited.has(index)).toBe(false)
            visited.add(index)
            const button = page.getByTestId('fixture-panel').getByRole('button', {
              name: fixtureName(index),
              exact: true,
            })
            await sample(
              () => button.click(),
              async () => {
                await expect(button).toHaveAttribute('aria-pressed', 'true')
                await expect(page.getByRole('button', {
                  name: '数量拾い',
                  exact: true,
                })).toHaveAttribute('aria-pressed', 'true')
              },
            )
          }
        })

        const searchInput = page.getByTestId('fixture-panel').getByLabel(
          '名称・略号で検索', { exact: true },
        )
        await expect(searchInput).toHaveValue('')
        await searchInput.click()
        const search = await measureGroup(page, 30, async sample => {
          for (let repetition = 0; repetition < 5; repetition++) {
            let value = ''
            for (const character of 'F01') {
              value += character
              await sample(
                () => page.keyboard.type(character),
                async () => { await expect(searchInput).toHaveValue(value) },
              )
            }
            for (let n = 0; n < 3; n++) {
              value = value.slice(0, -1)
              await sample(
                () => page.keyboard.press('Backspace'),
                async () => { await expect(searchInput).toHaveValue(value) },
              )
            }
          }
        })

        const scroll = table(page).locator('.quantity-table-scroll')
        await scroll.evaluate(async element => {
          element.scrollTop = 0
          await new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          })
        })
        expect(await scroll.evaluate(
          element => element.scrollHeight > element.clientHeight,
        )).toBe(true)
        const scrollBox = await scroll.boundingBox()
        if (!scrollBox) throw new Error('集計表のスクロール領域がありません。')
        await page.mouse.move(
          scrollBox.x + scrollBox.width / 2,
          scrollBox.y + scrollBox.height / 2,
        )

        const tableScroll = await measureGroup(page, 60, async sample => {
          for (let n = 0; n < 30; n++) {
            await sample(() => page.mouse.wheel(0, 400))
          }
          await expect.poll(
            () => scroll.evaluate(element => element.scrollTop),
          ).toBeGreaterThan(0)
          for (let n = 0; n < 30; n++) {
            await sample(() => page.mouse.wheel(0, -400))
          }
          await expect.poll(
            () => scroll.evaluate(element => element.scrollTop),
          ).toBe(0)
        })

        await chooseFixture(page, 1)
        const layer = page.getByTestId('annotation-layer-0')
        await expect(layer).toBeVisible()
        await layer.scrollIntoViewIfNeeded()
        const beforeAdd = await editableCount(page)
        let expectedCount = beforeAdd

        const addOne = await measureGroup(page, 20, async sample => {
          for (let n = 0; n < 20; n++) {
            expectedCount++
            await sample(
              () => clickPoint(page, 0, 20 + n * 22, 590),
              async () => {
                await expect.poll(() => editableCount(page)).toBe(expectedCount)
              },
            )
          }
        })
        const afterAdd = await editableCount(page)
        expect(afterAdd).toBe(beforeAdd + 20)

        // Ensure shortcuts reach the application rather than an input field.
        await page.evaluate(
          () => (document.activeElement as HTMLElement | null)?.blur(),
        )
        const undo = await measureGroup(page, 20, async sample => {
          for (let n = 0; n < 20; n++) {
            expectedCount--
            await sample(
              () => page.keyboard.press('Control+z'),
              async () => {
                await expect.poll(() => editableCount(page)).toBe(expectedCount)
              },
            )
          }
        })
        expect(await editableCount(page)).toBe(beforeAdd)

        const redo = await measureGroup(page, 20, async sample => {
          for (let n = 0; n < 20; n++) {
            expectedCount++
            await sample(
              () => page.keyboard.press('Control+y'),
              async () => {
                await expect.poll(() => editableCount(page)).toBe(expectedCount)
              },
            )
          }
        })
        expect(await editableCount(page)).toBe(afterAdd)
        await expect(table(page)).toBeVisible()

        const browserEnvironment = await page.evaluate(() => ({
          userAgent: navigator.userAgent,
          hardwareConcurrency: navigator.hardwareConcurrency,
          deviceMemory: (navigator as Navigator & {
            deviceMemory?: number
          }).deviceMemory ?? null,
          devicePixelRatio: window.devicePixelRatio,
        }))
        const timestamp = new Date().toISOString()
        const filenameTimestamp = timestamp.replace(/[:.]/g, '-')
        const result = {
          kind: 'karu-quantity-ui-baseline',
          label,
          timestamp,
          commit,
          size,
          run,
          F,
          M,
          P,
          environment: {
            ...browserEnvironment,
            viewport: page.viewportSize(),
            nodeVersion: process.version,
            os: `${os.type()} ${os.release()}`,
            cpu: os.cpus()[0]?.model ?? null,
          },
          generateMs,
          openMs,
          tableOpenMs,
          groups: {
            select,
            search,
            tableScroll,
            addOne,
            undoRedo: { undo, redo },
          },
        }

        const outputDirectory = path.resolve('bench-results', 'perf-baseline')
        await fs.mkdir(outputDirectory, { recursive: true })
        await fs.writeFile(
          path.join(
            outputDirectory,
            `quantity-ui-${filenameLabel}-${size}-r${run}-${filenameTimestamp}.json`,
          ),
          JSON.stringify(result, null, 2) + '\n',
          'utf8',
        )

        const summary = Object.entries({
          select, search, tableScroll, addOne, undo, redo,
        }).map(([name, group]) =>
          `${name}:n=${group.samples.length},median=${group.median.toFixed(1)},p95=${group.p95.toFixed(1)},max=${group.max.toFixed(1)}`,
        ).join(' ')
        console.log(
          `[perf-quantity] label=${JSON.stringify(label)} size=${size} run=${run}`
          + ` generateMs=${generateMs.toFixed(1)} openMs=${openMs.toFixed(1)}`
          + ` tableOpenMs=${tableOpenMs.toFixed(1)} ${summary}`,
        )
      } finally {
        await context.close()
      }
    }
  })
}
