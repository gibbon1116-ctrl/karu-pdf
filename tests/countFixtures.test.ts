import { expect, it } from 'vitest'
import mupdf from 'mupdf'
import { COUNT_FILLS, COUNT_SHAPES, MAX_COUNT_FIXTURE_BYTES, countHex, countRgb, nextCountStyle, parseCountFixtures, readCountFixtures, serializeCountFixtures, writeCountFixtures, type CountFixture } from '../src/core/countFixtures'
import { countMarkerData, countPdfPath, countSvgPath } from '../src/editor/countMarkers'
import { createCountCsv } from '../src/app/annotationCsv'
const fixture = (id = 'a'): CountFixture => ({ id, name: 'ダウンライト', code: 'DL', category: '照明器具', order: 0, style: nextCountStyle([]) })

it('validates fields and rejects malformed entries, duplicate IDs, excess count and UTF-8 capacity', () => {
  const f = fixture(), raw = (items: unknown[]) => JSON.stringify({ version: 1, fixtures: items })
  expect(parseCountFixtures(serializeCountFixtures([f]))).toEqual([f])
  for (const change of [{ name: '' }, { name: 'a'.repeat(81) }, { code: 'a'.repeat(17) }, { category: ' ' }, { category: 'a'.repeat(41) }, { memo: 'a'.repeat(201) }, { order: -1 }, { style: { ...f.style, shape: 'unknown' } }, { style: { ...f.style, fill: 'unknown' } }, { style: { ...f.style, color: [0, 0, 2] } }, { style: { ...f.style, color: [0, 0] } }, { style: { ...f.style, size: 18 } }, { style: { ...f.style, opacity: .3 } }, { style: { ...f.style, showCode: 'yes' } }]) {
    expect(parseCountFixtures(raw([{ ...f, id: 'bad', ...change }, f]))).toEqual([f])
  }
  expect(parseCountFixtures(raw([f, f]))).toEqual([f])
  const thousand = Array.from({ length: 1000 }, (_, i) => ({ ...f, id: String(i), order: i }))
  expect(parseCountFixtures(serializeCountFixtures(thousand))).toHaveLength(1000)
  expect(parseCountFixtures(raw([...thousand, fixture('extra')]))).toEqual([])
  expect(() => serializeCountFixtures([...thousand, fixture('extra')])).toThrow()
  const multibyte = thousand.map(f => ({ ...f, name: '日'.repeat(80), code: '日'.repeat(16), category: '日'.repeat(40), memo: '日'.repeat(200) }))
  expect(() => serializeCountFixtures(multibyte)).toThrow()
  expect(parseCountFixtures(raw(multibyte))).toEqual([])
  expect(parseCountFixtures(' '.repeat(MAX_COUNT_FIXTURE_BYTES) + raw([f]))).toEqual([])
  expect(parseCountFixtures(raw([{ ...f, memo: '日'.repeat(MAX_COUNT_FIXTURE_BYTES / 3) }]))).toEqual([])
  expect(parseCountFixtures('{')).toEqual([])
  expect(parseCountFixtures('{"version":2,"fixtures":[]}')).toEqual([])
})

it('assigns 100 different combinations with different adjacent shapes and colors', () => {
  const fixtures: CountFixture[] = []
  for (let i = 0; i < 100; i++) {
    const style = nextCountStyle(fixtures), previous = fixtures.at(-1)?.style
    if (previous) { expect(style.shape).not.toBe(previous.shape); expect(countHex(style.color)).not.toBe(countHex(previous.color)) }
    fixtures.push({ ...fixture(String(i)), style, order: i })
  }
  expect(new Set(fixtures.map(f => JSON.stringify([f.style.shape, f.style.fill, countHex(f.style.color)]))).size).toBe(100)
})

it('continues allocating unused combinations after the prescribed sequence has exhausted 840 styles', () => {
  const fixtures: CountFixture[] = []
  for (let i = 0; i < 1000; i++) fixtures.push({ ...fixture(String(i)), order: i, style: nextCountStyle(fixtures) })
  expect(new Set(fixtures.map(f => JSON.stringify([f.style.shape, f.style.fill, countHex(f.style.color)]))).size).toBe(1000)
})

it('stores fixtures on the PDF catalog and reads them after reopening', () => {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 400, 400], 0, {}, '')
  try {
    doc.insertPage(-1, ref); writeCountFixtures(doc, [fixture()])
    const bytes = doc.saveToBuffer('compress')
    try { const reopened = new mupdf.PDFDocument(bytes.asUint8Array()); try { expect(readCountFixtures(reopened)).toEqual([fixture()]) } finally { reopened.destroy() } } finally { bytes.destroy() }
  } finally { ref.destroy(); doc.destroy() }
})

it('creates common SVG/PDF geometry for 14 shapes × 5 fills and bright-color outlines', () => {
  for (const shape of COUNT_SHAPES) for (const fill of COUNT_FILLS) {
    const data = countMarkerData({ ...fixture().style, shape, fill }, 20, 30)
    expect(countSvgPath(data.outline)).toContain('M'); expect(countPdfPath(data.outline)).toContain('m')
    expect(data.outline.flat().every(p => p.every(Number.isFinite))).toBe(true)
    if (fill === 'none') expect(data.fills).toEqual([])
    if (fill === 'half') expect(data.fills.flat().every(p => p[0] <= 20)).toBe(true)
    if (fill === 'hatch') expect(data.strokes.length).toBeGreaterThan(0)
    if (fill === 'solid' || fill === 'dot') expect(data.fills.length).toBeGreaterThan(0)
  }
  expect(countMarkerData({ ...fixture().style, color: countRgb('#FFF04D') }).bright).toBe(true)
  expect(countMarkerData({ ...fixture().style, color: countRgb('#000000') }).bright).toBe(false)
})

it('exports page/all totals, nonempty-page columns and zero rows with BOM, CRLF and formula suppression', () => {
  const f = fixture(), zero = { ...fixture('b'), code: '@Z', name: '=ゼロ', category: '+分類', order: 1 }
  const csv = createCountCsv([{ pageIndex: 0, count: { version: 2, id: '1', fixtureId: 'a' } }, { pageIndex: 2, count: { version: 2, id: '2', fixtureId: 'a' } }, { pageIndex: 2, count: { version: 2, id: '3', fixtureId: 'a' } }], [f, zero], 2)
  expect(csv).toBe("\uFEFF分類,略号,器具名称,表示中の図面（p.3）,全図面の合計,p.1,p.3\r\n照明器具,DL,ダウンライト,2,3,1,2\r\n'+分類,'@Z,'=ゼロ,0,0,0,0\r\n")
})
