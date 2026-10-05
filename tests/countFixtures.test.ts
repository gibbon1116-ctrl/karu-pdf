import { expect, it } from 'vitest'
import mupdf from 'mupdf'
import { COUNT_COLORS, COUNT_FILLS, COUNT_SHAPES, FIXTURE_PRESETS, MAX_COUNT_FIXTURE_BYTES, MAX_COUNT_SAMPLE_BASE64, countHex, countRgb, sameFixtureAppearance, nextCountStyle, parseCountFixtureSample, parseCountFixtures, readCountFixtures, serializeCountFixtures, writeCountFixtures, type CountFixture, type CountFixtureSample } from '../src/core/countFixtures'
import { countMarkerData, countPdfPath, countSvgPath } from '../src/editor/countMarkers'
import { createCountCsv } from '../src/app/annotationCsv'
const defaultStyle = nextCountStyle([])
const fixture = (id = 'a'): CountFixture => ({ id, name: 'ダウンライト', code: 'DL', category: '照明器具', order: 0, style: structuredClone(defaultStyle) })

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
  expect(new TextEncoder().encode(raw(multibyte)).length).toBeGreaterThan(1024 * 1024)
  expect(parseCountFixtures(serializeCountFixtures(multibyte))).toHaveLength(1000)
  expect(parseCountFixtures(' '.repeat(MAX_COUNT_FIXTURE_BYTES) + raw([f]))).toEqual([])
  expect(parseCountFixtures(raw([{ ...f, memo: '日'.repeat(MAX_COUNT_FIXTURE_BYTES / 3) }]))).toEqual([])
  expect(parseCountFixtures('{')).toEqual([])
  expect(parseCountFixtures('{"version":2,"fixtures":[]}')).toEqual([])
})

it('assigns 100 deterministic different combinations with the minimum usage score', () => {
  const fixtures: CountFixture[] = []
  for (let i = 0; i < 100; i++) {
    const style = nextCountStyle(fixtures)
    const hexes = fixtures.map(f => countHex(f.style.color))
    const score = (shape: string, fill: string, color: string) => fixtures.reduce((n, f, j) => n + Number(f.style.shape === shape) + Number(f.style.fill === fill) + Number(hexes[j] === color), 0)
    const used = new Set(fixtures.map(f => `${f.style.shape}:${f.style.fill}:${countHex(f.style.color)}`))
    let minimum = Infinity
    for (const shape of COUNT_SHAPES) for (const fill of COUNT_FILLS) for (const color of COUNT_COLORS) {
      if (!used.has(`${shape}:${fill}:${color}`)) minimum = Math.min(minimum, score(shape, fill, color))
    }
    expect(score(style.shape, style.fill, countHex(style.color))).toBe(minimum)
    expect(nextCountStyle(fixtures)).toEqual(style)
    fixtures.push({ ...fixture(String(i)), style, order: i })
  }
  expect(new Set(fixtures.map(f => JSON.stringify([f.style.shape, f.style.fill, countHex(f.style.color)]))).size).toBe(100)
})

it('prefers unused shapes in a 28-fixture list when available and unused colors/fills after 14 fixtures', () => {
  // Reproduce the 28 preset appearances assigned by the old fixed sequence.
  const legacy = FIXTURE_PRESETS.電気設備.filter(f => !f.kind).map((item, i) => ({ ...fixture(String(i)), ...item, order: i, style: { ...fixture().style, shape: COUNT_SHAPES[i % 14], color: countRgb(COUNT_COLORS[(i * 7) % 24]), fill: COUNT_FILLS[Math.floor(i / 14) % 5] } }))
  expect(legacy).toHaveLength(28)
  // All 14 shapes were used by the legacy sequence; the new sequence must spread
  // shapes, colors and fills while keeping every complete appearance distinct.
  const next: CountFixture[] = []
  for (const [i, item] of FIXTURE_PRESETS.電気設備.filter(f => !f.kind).entries()) next.push({ ...fixture(String(i)), ...item, style: nextCountStyle(next), order: i })
  const proposed = nextCountStyle(next)
  expect(next.some(f => f.style.shape === proposed.shape && f.style.fill === proposed.fill && countHex(f.style.color) === countHex(proposed.color))).toBe(false)
  const fourteen = Array.from({ length: 15 }, (_, i) => ({ ...fixture(String(i)), style: { ...fixture().style, shape: COUNT_SHAPES[i % 14] } }))
  const afterFourteen = nextCountStyle(fourteen)
  expect(countHex(afterFourteen.color)).not.toBe(countHex(fourteen[0].style.color))
  expect(afterFourteen.fill).not.toBe(fourteen[0].style.fill)
  const repeated = legacy.map((f, i) => ({ ...f, style: { ...f.style, shape: COUNT_SHAPES[i % 7] } }))
  expect(COUNT_SHAPES.slice(7)).toContain(nextCountStyle(repeated).shape)
})

