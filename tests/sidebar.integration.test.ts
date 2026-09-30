import fs from 'node:fs/promises'
import mupdf from 'mupdf'
import { beforeAll, describe, expect, it } from 'vitest'
import { listAnnotations } from '../src/core/annotations'
import { findTextMatchRanges, searchPage } from '../src/core/search'
import { ensureSamplePdf, samplePath } from './fixtures'

beforeAll(async () => { await ensureSamplePdf() })

describe('左の欄の Worker 用処理', () => {
  it('sample-small.pdf の文字をページと Quad 付きで検索する', async () => {
    const document = new mupdf.PDFDocument(await fs.readFile(samplePath))
    try {
      const found = []
      for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
        const page = document.loadPage(pageIndex)
        try { found.push(...searchPage(page, pageIndex, 'Sample page 3', { caseSensitive: true, normalizeWidth: false }).matches) }
        finally { page.destroy() }
      }
      expect(found).toHaveLength(1)
      expect(found[0].pageIndex).toBe(2)
      expect(found[0].quads[0]).toHaveLength(8)

      const page = document.loadPage(2)
      try {
        expect(searchPage(page, 2, 'sample PAGE 3', { caseSensitive: false, normalizeWidth: false }).matches).toHaveLength(1)
        expect(searchPage(page, 2, 'sample PAGE 3', { caseSensitive: true, normalizeWidth: false }).matches).toHaveLength(0)
      } finally { page.destroy() }
    } finally { document.destroy() }
  })

  it('NFKC で全角と半角を同一視する', () => {
    expect(findTextMatchRanges('番号 ＡＢＣ１２３ / ABC123', 'ABC123', { caseSensitive: true, normalizeWidth: true }))
      .toEqual([{ start: 3, end: 9 }, { start: 12, end: 18 }])
    expect(findTextMatchRanges('番号 ＡＢＣ１２３', 'ABC123', { caseSensitive: true, normalizeWidth: false })).toEqual([])
  })

  it('全ページの書き込みをページごとに読み出す', async () => {
    const document = new mupdf.PDFDocument(await fs.readFile(samplePath))
    try {
      const pages = Array.from({ length: document.countPages() }, (_, pageIndex) => ({
        pageIndex,
        annotations: listAnnotations(document, pageIndex),
      }))
      expect(pages).toHaveLength(5)
      expect(pages[0].annotations.length).toBeGreaterThanOrEqual(3)
      expect(pages.slice(1).every((page) => page.annotations.length === 0)).toBe(true)
      expect(pages.flatMap((page) => page.annotations).every((annotation) => annotation.pageIndex === 0)).toBe(true)
    } finally { document.destroy() }
  })
})
