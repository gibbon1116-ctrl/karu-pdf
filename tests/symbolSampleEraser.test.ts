import { describe, expect, it } from 'vitest'
import {
  defaultVectorTolerance, manualVectorTemplate, prepareVectorTemplate, templateCandidateLines, vectorSymbolSearch,
} from '../src/core/vectorSymbolSearch'
import { parseCountFixtureSample, type CountFixtureSample } from '../src/core/countFixtures'
import { searchVectorMessage, type VectorSearchMessage } from '../src/worker/symbolSearchMessages'
import type { Rect } from '../src/core/annotations'
import { symbolSampleEraserGeometry, symbolSampleEraserRect } from './symbolSampleEraserFixtures'

const rect: Rect = [-1, -1, 12, 5]

describe('manualVectorTemplate', () => {
  it('keeps selected geometry, computes bounds and the length-weighted median, and records erased lines', () => {
    const segments = new Float32Array([0, 0, 10, 0, 0, 1, 1, 1, 0, 3, 10, 3])
    const widths = new Float32Array([.2, .8, .8])
    const before = segments.slice(), beforeWidths = widths.slice()
    const result = manualVectorTemplate(segments, widths, rect, 7)
    expect(result.segments).toEqual(segments)
    expect(result.widths).toEqual(widths)
    expect(result.bounds).toEqual([0, 0, 10, 3])
    expect(result.strokeWidth).toBeCloseTo(.8)
    expect(result.tolerance).toBe(defaultVectorTolerance(result.bounds))
    expect(result.removed).toEqual({ wiring: 0, other: 4, thin: 0 })
    expect(result.total).toBe(7)
    expect(result.cleaned).toBe(true)
    expect(segments).toEqual(before)
    expect(widths).toEqual(beforeWidths)
  })

  it('uses zero when no positive widths exist and does not mark an intact selection as cleaned', () => {
    const result = manualVectorTemplate(new Float32Array([0, 0, 10, 0, 0, 3, 10, 3]), new Float32Array(2), rect, 2)
    expect(result.strokeWidth).toBe(0)
    expect(result.cleaned).toBe(false)
    expect(result.removed).toEqual({ wiring: 0, other: 0, thin: 0 })
  })

  it('rejects fewer than two lines, malformed arrays, non-finite values, and invalid totals', () => {
    const segments = new Float32Array([0, 0, 10, 0, 0, 3, 10, 3])
    const widths = new Float32Array([.6, .6])
    expect(() => manualVectorTemplate(new Float32Array(), new Float32Array(), rect, 0)).toThrow()
    expect(() => manualVectorTemplate(segments.subarray(0, 4), widths.subarray(0, 1), rect, 2)).toThrow()
    expect(() => manualVectorTemplate(new Float32Array(9), widths, rect, 3)).toThrow()
    expect(() => manualVectorTemplate(segments, new Float32Array(1), rect, 2)).toThrow()
    const badSegments = segments.slice(); badSegments[0] = NaN
    expect(() => manualVectorTemplate(badSegments, widths, rect, 2)).toThrow()
    const badWidths = widths.slice(); badWidths[0] = Infinity
    expect(() => manualVectorTemplate(segments, badWidths, rect, 2)).toThrow()
    badWidths[0] = -1
    expect(() => manualVectorTemplate(segments, badWidths, rect, 2)).toThrow()
    expect(() => manualVectorTemplate(segments, widths, rect, 1)).toThrow()
    expect(() => manualVectorTemplate(segments, widths, rect, Infinity)).toThrow()
    expect(() => manualVectorTemplate(segments, widths, [0, 0, 0, 1], 2)).toThrow()
  })
})

describe('templateCandidateLines', () => {
  it('maps retained IDs back to exactly the automatic template, including width filtering', () => {
    const { segments, widths } = symbolSampleEraserGeometry()
    const variants = [
      { segments, widths },
      {
        segments: new Float32Array([...segments, 21, 21, 29, 27]),
        widths: new Float32Array([...widths, .03]),
      },
    ]
    for (const page of variants) {
      const before = page.segments.slice(), beforeWidths = page.widths.slice()
      const candidates = templateCandidateLines(page.segments, page.widths, symbolSampleEraserRect)
      const prepared = prepareVectorTemplate(page.segments, page.widths, symbolSampleEraserRect)
      const kept = candidates.ids.filter(id => candidates.kept.has(id))
      expect(new Float32Array(kept.flatMap(id => Array.from(page.segments.subarray(id * 4, id * 4 + 4)))))
        .toEqual(prepared.segments)
      expect(new Float32Array(kept.map(id => page.widths[id]))).toEqual(prepared.widths)
      expect(candidates.ids.length).toBe(prepared.total)
      expect([...candidates.kept].every(id => candidates.ids.includes(id))).toBe(true)
      expect(page.segments).toEqual(before)
      expect(page.widths).toEqual(beforeWidths)
    }
  })
})