function pngSample(width = 16, height = 16): CountFixtureSample {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], true)
  try { pixmap.clear(255); return { png: Buffer.from(pixmap.asPNG()).toString('base64'), width, height, pageIndex: 0 } } finally { pixmap.destroy() }
}

it('validates PNG signature, encoded dimensions, pixel and base64 limits without losing fixture fields', () => {
  const sample = pngSample(), f = { ...fixture(), sample }
  expect(parseCountFixtureSample(sample)).toEqual(sample)
  expect(parseCountFixtureSample(pngSample(160, 160))).toBeDefined()
  expect(parseCountFixtures(serializeCountFixtures([f]))).toEqual([f])
  const binary = Buffer.from(sample.png, 'base64')
  // The validation contract checks the header, not image decoding. Trailing
  // padding lets this test isolate the exact encoded-size boundary.
  const atLimit = { ...sample, png: Buffer.concat([binary, Buffer.alloc(MAX_COUNT_SAMPLE_BASE64 * 3 / 4 - binary.length)]).toString('base64') }
  expect(atLimit.png.length).toBe(MAX_COUNT_SAMPLE_BASE64)
  expect(parseCountFixtureSample(atLimit)).toBeDefined()
  for (const invalid of [null, {}, { ...sample, width: 15 }, { ...sample, height: 161 }, { ...sample, width: 16.5 }, { ...sample, width: 32 }, { ...sample, pageIndex: -1 }, { ...sample, pageIndex: .5 }, { ...sample, png: sample.png + '?' }, { ...sample, png: 'data:image/png;base64,' + sample.png }, { ...sample, png: sample.png.slice(1) }, { ...sample, png: 'AAAA' }, { ...sample, png: atLimit.png + 'AAAA' }, { ...sample, png: Buffer.from('not a PNG image').toString('base64') }]) {
    expect(parseCountFixtureSample(invalid)).toBeUndefined()
    const read = parseCountFixtures(JSON.stringify({ version: 1, fixtures: [{ ...f, sample: invalid }] }))
    expect(read).toHaveLength(1); expect(read[0].sample).toBeUndefined(); expect(read[0].name).toBe(f.name)
    expect(() => serializeCountFixtures([{ ...f, sample: invalid as CountFixtureSample }])).toThrow()
  }
  const brokenSignature = Buffer.from(binary); brokenSignature[0] = 0
  expect(parseCountFixtureSample({ ...sample, png: brokenSignature.toString('base64') })).toBeUndefined()
  const brokenHeader = Buffer.from(binary); brokenHeader[12] = 0
  expect(parseCountFixtureSample({ ...sample, png: brokenHeader.toString('base64') })).toBeUndefined()
  const under = Array.from({ length: 80 }, (_, i) => ({ ...f, id: String(i), order: i, sample: atLimit }))
  expect(parseCountFixtures(serializeCountFixtures(under))).toHaveLength(80)
  const over = Array.from({ length: 86 }, (_, i) => ({ ...f, id: String(i), order: i, sample: atLimit }))
  expect(() => serializeCountFixtures(over)).toThrow()
  expect(parseCountFixtures(JSON.stringify({ version: 1, fixtures: over }))).toEqual([])
})

