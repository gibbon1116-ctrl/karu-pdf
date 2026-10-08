import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import mupdf from 'mupdf'
import type { Rect } from '../src/core/annotations'
import { assignSymbolLabels } from '../src/core/symbolLabels'
import { vectorSymbolSearch } from '../src/core/vectorSymbolSearch'
import { extractLabelPage } from '../src/worker/labelExtract'
import { extractVectorPage } from '../src/worker/vectorExtract'

const pdfPath = process.env.KARU_ANTE_PDF
it.skipIf(!pdfPath || !existsSync(pdfPath))('SPEC-08b: matches both page 71 samples and rejects G3 circuit labels', () => {
  const doc = mupdf.Document.openDocument(new Uint8Array(readFileSync(pdfPath!)), 'application/pdf')
  try {
    const page = extractVectorPage(doc, 70), labels = extractLabelPage(doc, 70)
    const samples: Rect[] = [[279.6,96.9,284.6,101.9], [275.5,93.5,284.6,101.9]]
    const results = samples.map((rect, i) => {
      const result = vectorSymbolSearch(page.segments, rect, { rotations: true, maxResults: 500 }, page.segments, page.widths, page.widths)
      const radius = Math.max(result.template.rect[2] - result.template.rect[0], result.template.rect[3] - result.template.rect[1])
      const values = assignSymbolLabels(labels, result.matches, radius)
      const counts: Record<string, number> = {}
      for (const value of values) {
        const key = (value.label || '(none)') + (value.gc ? '+G' : '')
        counts[key] = (counts[key] ?? 0) + 1
      }
      console.log('KARU_ANTE_PAGE71', JSON.stringify({ sample: i === 0 ? 'body' : 'wide', rect,
        matches: result.matches.length, labels: counts, radius, template: result.template, ms: result.stats.ms }))
      return { result, values }
    })
    expect(results[1].result.matches.length).toBeGreaterThanOrEqual(300)
    for (const { values } of results) expect(values.some(v => v.label.split('+').some(word => /^G3/.test(word)))).toBe(false)
  } finally { doc.destroy() }
}, 120_000)