describe('manual vector search', () => {
  it('finds all bodies after removing wiring retained inside the sample body', () => {
    const { segments, widths, body } = symbolSampleEraserGeometry()
    const automatic = vectorSymbolSearch(segments, symbolSampleEraserRect, { threshold: .85 },
      segments, widths, widths)
    const manual = vectorSymbolSearch(segments, symbolSampleEraserRect, { threshold: .85 },
      segments, widths, widths, undefined, { segments: body, widths: new Float32Array(4).fill(.6) })
    expect(manual.matches).toHaveLength(3)
    expect(automatic.matches.length).toBeLessThan(manual.matches.length)
    expect(manual.template.segments).toBe(4)
    expect(manual.template.removed).toEqual({ wiring: 0, other: 3, thin: 0 })
  })

  it('preserves results when the optional manual argument is absent', () => {
    const { segments, widths } = symbolSampleEraserGeometry()
    const a = vectorSymbolSearch(segments, symbolSampleEraserRect, { threshold: .85 }, segments, widths, widths)
    const b = vectorSymbolSearch(segments, symbolSampleEraserRect, { threshold: .85 }, segments, widths, widths, undefined, undefined)
    expect(b.matches).toEqual(a.matches)
    expect(b.template).toEqual(a.template)
  })

  it('passes sampleLines through the Worker handler and rejects a selection shorter than two lines', () => {
    const { segments, widths, body } = symbolSampleEraserGeometry()
    const message: VectorSearchMessage = {
      type: 'vector-search', id: 1, segments, segmentWidths: widths,
      sampleSegments: segments, sampleWidths: widths, sampleRect: symbolSampleEraserRect,
      sampleLines: { segments: body, widths: new Float32Array(4).fill(.6) },
      options: { threshold: .85 },
    }
    const result = searchVectorMessage(message)
    expect(result?.matches).toHaveLength(3)
    expect(result?.template.segments).toBe(4)
    expect(result?.template.removed).toEqual({ wiring: 0, other: 3, thin: 0 })
    expect(searchVectorMessage({
      ...message, sampleLines: { segments: body.subarray(0, 4), widths: new Float32Array([.6]) },
    })).toBeNull()
    const malformed = body.slice(); malformed[0] = Infinity
    expect(() => searchVectorMessage({
      ...message, sampleLines: { segments: malformed, widths: new Float32Array(4).fill(.6) },
    })).toThrow()
  })
})

function sampleWith(lines?: CountFixtureSample['lines']): CountFixtureSample {
  // The parser validates the PNG signature and IHDR. No image decoding is needed in these schema tests.
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  bytes[11] = 13
  bytes.set([73, 72, 68, 82], 12)
  bytes[19] = 32; bytes[23] = 32
  return {
    png: btoa(String.fromCharCode(...bytes)), width: 32, height: 32, pageIndex: 0,
    rect: [0, 0, 20, 20], ...(lines ? { lines } : {}),
  }
}
function savedLines(count: number): NonNullable<CountFixtureSample['lines']> {
  return {
    segments: Array.from({ length: count }, (_, i) => [0, i, 10, i]).flat(),
    widths: Array.from({ length: count }, () => .6),
  }
}

describe('CountFixtureSample.lines', () => {
  it('retains two through 256 lines through serialization and copies their arrays', () => {
    for (const count of [2, 256]) {
      const sample = sampleWith(savedLines(count))
      const parsed = parseCountFixtureSample(sample)!
      expect(parsed.lines).toEqual(sample.lines)
      expect(parsed.lines?.segments).not.toBe(sample.lines?.segments)
      expect(parsed.lines?.widths).not.toBe(sample.lines?.widths)
      expect(parseCountFixtureSample(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
    }
  })

  it('drops invalid lines while preserving the sample', () => {
    const valid = savedLines(2)
    const invalid: unknown[] = [
      savedLines(0), savedLines(1), savedLines(257),
      { segments: [...valid.segments, 1], widths: valid.widths },
      { segments: valid.segments, widths: [.6] },
      { segments: [NaN, ...valid.segments.slice(1)], widths: valid.widths },
      { segments: [Infinity, ...valid.segments.slice(1)], widths: valid.widths },
      { segments: ['0', ...valid.segments.slice(1)], widths: valid.widths },
      { segments: valid.segments, widths: [-.1, .6] },
      { segments: valid.segments, widths: [NaN, .6] },
      { segments: valid.segments, widths: [Infinity, .6] },
      { segments: valid.segments, widths: ['.6', .6] },
      { segments: null, widths: valid.widths },
      null,
    ]
    for (const lines of invalid) {
      const sample = sampleWith()
      expect(parseCountFixtureSample({ ...sample, lines })).toEqual(sample)
    }
  })

  it('drops lines when rect is absent or invalid, and permits zero widths', () => {
    const sample = sampleWith(savedLines(2))
    const { rect: _rect, lines: _lines, ...withoutRect } = sample
    expect(parseCountFixtureSample({ ...sample, rect: undefined })).toEqual(withoutRect)
    expect(parseCountFixtureSample({ ...sample, rect: [0, 0, 0, 20] })).toEqual(withoutRect)
    expect(parseCountFixtureSample({
      ...sample, lines: { segments: sample.lines!.segments, widths: [0, 0] },
    })?.lines?.widths).toEqual([0, 0])
  })

  it('keeps only the image fields when constructing a sample imported from another PDF', () => {
    const sample = sampleWith(savedLines(2))
    const imported = {
      png: sample.png, width: sample.width, height: sample.height, pageIndex: sample.pageIndex,
    }
    expect(parseCountFixtureSample(imported)).toEqual(imported)
    expect(parseCountFixtureSample(imported)?.rect).toBeUndefined()
    expect(parseCountFixtureSample(imported)?.lines).toBeUndefined()
  })
})
