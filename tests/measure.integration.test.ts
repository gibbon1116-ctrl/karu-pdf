import fs from 'node:fs/promises'
import path from 'node:path'
import mupdf, { type PDFDocument, type PDFPage } from 'mupdf'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyEdits, listAnnotations, type AnnotationEdit, type Point, type Rect } from '../src/core/annotations'
import { createDingbatsFontResource, createFontResource, type FontResource } from '../src/core/fontMetrics'
import { createMeasureDictionary, measureText, ratioScale, readPageScale, type MeasureKind } from '../src/core/measure'
import { ensureSamplePdf } from './fixtures'

let source: Uint8Array, font: FontResource, fallback: FontResource
const scale = ratioScale(100, 'PDF', { width: 595, height: 842 })
const vertices: Record<MeasureKind, Point[]> = {
  distance: [[100, 220], [172, 220]],
  perimeter: [[280, 300], [352, 300], [352, 372]],
  area: [[100, 400], [172, 400], [172, 472], [100, 472]],
}
beforeAll(async () => {
  source = new Uint8Array(await fs.readFile(await ensureSamplePdf()))
  font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf')))
  fallback = createDingbatsFontResource()
})
afterAll(() => { font.font.destroy(); fallback.font.destroy() })
const resources = () => ({ BIZUDGothic: font, ZapfDingbats: fallback })
function edit(kind: MeasureKind, points = vertices[kind], pageIndex = 0): AnnotationEdit {
  const measure = { ...scale, kind }
  return { kind: 'createMeasure', pageIndex, vertices: points, measure, text: measureText(points, measure), color: [1, 0, 0], borderWidth: 1, fontSize: 10.5, opacity: 1 }
}
function reopen(doc: PDFDocument): PDFDocument {
  const buffer = doc.saveToBuffer('compress,garbage=4')
  try { return new mupdf.PDFDocument(buffer.asUint8Array()) } finally { buffer.destroy() }
}
function lines(page: PDFPage) {
  const result: Array<{ text: string; bbox: Rect; dir: Point; sizes: number[] }> = []
  const display = page.toDisplayList(true)
  const text = display.toStructuredText('preserve-whitespace')
  let line: typeof result[number]
  try {
    text.walk({ beginLine: (bbox, _mode, dir) => { line = { text: '', bbox, dir, sizes: [] }; result.push(line) }, onChar: (c, _origin, _font, size) => { line.text += c; line.sizes.push(size) } })
    return result
  } finally { text.destroy(); display.destroy() }
}
function redPixels(page: PDFPage, rect: Rect): number {
  const pixmap = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true)
  try {
    const pixels = pixmap.getPixels(), n = pixmap.getNumberOfComponents(), width = pixmap.getWidth()
    let count = 0
    for (let y = Math.max(0, Math.floor(rect[1] * 2)); y < Math.min(pixmap.getHeight(), Math.ceil(rect[3] * 2)); y++)
      for (let x = Math.max(0, Math.floor(rect[0] * 2)); x < Math.min(width, Math.ceil(rect[2] * 2)); x++) {
        const i = (y * width + x) * n
        if (pixels[i] > 150 && pixels[i + 1] < 120 && pixels[i + 2] < 120) count++
      }
    return count
  } finally { pixmap.destroy() }
}

