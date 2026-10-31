import fs from 'node:fs/promises'
import path from 'node:path'
import mupdf, { type PDFDocument } from 'mupdf'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_HEADER_FOOTER_SETTINGS } from '../src/app/headerFooterText'
import { applyHeaderFooter, getHeaderFooterSettings, removeHeaderFooter } from '../src/core/headerFooter'
import { createDingbatsFontResource, createFontResource, type FontResource } from '../src/core/fontMetrics'
import { ensureSamplePdf } from './fixtures'

let source: Uint8Array
let font: FontResource
let fallback: FontResource

beforeAll(async () => {
  source = new Uint8Array(await fs.readFile(await ensureSamplePdf()))
  font = createFontResource(new Uint8Array(await fs.readFile(path.resolve('public/fonts/BIZUDGothic-Regular.ttf'))))
  fallback = createDingbatsFontResource()
})
afterAll(() => { font.font.destroy(); fallback.font.destroy() })

function pageText(document: PDFDocument, pageIndex: number): string {
  const page = document.loadPage(pageIndex)
  const structured = page.toStructuredText('preserve-whitespace')
  try { return structured.asText() } finally { structured.destroy(); page.destroy() }
}

describe('headerFooter integration', () => {
  it('内容として適用・付け直し・保存・削除でき、設定の日本語が往復する', () => {
    const document = new mupdf.PDFDocument(source)
    try {
      const settings = { ...DEFAULT_HEADER_FOOTER_SETTINGS, fields: { ...DEFAULT_HEADER_FOOTER_SETTINGS.fields, topLeft: '日本語 {ファイル名}' } }
      applyHeaderFooter(document, settings, '設計図.pdf', '2026年10月1日', font, fallback)
      expect(pageText(document, 0)).toContain('- 1 -')
      expect(pageText(document, 0)).toContain('日本語')
      expect(getHeaderFooterSettings(document)?.fields.topLeft).toBe('日本語 {ファイル名}')
      const pageObject = document.findPage(0)
      const resources = pageObject.getInheritable('Resources')
      const fontFile = resources.get('Font', 'KaruHF', 'DescendantFonts', 0, 'FontDescriptor', 'FontFile2')
      try {
        const subsetBytes = fontFile.readRawStream().length
        expect(subsetBytes).toBeLessThan(200 * 1024)
        console.info(`HEADER_FOOTER_FONT_SUBSET bytes=${subsetBytes}`)
      } finally { fontFile.destroy(); resources.destroy(); pageObject.destroy() }

      const replaced = { ...settings, fields: { ...settings.fields, bottomCenter: 'P.{ページ}' } }
      applyHeaderFooter(document, replaced, '設計図.pdf', '2026年10月1日', font, fallback)
      expect(pageText(document, 0)).toContain('P.1')
      expect(pageText(document, 0)).not.toContain('- 1 -')

      const buffer = document.saveToBuffer('compress,garbage=4')
      const reopened = new mupdf.PDFDocument(buffer.asUint8Array())
      try {
        expect(pageText(reopened, 1)).toContain('P.2')
        expect(getHeaderFooterSettings(reopened)?.fields.topLeft).toBe('日本語 {ファイル名}')
        const before = pageText(reopened, 0)
        removeHeaderFooter(reopened)
        expect(pageText(reopened, 0)).not.toContain('P.1')
        expect(pageText(reopened, 0).length).toBeLessThan(before.length)
        expect(getHeaderFooterSettings(reopened)).toBeNull()
      } finally { reopened.destroy(); buffer.destroy() }
    } finally { document.destroy() }
  }, 60_000)

  it('元のページの内容を残し、削除すると元の内容ストリームだけに戻る', () => {
    const document = new mupdf.PDFDocument(source)
    try {
      const contentsBefore = document.findPage(0).get('Contents').toString()
      expect(pageText(document, 0)).toContain('Sample page 1')
      applyHeaderFooter(document, DEFAULT_HEADER_FOOTER_SETTINGS, 'sample.pdf', '2026年10月1日', font, fallback)
      expect(pageText(document, 0)).toContain('Sample page 1')
      expect(pageText(document, 0)).toContain('- 1 -')
      applyHeaderFooter(document, DEFAULT_HEADER_FOOTER_SETTINGS, 'sample.pdf', '2026年10月1日', font, fallback)
      expect(pageText(document, 0)).toContain('Sample page 1')
      expect(pageText(document, 0).split('- 1 -')).toHaveLength(2)
      removeHeaderFooter(document)
      expect(pageText(document, 0)).toContain('Sample page 1')
      expect(pageText(document, 0)).not.toContain('- 1 -')
      const contentsAfter = document.findPage(0).get('Contents')
      const referenced = contentsAfter.isArray() ? contentsAfter.get(0).toString() : contentsAfter.toString()
      expect(contentsBefore).toContain(referenced)
    } finally { document.destroy() }
  })

  it('回転したページと表示範囲のずれたページでも、見えている向きで正立し、指定の位置と大きさで出る', () => {
    const document = new mupdf.PDFDocument()
    const pages: Array<{ media: [number, number, number, number]; rotate: 0 | 90 | 180 | 270; crop?: [number, number, number, number] }> = [
      { media: [0, 0, 595, 842], rotate: 0 },
      { media: [0, 0, 595, 842], rotate: 90 },
      { media: [0, 0, 595, 842], rotate: 180 },
      { media: [0, 0, 595, 842], rotate: 270 },
      { media: [0, 0, 800, 1000], rotate: 90, crop: [100, 100, 695, 942] },
    ]
    try {
      for (const spec of pages) {
        const page = document.addPage(spec.media, spec.rotate, {}, '0 0 0 rg 120 700 40 40 re f')
        if (spec.crop) {
          const crop = document.newArray()
          spec.crop.forEach((value) => crop.push(value))
          page.put('CropBox', crop)
          crop.destroy()
        }
        document.insertPage(-1, page)
        page.destroy()
      }
      const settings = {
        ...DEFAULT_HEADER_FOOTER_SETTINGS,
        fontSize: 12,
        fields: { topLeft: '左上', topCenter: '上中央', topRight: '右上', bottomLeft: '左下', bottomCenter: '- {ページ} -', bottomRight: '右下' },
      }
      applyHeaderFooter(document, settings, 'test.pdf', '2026年10月1日', font, fallback)
      const horizontal = 15 * 72 / 25.4
      const vertical = 10 * 72 / 25.4
      for (let index = 0; index < pages.length; index += 1) {
        const page = document.loadPage(index)
        const [x0, y0, x1, y1] = page.getBounds()
        const structured = page.toStructuredText('preserve-whitespace')
        const lines = new Map<string, { bbox: number[]; dir: number[] }>()
        let current: { bbox: number[]; dir: number[]; text: string } | null = null
        try {
          structured.walk({
            beginLine(bbox, _wmode, dir) { current = { bbox: [...bbox], dir: [...dir], text: '' } },
            onChar(character) { if (current) current.text += character },
            endLine() { if (current) lines.set(current.text.trim(), current); current = null },
          })
        } finally { structured.destroy(); page.destroy() }
        const line = (text: string) => {
          const found = lines.get(text)
          if (!found) throw new Error(`${index + 1}ページ目に「${text}」がありません: ${[...lines.keys()].join(' / ')}`)
          expect(found.dir[0]).toBeCloseTo(1, 3)
          expect(found.dir[1]).toBeCloseTo(0, 3)
          // 文字の高さが大きさの2倍を超えない（大きさを二重に掛けていない）
          expect(found.bbox[3] - found.bbox[1]).toBeLessThan(settings.fontSize * 2)
          return found.bbox
        }
        expect(line('左上')[0]).toBeCloseTo(x0 + horizontal, 0)
        expect(line('左上')[1]).toBeGreaterThanOrEqual(y0 + vertical - 1)
        expect(line('左上')[1]).toBeLessThan(y0 + vertical + settings.fontSize)
        expect(line('右上')[2]).toBeLessThanOrEqual(x1 - horizontal + settings.fontSize)
        expect(line('右上')[2]).toBeGreaterThan(x1 - horizontal - settings.fontSize)
        const center = line(`- ${index + 1} -`)
        expect((center[0] + center[2]) / 2).toBeCloseTo((x0 + x1) / 2, -1)
        expect(center[3]).toBeLessThanOrEqual(y1 - vertical + 1)
        expect(center[3]).toBeGreaterThan(y1 - vertical - settings.fontSize)
        expect(line('左下')[0]).toBeCloseTo(x0 + horizontal, 0)
      }
    } finally { document.destroy() }
  })
})
