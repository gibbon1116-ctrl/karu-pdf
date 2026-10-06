import { existsSync, readFileSync } from 'node:fs'
import mupdf, { type Rect } from 'mupdf'
import { describe, expect, it } from 'vitest'
import { detectDrawingInfo, reconcileDrawingInfos, type DrawingDetection } from '../src/core/drawingInfo'
import { extractTextLines, type ExtractedTextLine } from '../src/core/textExtract'

interface PreviousPage {
  bounds: Rect
  lines: ExtractedTextLine[]
  final: DrawingDetection
}

// Confirmed against the title-block images; pages 21–23 were rendered again
// because the earlier contact sheet clipped the taller pages' title blocks.
const shichiNumbers = [
  '1116', '1117', '1118', '1121', '1122', '1201', '1202', '1301', '1302', '1303',
  '1304', '1311', '1401', '1402', '1403', '1404', '1405', '1406', '1407', '1501',
  '1511-1', '1511-2', '1511-3', '1521', '1522', '1523', '1524', '1531', '1532', '1533',
]
// Only single-valued fields, verified visually. Stacked branch choices remain
// unset, including EF-104-2-(A/B), EF-198-4-(D1/D2) and EC-131-1-(A/B).
const urAdditionalNumbers: Record<number, string> = {
  28: 'EF-109-5-B', 29: 'EF-109-5-C', 34: 'EF-119-2-E', 35: 'EF-119-3-C',
  36: 'EF-119-3-D', 40: 'EF-119-5-B', 61: 'EF-198-1-B', 63: 'EF-198-5-E',
  67: 'EF-201-5-A', 85: 'EC-106-1-A', 86: 'EC-106-1-B', 92: 'EC-106-8-C',
  93: 'EC-106-8-D', 100: 'EC-110-2-B', 104: 'EC-110-8-A', 105: 'EC-110-8-C',
  110: 'EC-117-2-A', 111: 'EC-117-2-B', 134: 'EC-123-13-G', 136: 'EC-123-14-C',
  137: 'EC-123-14-D', 139: 'EC-123-15-D', 142: 'EC-124-2-L', 148: 'EC-140-1-A',
}

function tally(values: (string | undefined)[], expected: (string | undefined)[]) {
  return {
    correct: values.filter((value, i) => value !== undefined && value === expected[i]).length,
    incorrect: values.filter((value, i) => value !== undefined && value !== expected[i]).length,
    unset: values.filter(value => value === undefined).length,
  }
}

// Local drawing data is optional and is never required by the normal suite.
// PowerShell: $env:SPEC05B_REAL_DRAWINGS='1'; npx vitest run tests/drawingInfo.real.test.ts
describe.skipIf(process.env.SPEC05B_REAL_DRAWINGS !== '1')('SPEC-05b-2 実図面の全ページ照合', () => {
  for (const [file, pageCount, beforeNumbers, afterNumbers, nameCount] of [
    ['七ヶ浜町_実施設計図.pdf', 30, 0, 30, 30],
    ['UR_電気設備標準詳細設計図集_R3.pdf', 149, 40, 64, 141],
    ['設備工事標準図_電気_R7.pdf', 254, 0, 0, 0],
  ] as const) {
    const pdfPath = `test-data/real/${file}`, baselinePath = `work/spec05b/${file}.json`
    it.skipIf(!existsSync(pdfPath) || !existsSync(baselinePath))(`${file}: 文字を再抽出して前回と照合`, () => {
      const previous = JSON.parse(readFileSync(baselinePath, 'utf8')) as PreviousPage[]
      const doc = new mupdf.PDFDocument(readFileSync(pdfPath))
      try {
        expect(doc.countPages()).toBe(pageCount)
        expect(previous).toHaveLength(pageCount)
        const detections = Array.from({ length: pageCount }, (_, i) => {
          const page = doc.loadPage(i), text = page.toStructuredText('preserve-whitespace')
          try {
            const bounds = page.getBounds(), extracted = extractTextLines(text, bounds, 0)
            expect(extracted.truncated).toBe(false)
            expect(extracted.invalidPositions).toBe(0)
            expect(extracted.uncertainCharacters).toBe(false)
            expect(bounds).toEqual(previous[i].bounds)
            expect(extracted.lines).toEqual(previous[i].lines)
            return detectDrawingInfo(extracted.lines, bounds, 0, true)
          } finally { text.destroy(); page.destroy() }
        })
        const actual = reconcileDrawingInfos(detections)
        const expectedNumbers = previous.map((p, i) => file.startsWith('七ヶ浜町')
          ? shichiNumbers[i] : file.startsWith('UR_') ? urAdditionalNumbers[i + 1] ?? p.final.number : undefined)
        const expectedNames = previous.map(p => p.final.name)
        expect(actual.map(p => p.number)).toEqual(expectedNumbers)
        expect(actual.map(p => p.name)).toEqual(expectedNames)
        const before = {
          number: tally(previous.map(p => p.final.number), expectedNumbers),
          name: tally(previous.map(p => p.final.name), expectedNames),
        }
        const after = {
          number: tally(actual.map(p => p.number), expectedNumbers),
          name: tally(actual.map(p => p.name), expectedNames),
        }
        expect(before.number).toEqual({ correct: beforeNumbers, incorrect: 0, unset: pageCount - beforeNumbers })
        expect(after.number).toEqual({ correct: afterNumbers, incorrect: 0, unset: pageCount - afterNumbers })
        expect(after.name).toEqual({ correct: nameCount, incorrect: 0, unset: pageCount - nameCount })
        console.info(JSON.stringify({ file, pages: pageCount, before, after }))
      } finally { doc.destroy() }
    }, 120_000)
  }
})