describe('計測のPDF結果', () => {
  it('3種類の辞書・頂点・値・ページ縮尺が保存して開き直して戻る', () => {
    const doc = new mupdf.PDFDocument(source)
    try {
      expect(applyEdits(doc, [edit('distance'), edit('perimeter'), edit('area'), { kind: 'setPageScale', pageIndex: 0, scale }], resources()).errors).toEqual([])
      const saved = reopen(doc)
      try {
        const info = listAnnotations(saved, 0).filter(a => a.measure)
        expect(info.map(a => a.kind)).toEqual(['distance', 'perimeter', 'area'])
        expect(info.map(a => a.contents)).toEqual(['2,540 mm', '合計 5,080 mm', '6.45 m²'])
        const page = saved.loadPage(0)
        try {
          expect(readPageScale(page)).toEqual(scale)
          const vp = page.getObject(), bbox = vp.get('VP', 0, 'BBox')
          try { expect(bbox.asJS()).toEqual([0, 0, 595, 842]) } finally { bbox.destroy(); vp.destroy() }
          const annotations = page.getAnnotations().filter(a => ['Line', 'PolyLine', 'Polygon'].includes(a.getType()))
          annotations.forEach((a, i) => {
            const obj = a.getObject(), kind = info[i].kind as MeasureKind
            const it = obj.get('IT'), x = obj.get('Measure', 'X', 0, 'C'), d = obj.get('Measure', 'D', 0, 'C'), area = obj.get('Measure', 'A', 0, 'C'), json = obj.get('KaruMeasure'), subtype = obj.get('Measure', 'Subtype'), ap = obj.get('AP', 'N')
            try {
              expect(it.asName()).toBe(['LineDimension', 'PolyLineDimension', 'PolygonDimension'][i])
              expect(info[i].vertices).toEqual(vertices[kind])
              expect(subtype.asName()).toBe('RL')
              expect(x.asNumber()).toBeCloseTo(35.2777777778, 4)
              expect(d.asNumber()).toBe(1); expect(area.asNumber()).toBeCloseTo(1e-6, 10)
              expect(JSON.parse(json.asString())).toMatchObject({ kind, unit: 'mm', mmPerPoint: scale.mmPerPoint, decimals: null })
              expect(ap.isStream()).toBe(true)
              const fonts = ap.get('Resources', 'Font')
              let subset = false
              try {
                fonts.forEach(reference => {
                  const file = reference.get('DescendantFonts', 0, 'FontDescriptor', 'FontFile2')
                  try { if (file.isStream()) { const buffer = file.readStream(); try { expect(buffer.length).toBeLessThan(200 * 1024); subset = true } finally { buffer.destroy() } } }
                  finally { file.destroy(); reference.destroy() }
                })
                expect(subset).toBe(true)
              } finally { fonts.destroy() }
            } finally { it.destroy(); x.destroy(); d.destroy(); area.destroy(); json.destroy(); subtype.destroy(); ap.destroy(); obj.destroy(); a.destroy() }
          })
        } finally { page.destroy() }
      } finally { saved.destroy() }
    } finally { doc.destroy() }
  })
  it('標準辞書のみのViewportを読み、他社Viewportを保持して設定・削除する', () => {
    const doc = new mupdf.PDFDocument(source), page = doc.loadPage(0), obj = page.getObject(), vp = doc.newDictionary(), array = doc.newArray(), measure = createMeasureDictionary(doc, { ...scale, kind: 'distance' })
    try {
      vp.put('Measure', measure); vp.put('BBox', [0, 0, 595, 842]); array.push(vp); obj.put('VP', array)
      expect(readPageScale(page)?.mmPerPoint).toBeCloseTo(scale.mmPerPoint, 5)
      expect(applyEdits(doc, [{ kind: 'setPageScale', pageIndex: 0, scale }], resources()).errors).toEqual([])
      expect(obj.get('VP').length).toBe(2)
      expect(readPageScale(page)).toEqual(scale)
      expect(applyEdits(doc, [{ kind: 'setPageScale', pageIndex: 0, scale: null }], resources()).errors).toEqual([])
      expect(obj.get('VP').length).toBe(1)
      expect(readPageScale(page)?.source).toBe('standard')
    } finally { measure.destroy(); array.destroy(); vp.destroy(); obj.destroy(); page.destroy(); doc.destroy() }
  })
  it('他社の計測をContentsのまま読み、頂点編集で新しい値になる', () => {
    const doc = new mupdf.PDFDocument(source)
    try {
      expect(applyEdits(doc, [edit('distance')], resources()).errors).toEqual([])
      const page = doc.loadPage(0), a = page.getAnnotations().find(a => a.getType() === 'Line')!, o = a.getObject()
      try { o.delete('KaruMeasure'); a.setContents('他社の寸法表示') } finally { o.destroy(); a.destroy(); page.destroy() }
      const info = listAnnotations(doc, 0).find(a => a.kind === 'distance')!
      expect(info.contents).toBe('他社の寸法表示'); expect(info.measure?.mmPerPoint).toBeCloseTo(scale.mmPerPoint, 4)
      const e = edit('distance', [[100, 220], [244, 220]])
      expect(applyEdits(doc, [{ ...e, kind: 'updateMeasure', objNum: info.objNum } as AnnotationEdit], resources()).errors).toEqual([])
      expect(listAnnotations(doc, 0).find(a => a.kind === 'distance')?.contents).toBe('5,080 mm')
    } finally { doc.destroy() }
  })
  it('かるPDFの計測はKaruMeasureと頂点から値を再計算して読み込む', () => {
    const doc = new mupdf.PDFDocument(source)
    try {
      expect(applyEdits(doc, [edit('distance')], resources()).errors).toEqual([])
      const page = doc.loadPage(0), annotations = page.getAnnotations()
      try {
        const a = annotations.find(a => a.getType() === 'Line')!, obj = a.getObject(), value = doc.newString('古い値')
        try { obj.put('Contents', value) } finally { value.destroy(); obj.destroy() }
      } finally { annotations.forEach(a => a.destroy()); page.destroy() }
      expect(listAnnotations(doc, 0).find(a => a.kind === 'distance')?.contents).toBe('2,540 mm')
    } finally { doc.destroy() }
  })
  it.each([0, 90, 180, 270])('回転%s°で値の位置・向き・10.5ptのサイズと描画を確認する', async rotation => {
    const doc = new mupdf.PDFDocument(source)
    try {
      const obj = doc.findPage(0); try { obj.put('Rotate', rotation) } finally { obj.destroy() }
      expect(applyEdits(doc, [edit('distance'), edit('perimeter'), edit('area'), edit('distance', [[200, 550], [128, 478]])], resources()).errors).toEqual([])
      const saved = reopen(doc), page = saved.loadPage(0)
      try {
        const all = lines(page)
        for (const [text, center, yLimit] of [['2,540 mm', [136, 209], 12], ['合計 5,080 mm', [352, 361.5], 8], ['6.45 m²', [136, 436], 8]] as const) {
          const line = all.find(l => l.text === text)
          expect(line, JSON.stringify(all)).toBeDefined()
          expect(line!.dir[0]).toBeCloseTo(1, 5); expect(line!.dir[1]).toBeCloseTo(0, 5)
          expect((line!.bbox[0] + line!.bbox[2]) / 2).toBeCloseTo(center[0], 0)
          expect(Math.abs((line!.bbox[1] + line!.bbox[3]) / 2 - center[1])).toBeLessThan(yLimit)
          expect(line!.bbox[3] - line!.bbox[1]).toBeGreaterThan(5); expect(line!.bbox[3] - line!.bbox[1]).toBeLessThan(16)
          expect(line!.sizes.every(s => Math.abs(s - 10.5) < .01)).toBe(true)
          expect(redPixels(page, line!.bbox)).toBeGreaterThan(40)
        }
        const diagonal = all.find(l => l.text === '3,592 mm')!
        expect(diagonal.dir[0]).toBeCloseTo(Math.SQRT1_2, 5); expect(diagonal.dir[1]).toBeCloseTo(Math.SQRT1_2, 5)
        expect(Math.abs((diagonal.bbox[0] + diagonal.bbox[2]) / 2 - 171.69)).toBeLessThan(5)
        expect(Math.abs((diagonal.bbox[1] + diagonal.bbox[3]) / 2 - 506.31)).toBeLessThan(5)
        expect(redPixels(page, [110, 218, 120, 222])).toBeGreaterThan(15)
        if (process.env.KARU_MEASURE_VISUAL === '1') {
          const directory = path.resolve('tests/.measure-preview'); await fs.mkdir(directory, { recursive: true })
          const pixmap = page.toPixmap(mupdf.Matrix.scale(1.5, 1.5), mupdf.ColorSpace.DeviceRGB, false, true)
          try { await fs.writeFile(path.join(directory, `rotation-${rotation}.png`), pixmap.asPNG()) } finally { pixmap.destroy() }
        }
      } finally { page.destroy(); saved.destroy() }
    } finally { doc.destroy() }
  })
  it('CropBox・UserUnitを含むページでも見えている座標と標準換算係数が往復する', () => {
    const doc = new mupdf.PDFDocument(source)
    try {
      const obj = doc.findPage(0)
      try { obj.put('CropBox', [50, 50, 400, 600]); obj.put('UserUnit', 2); obj.put('Rotate', 90) } finally { obj.destroy() }
      expect(applyEdits(doc, [edit('distance'), { kind: 'setPageScale', pageIndex: 0, scale }], resources()).errors).toEqual([])
      const saved = reopen(doc), page = saved.loadPage(0)
      try {
        const a = listAnnotations(saved, 0).find(a => a.kind === 'distance')!
        expect(a.vertices).toEqual(vertices.distance)
        expect(readPageScale(page)).toEqual(scale)
        const label = lines(page).find(l => l.text === '2,540 mm')!
        expect(label.dir).toEqual([1, 0]); expect((label.bbox[0] + label.bbox[2]) / 2).toBeCloseTo(136, 0)
        expect(label.sizes.every(n => Math.abs(n - 10.5) < .01)).toBe(true)
        const pageObject = page.getObject(), x = pageObject.get('VP', 0, 'Measure', 'X', 0, 'C')
        try { expect(x.asNumber()).toBeCloseTo(scale.mmPerPoint * 2, 4) } finally { x.destroy(); pageObject.destroy() }
      } finally { page.destroy(); saved.destroy() }
    } finally { doc.destroy() }
  })
  it('元のページ内容と既存の書き込みの文字・大きさ・ピクセルが残る', () => {
    const doc = new mupdf.PDFDocument(source)
    try {
      expect(applyEdits(doc, [{ kind: 'createFreeText', pageIndex: 0, rect: [300, 80, 470, 112], text: '既存の書き込み', fontSize: 10.5, font: 'BIZUDGothic', color: [0, 0, 1] }], resources()).errors).toEqual([])
      const beforePage = doc.loadPage(0), before = beforePage.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true)
      const beforePixels = Uint8Array.from(before.getPixels())
      before.destroy(); beforePage.destroy()
      expect(applyEdits(doc, [edit('distance'), edit('perimeter'), edit('area')], resources()).errors).toEqual([])
      const saved = reopen(doc), page = saved.loadPage(0), after = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true)
      try {
        const all = lines(page)
        expect(all.map(l => l.text).join('\n')).toContain('Sample page 1')
        const existing = all.find(l => l.text === '既存の書き込み')!
        expect(existing.sizes.every(s => Math.abs(s - 10.5) < .01)).toBe(true)
        expect(existing.bbox[0]).toBeGreaterThanOrEqual(300); expect(existing.bbox[2]).toBeLessThan(470)
        const pixels = after.getPixels(), width = after.getWidth(), components = after.getNumberOfComponents()
        // Entire original header, including the existing annotation, is above the measurements.
        expect(Uint8Array.from(pixels.slice(0, width * 130 * components))).toEqual(beforePixels.slice(0, width * 130 * components))
      } finally { after.destroy(); page.destroy(); saved.destroy() }
    } finally { doc.destroy() }
  })
})