it('preserves sample PNGs in the PDF catalog through saving and reopening', () => {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 400, 400], 0, {}, ''), f = { ...fixture(), sample: pngSample(160, 80) }
  try {
    doc.insertPage(-1, ref); writeCountFixtures(doc, [f])
    const bytes = doc.saveToBuffer('compress')
    try {
      const reopened = new mupdf.PDFDocument(bytes.asUint8Array())
      try { expect(readCountFixtures(reopened)).toEqual([f]) } finally { reopened.destroy() }
    } finally { bytes.destroy() }
  } finally { ref.destroy(); doc.destroy() }
})

it('keeps fixed-sequence tie order, then advances past the current, original and previous suggestions', () => {
  expect(nextCountStyle([])).toEqual({ shape: 'circle', fill: 'none', color: countRgb(COUNT_COLORS[0]), size: 10, opacity: .8, showCode: true })
  const original = fixture(), current = nextCountStyle([original]), next = nextCountStyle([original], [current, original.style])
  expect(next).not.toEqual(original.style); expect(next).not.toEqual(current)
  const following = nextCountStyle([original], [original.style, current, next])
  expect(following).not.toEqual(next); expect(following).not.toEqual(current)
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

it('fills double circles as a hollow ring for solid and half styles', () => {
  const style = fixture().style, radius = style.size / 2
  const doubleSolid = countMarkerData({ ...style, shape: 'doubleCircle', fill: 'solid' })
  const circleSolid = countMarkerData({ ...style, shape: 'circle', fill: 'solid' })
  const doubleHalf = countMarkerData({ ...style, shape: 'doubleCircle', fill: 'half' })
  const signedArea = (polygon: (typeof doubleSolid.fills)[number]) => polygon.reduce((area, point, i) => {
    const next = polygon[(i + 1) % polygon.length]
    return area + point[0] * next[1] - next[0] * point[1]
  }, 0) / 2
  const windingNumber = (polygon: (typeof doubleSolid.fills)[number], point: [number, number]) => {
    let winding = 0
    for (let i = 0; i < polygon.length; i++) {
      const [ax, ay] = polygon[i], [bx, by] = polygon[(i + 1) % polygon.length]
      const isLeft = (bx - ax) * (point[1] - ay) - (point[0] - ax) * (by - ay)
      if (ay <= point[1]) {
        if (by > point[1] && isLeft > 0) winding++
      } else if (by <= point[1] && isLeft < 0) winding--
    }
    return winding
  }
  const winding = (polygons: typeof doubleSolid.fills, point: [number, number]) => polygons.reduce((sum, polygon) => sum + windingNumber(polygon, point), 0)

  expect(doubleSolid.fills).toHaveLength(2)
  expect(doubleSolid.fills[0]).toEqual(doubleSolid.outline[0])
  expect(doubleSolid.fills[1]).toEqual([...doubleSolid.outline[1]].reverse())
  expect(signedArea(doubleSolid.fills[0]) * signedArea(doubleSolid.fills[1])).toBeLessThan(0)
  expect(winding(doubleSolid.fills, [0, 0])).toBe(0)
  expect(winding(doubleSolid.fills, [radius * .84, 0])).not.toBe(0)
  expect(winding(circleSolid.fills, [0, 0])).not.toBe(0)
  expect(winding(doubleHalf.fills, [0, 0])).toBe(0)
  expect(winding(doubleHalf.fills, [-radius * .84, 0])).not.toBe(0)
  expect(winding(doubleHalf.fills, [radius * .84, 0])).toBe(0)
})

it('exports page/all totals, nonempty-page columns and zero rows with BOM, CRLF and formula suppression', () => {
  const f = fixture(), zero = { ...fixture('b'), code: '@Z', name: '=ゼロ', category: '+分類', order: 1 }
  const csv = createCountCsv([{ pageIndex: 0, count: { version: 2, id: '1', fixtureId: 'a' } }, { pageIndex: 2, count: { version: 2, id: '2', fixtureId: 'a' } }, { pageIndex: 2, count: { version: 2, id: '3', fixtureId: 'a' } }], [f, zero], 2)
  expect(csv).toBe("\uFEFF分類,略号,名称,種別,単位,表示中の図面（p.3）,全図面の合計,p.1,p.3\r\n照明器具,DL,ダウンライト,個数,個,2,3,1,2\r\n'+分類,'@Z,'=ゼロ,個数,個,0,0,0,0\r\n")
})

it('round-trips quantity fields and rejects entire invalid items', () => {
 const f = { ...fixture(), kind: 'length' as const, method: 'polyline' as const, defaults: { addM: 3 }, line: { width: 1.5 as const, dash: 'dashDot' as const } }
 expect(parseCountFixtures(serializeCountFixtures([f]))).toEqual([f])
 expect(serializeCountFixtures([{ ...fixture(), kind: 'count' }])).toBe(serializeCountFixtures([fixture()]))
 for (const change of [{ kind: 'unknown' }, { kind: null }, { method: 'polygon' }, { defaults: { addM: -1 } }, { defaults: { heightM: 1001 } }, { defaults: { depthM: null } }, { line: { width: 5, dash: 'solid' } }, { line: { width: 1.5, dash: 'unknown' } }]) {
  expect(parseCountFixtures(JSON.stringify({ version: 1, fixtures: [{ ...f, ...change }] }))).toEqual([])
 }
 expect(FIXTURE_PRESETS.電気設備.filter(f => f.kind === 'length')).toHaveLength(13)
 expect(FIXTURE_PRESETS.機械設備.filter(f => f.kind === 'length')).toHaveLength(6)
 expect(FIXTURE_PRESETS.電気設備.find(f => f.code === 'CV')).toMatchObject({ name: 'ケーブル（CV）', method: 'polyline', kind: 'length' })
})

it('round-trips every area/volume kind-method pair and dimension defaults from presets', () => {
 const presets = FIXTURE_PRESETS['仮設・土工']
 expect(presets).toHaveLength(8)
 expect(new Set(presets.map(p => p.method))).toEqual(new Set(['polygon', 'lengthHeight', 'polygonDepth', 'lengthWidthDepth']))
 const items = presets.map((p, i): CountFixture => ({ ...fixture(String(i)), ...p, order: i, line: { width: 2, dash: 'dashed' } }))
 expect(parseCountFixtures(serializeCountFixtures(items))).toEqual(items)
 expect(presets.every(p => p.code.length <= 16)).toBe(true)
 expect(presets.find(p => p.code === '外部足場')?.defaults?.heightM).toBeUndefined()
 expect(presets.find(p => p.code === '根切り')?.defaults?.depthM).toBeUndefined()
 expect(presets.find(p => p.code === '溝掘削')?.defaults).toEqual({ widthM: .6, depthM: .8 })
 for (const p of items) {
  const wrong = { ...p, kind: p.kind === 'area' ? 'volume' : 'area' }
  expect(parseCountFixtures(JSON.stringify({ version: 1, fixtures: [wrong] }))).toEqual([])
 }
})

it('distinguishes area/volume methods while matching color, line width and dash', () => {
 const area: CountFixture = { ...fixture(), kind: 'area', method: 'polygon' }
 expect(sameFixtureAppearance(area, { ...area, id: 'b' })).toBe(true)
 expect(sameFixtureAppearance(area, { ...area, method: 'lengthHeight' })).toBe(false)
 const volume: CountFixture = { ...area, kind: 'volume', method: 'polygonDepth' }
 expect(sameFixtureAppearance(volume, { ...volume, method: 'lengthWidthDepth' })).toBe(false)
 expect(sameFixtureAppearance(area, { ...area, line: { width: 2, dash: 'solid' } })).toBe(false)
 expect(sameFixtureAppearance(area, { ...area, line: { width: 1.5, dash: 'dashed' } })).toBe(false)
})
