import fs from 'node:fs/promises'
import mupdf from 'mupdf'
import { beforeAll, describe, expect, it } from 'vitest'
import { searchPage } from '../src/core/search'
import { StructuredTextCache } from '../src/core/textSelection'
import { TextSelectionQueue } from '../src/editor/textSelectionQueue'
import { ensureSamplePdf } from './fixtures'

let sampleBytes: Uint8Array

beforeAll(async () => {
  sampleBytes = new Uint8Array(await fs.readFile(await ensureSamplePdf()))
})

describe('StructuredTextCache', () => {
  it('文字の範囲から Quad と文字列を返し、LRU の上限を守る', () => {
    const document = new mupdf.PDFDocument(sampleBytes)
    const cache = new StructuredTextCache(document, 1)
    try {
      const page = document.loadPage(2)
      let quad
      try {
        quad = searchPage(page, 2, 'Sample page 3', { caseSensitive: true, normalizeWidth: false }).matches[0].quads[0]
      } finally { page.destroy() }
      const from: [number, number] = [Math.min(quad[0], quad[4]) + 0.5, (quad[1] + quad[5]) / 2]
      const to: [number, number] = [Math.max(quad[2], quad[6]) - 0.5, (quad[3] + quad[7]) / 2]
      const selected = cache.select(2, from, to, 'chars')
      expect(selected.quads.length).toBeGreaterThan(0)
      expect(selected.text).toContain('Sample page 3')
      expect(cache.select(2, from, from, 'words').text).toContain('Sample')
      expect(cache.select(2, from, from, 'lines').text).toContain('Sample page 3')
      expect(cache.pageHasText(0)).toBe(true)
      const lines = cache.pageTextLines(0)
      expect(lines.length).toBeGreaterThan(0)
      expect(lines.some((line) => (
        Math.min(line[0], line[2]) <= Math.min(quad[0], quad[2], quad[4], quad[6])
        && Math.max(line[0], line[2]) >= Math.max(quad[0], quad[2], quad[4], quad[6])
        && Math.min(line[1], line[3]) <= Math.min(quad[1], quad[3], quad[5], quad[7])
        && Math.max(line[1], line[3]) >= Math.max(quad[1], quad[3], quad[5], quad[7])
      ))).toBe(true)
      expect(cache.size).toBe(1)
    } finally {
      cache.destroy()
      document.destroy()
    }
  })

  it('文字のないページを判定する', () => {
    const document = new mupdf.PDFDocument()
    const page = document.addPage([0, 0, 100, 100], 0, {}, '')
    try { document.insertPage(-1, page) } finally { page.destroy() }
    const cache = new StructuredTextCache(document)
    try {
      expect(cache.pageHasText(0)).toBe(false)
      expect(cache.pageTextLines(0)).toEqual([])
    }
    finally { cache.destroy(); document.destroy() }
  })
})

describe('TextSelectionQueue', () => {
  it('応答待ちの間は送らず、次のフレームでは最新の要求だけを送る', async () => {
    const frames: FrameRequestCallback[] = []
    const resolvers: Array<(value: number) => void> = []
    const runs: number[] = []
    const delivered: number[] = []
    const queue = new TextSelectionQueue<number, number>(
      (input) => {
        runs.push(input)
        return new Promise((resolve) => resolvers.push(resolve))
      },
      (callback) => { frames.push(callback); return frames.length },
      () => undefined,
    )
    queue.request(1, (value) => delivered.push(value))
    queue.request(2, (value) => delivered.push(value))
    expect(frames).toHaveLength(1)
    frames.shift()!(0)
    expect(runs).toEqual([2])

    queue.request(3, (value) => delivered.push(value))
    queue.request(4, (value) => delivered.push(value))
    expect(frames).toHaveLength(0)
    resolvers.shift()!(20)
    await Promise.resolve()
    await Promise.resolve()
    expect(delivered).toEqual([20])
    expect(frames).toHaveLength(1)
    frames.shift()!(16)
    expect(runs).toEqual([2, 4])
    resolvers.shift()!(40)
    await Promise.resolve()
    queue.dispose()
  })
})
