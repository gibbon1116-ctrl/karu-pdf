import fs from 'node:fs/promises'
import path from 'node:path'
import mupdf from 'mupdf'
import { expect, it } from 'vitest'
import { applyEdits, listAnnotations } from '../src/core/annotations'
import { createFontResource } from '../src/core/fontMetrics'
import { nextCountStyle, readCountFixtures, type CountFixture } from '../src/core/countFixtures'
import { AnnotationStore } from '../src/editor/AnnotationStore'

it('opens legacy groups without PDF changes or dirty state and migrates them with the next edit/save', async () => {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 400, 400], 0, {}, '')
  const font = createFontResource(new Uint8Array(await fs.readFile(path.resolve('public/fonts/BIZUDGothic-Regular.ttf'))))
  try {
    doc.insertPage(-1, ref)
    const applied = applyEdits(doc, [0, 1, 2].map(i => ({ kind: 'createSymbol' as const, pageIndex: 0, rect: [20 + i * 20, 30, 30 + i * 20, 40] as [number, number, number, number], color: [0, 0, 1] as [number, number, number], symbol: 'circle' as const, count: { version: 1 as const, id: `old${i}`, group: i === 2 ? 'コンセント' : '照明器具' } })), {})
    expect(applied.errors).toEqual([])
    const store = new AnnotationStore()
    await store.ensureCountFixtures(async () => readCountFixtures(doc), async () => store.ensurePageLoaded(0, async () => listAnnotations(doc, 0)))
    expect(store.getCountFixtures().map(f => f.name)).toEqual(['照明器具', 'コンセント'])
    expect(store.isDirty()).toBe(false)
    expect(readCountFixtures(doc)).toEqual([])
    expect(listAnnotations(doc, 0).every(a => a.count?.version === 1)).toBe(true)
    expect(store.toEdits()).toEqual([])
    const extra: CountFixture = { id: 'new', name: '感知器', code: 'SD', category: '弱電・防災', style: nextCountStyle(store.getCountFixtures()), order: 2 }
    store.setCountFixtures([...store.getCountFixtures(), extra])
    const edits = store.toEdits()
    expect(edits.filter(e => e.kind === 'updateSymbol')).toHaveLength(3)
    const result = applyEdits(doc, edits, { BIZUDGothic: font })
    expect(result.errors).toEqual([]); store.markApplied(result); expect(store.isDirty()).toBe(false)
    store.setFixtureVisible([store.getCountFixtures()[0].id], false)
    expect(store.isDirty()).toBe(false); expect(store.toEdits()).toEqual([])
    const bytes = doc.saveToBuffer('compress')
    try {
      const reopened = new mupdf.PDFDocument(bytes.asUint8Array())
      try {
        expect(readCountFixtures(reopened)).toHaveLength(3)
        const marks = listAnnotations(reopened, 0)
        expect(marks.every(a => a.count?.version === 2)).toBe(true)
        expect(marks[0].contents).toBe('個数: 照明器具')
        expect(marks[0].rect).toEqual([20, 30, 30, 40])
      } finally { reopened.destroy() }
    } finally { bytes.destroy() }
  } finally { font.font.destroy(); ref.destroy(); doc.destroy() }
})

it('saves fixture-based Stamp appearance, code Contents and marker bounds independently from the label extent', async () => {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 400, 400], 0, {}, '')
  const font = createFontResource(new Uint8Array(await fs.readFile(path.resolve('public/fonts/BIZUDGothic-Regular.ttf'))))
  try {
    doc.insertPage(-1, ref)
    const fixture: CountFixture = { id: 'dl', name: 'ダウンライト', code: 'DL', category: '照明器具', order: 0, style: { ...nextCountStyle([]), shape: 'star', fill: 'hatch', color: [1, 1, 0] } }
    const result = applyEdits(doc, [{ kind: 'createSymbol', pageIndex: 0, rect: [100, 100, 110, 110], color: fixture.style.color, symbol: 'circle', count: { version: 2, id: 'mark', fixtureId: 'dl' }, countFixture: fixture }, { kind: 'createSymbol', pageIndex: 0, rect: [200, 200, 210, 210], color: fixture.style.color, symbol: 'circle', count: { version: 2, id: 'mark2', fixtureId: 'dl' }, countFixture: fixture }, { kind: 'setCountFixtures', pageIndex: 0, fixtures: [fixture] }], { BIZUDGothic: font })
    expect(result.errors).toEqual([])
    const page = doc.loadPage(0), stamp = page.getAnnotations()[0], object = stamp.getObject(), appearance = object.get('AP', 'N'), fonts = appearance.get('Resources', 'Font'), stream = appearance.readStream()
    try {
      expect(stamp.getContents()).toBe('個数: DL ダウンライト')
      expect(fonts.isNull()).toBe(false)
      expect(stream.asString().length).toBeGreaterThan(200)
      expect(listAnnotations(doc, 0)[0].rect).toEqual([100, 100, 110, 110])
      expect(listAnnotations(doc, 0)[1].rect).toEqual([200, 200, 210, 210])
      const other = page.getAnnotations()[1], otherObject = other.getObject(), otherAppearance = otherObject.get('AP', 'N'), otherStream = otherAppearance.readStream()
      try { expect(otherAppearance.asIndirect()).not.toBe(appearance.asIndirect()); expect(otherStream.asString()).not.toBe(stream.asString()) } finally { otherStream.destroy(); otherAppearance.destroy(); otherObject.destroy(); other.destroy() }
    } finally { stream.destroy(); fonts.destroy(); appearance.destroy(); object.destroy(); stamp.destroy(); page.destroy() }
  } finally { font.font.destroy(); ref.destroy(); doc.destroy() }
})
