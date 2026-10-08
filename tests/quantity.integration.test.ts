import fs from 'node:fs/promises'
import mupdf, { type PDFDocument } from 'mupdf'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { applyEdits, listAnnotations, type AnnotationEdit, type Point } from '../src/core/annotations'
import { createFontResource, type FontResource } from '../src/core/fontMetrics'
import { nextCountStyle, readCountFixtures, type CountFixture } from '../src/core/countFixtures'
import { quantityLabel, parseQuantityMark, serializeQuantityMark, type QuantityMark } from '../src/core/quantity'
import { applyPageLayout } from '../src/core/pageOps'
import { AnnotationStore } from '../src/editor/AnnotationStore'

let font: FontResource
beforeAll(async () => { font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf'))) })
afterAll(() => font.font.destroy())
const fixture: CountFixture = { id: 'cv', kind: 'length', method: 'polyline', defaults: { addM: 3 }, line: { width: 2, dash: 'dashed' }, name: 'ケーブル（CV）', code: 'CV', category: '電線・ケーブル', order: 0, style: { ...nextCountStyle([]), size: 12 } }
const points: Point[] = [[100, 220], [365.03937007874015, 220]]
const measure = { kind: 'perimeter' as const, unit: 'mm' as const, decimals: null, mmPerPoint: 25.4 / 72 * 100 }
function edit(addM?: number): Extract<AnnotationEdit, { kind: 'createMeasure' }> {
  const quantity: QuantityMark = { version: 1, id: addM ? 'plus' : 'plan', itemId: 'cv', method: 'polyline', ...(addM ? { addM } : {}) }
  return { kind: 'createMeasure', pageIndex: 0, vertices: points, measure, quantity, quantityDash: 'dashed', text: quantityLabel(points, measure.mmPerPoint, quantity, 'CV', true), color: fixture.style.color, fontSize: 12, borderWidth: 2, opacity: .8 }
}
function blank() {
  const doc = new mupdf.PDFDocument()
  for (let i = 0; i < 2; i++) { const p = doc.addPage([0, 0, 595, 842], 0, {}, ''); try { doc.insertPage(-1, p) } finally { p.destroy() } }
  return doc
}
function reopen(doc: PDFDocument) {
  const buffer = doc.saveToBuffer('compress,garbage=4')
  try { return new mupdf.PDFDocument(buffer.asUint8Array()) } finally { buffer.destroy() }
}
it('round-trips measurement metadata, quantity labels, dashed appearances and catalog', () => {
  const doc = blank()
  try {
    expect(applyEdits(doc, [{ kind: 'setCountFixtures', pageIndex: 0, fixtures: [fixture] }, edit(), edit(3)], { BIZUDGothic: font }).errors).toEqual([])
    const saved = reopen(doc)
    try {
      expect(readCountFixtures(saved)).toEqual([fixture])
      const info = listAnnotations(saved, 0)
      expect(info.map(a => a.contents)).toEqual(['CV 9.35 m', 'CV 9.35+3.00=12.35 m'])
      for (const a of info) a.vertices!.forEach((p, i) => p.forEach((n, j) => expect(n).toBeCloseTo(points[i][j], 4)))
      expect(info.map(a => a.quantity?.addM)).toEqual([undefined, 3])
      expect(info.every(a => a.quantityDash === 'dashed' && a.measure?.kind === 'perimeter')).toBe(true)
      const page = saved.loadPage(0), annotations = page.getAnnotations()
      try {
        for (const a of annotations) {
          const object = a.getObject()
          try {
            for (const key of ['Measure', 'KaruMeasure', 'KaruQuantity']) { const v = object.get(key); try { expect(v.isNull()).toBe(false) } finally { v.destroy() } }
            const intent = object.get('IT'), ap = object.get('AP', 'N')
            try {
              expect(intent.asName()).toBe('PolyLineDimension')
              const stream = ap.readStream(); try { expect(stream.asString()).toMatch(/\[\s*[\d.]+[\d.\s]*\]\s+[\d.]+\s+d\b/) } finally { stream.destroy() }
            } finally { intent.destroy(); ap.destroy() }
            const display = a.toDisplayList(), text = display.toStructuredText('preserve-whitespace')
            try { let contents = ''; text.walk({ onChar: c => { contents += c } }); expect(contents).toBe(a.getContents()) } finally { text.destroy(); display.destroy() }
          } finally { object.destroy() }
        }
      } finally { annotations.forEach(a => a.destroy()); page.destroy() }
    } finally { saved.destroy() }
  } finally { doc.destroy() }
})
it('saves vertex/addition edits through the store and preserves quantities when pages reorder', async () => {
  const doc = blank(), store = new AnnotationStore()
  try {
    expect(applyEdits(doc, [{ kind: 'setCountFixtures', pageIndex: 0, fixtures: [fixture] }, edit(3)], { BIZUDGothic: font }).errors).toEqual([])
    await store.ensurePageLoaded(0, async () => listAnnotations(doc, 0))
    expect(store.countOverlayObjNums(0)).toEqual([])
    expect(store.fixturesReady).toBe(false)
    await store.ensureCountFixtures(async () => readCountFixtures(doc), async () => {})
    const a = store.getPageAnnotations(0)[0]
    expect(store.isDirty()).toBe(false)
    expect(store.quantityText(a)).toBe('CV 9.35+3.00=12.35 m')
    expect(store.countOverlayObjNums(0)).toEqual([a.objNum])
    store.updateMeasureVertices(a.id, [[100, 220], [172, 220]])
    store.updateQuantityAdd(a.id, 4)
    expect(applyEdits(doc, store.toEdits(), { BIZUDGothic: font }).errors).toEqual([])
    applyPageLayout('main', doc, [1, 0].map(pageIndex => ({ id: String(pageIndex), source: { kind: 'page' as const, docId: 'main', pageIndex }, rotation: 0 })), new Map())
    const saved = reopen(doc)
    try {
      expect(readCountFixtures(saved)).toEqual([fixture])
      expect(listAnnotations(saved, 0)).toEqual([])
      const [q] = listAnnotations(saved, 1)
      expect(q.contents).toBe('CV 2.54+4.00=6.54 m')
      expect(q.quantity).toMatchObject({ addM: 4, itemId: 'cv', id: 'plus' })
      expect(q.vertices).toEqual([[100, 220], [172, 220]])
    } finally { saved.destroy() }
  } finally { doc.destroy() }
})
it('falls back to ordinary measurement for malformed quantity metadata', () => {
  const doc = blank()
  try {
    applyEdits(doc, [edit()], { BIZUDGothic: font })
    const page = doc.loadPage(0), [a] = page.getAnnotations(), object = a.getObject(), raw = doc.newString('{')
    try { object.put('KaruQuantity', raw) } finally { raw.destroy(); object.destroy(); a.destroy(); page.destroy() }
    expect(listAnnotations(doc, 0)[0].quantity).toBeNull()
    expect(listAnnotations(doc, 0)[0].measure?.kind).toBe('perimeter')
  } finally { doc.destroy() }
})

const areaVolumeCases: Array<{ method: QuantityMark['method']; values: Partial<QuantityMark>; text: string }> = [
 { method: 'polygon', values: {}, text: 'Q 6.45 m²' },
 { method: 'lengthHeight', values: { heightM: 3.5 }, text: 'Q 2.54×H3.50=8.89 m²' },
 { method: 'polygonDepth', values: { depthM: 1.2 }, text: 'Q 6.45×D1.20=7.74 m³' },
 { method: 'lengthWidthDepth', values: { widthM: .6, depthM: .8 }, text: 'Q 2.54×W0.60×D0.80=1.22 m³' },
]
function areaVolumeFixture(c: typeof areaVolumeCases[number], i: number): CountFixture {
 return { ...fixture, id: c.method, code: 'Q', kind: c.method === 'polygon' || c.method === 'lengthHeight' ? 'area' : 'volume', method: c.method, defaults: undefined, order: i }
}
function areaVolumeEdit(c: typeof areaVolumeCases[number]): AnnotationEdit {
 const polygon = c.method === 'polygon' || c.method === 'polygonDepth'
 const vertices: Point[] = polygon ? [[100,220],[172,220],[172,292],[100,292]] : [[100,220],[172,220]]
 const quantity: QuantityMark = { version: 1, id: c.method, itemId: c.method, method: c.method, ...c.values }
 return { ...edit(), kind: 'createMeasure', vertices, quantity, measure: { ...measure, kind: polygon ? 'area' : 'perimeter' }, text: c.text }
}
it('round-trips all four area/volume methods, vertices, dimensions, intent and filled/dashed text appearances', () => {
 const doc = blank()
 try {
  const fixtures = areaVolumeCases.map(areaVolumeFixture)
  expect(applyEdits(doc, [{ kind: 'setCountFixtures', pageIndex: 0, fixtures }, ...areaVolumeCases.map(areaVolumeEdit)], { BIZUDGothic: font }).errors).toEqual([])
  const saved = reopen(doc)
  try {
   expect(readCountFixtures(saved)).toEqual(fixtures)
   const infos = listAnnotations(saved, 0)
   expect(infos.map(a => a.contents)).toEqual(areaVolumeCases.map(c => c.text))
   const page = saved.loadPage(0), annotations = page.getAnnotations()
   try {
    annotations.forEach((a, i) => {
     const c = areaVolumeCases[i], expected = areaVolumeEdit(c)
     const polygon = c.method === 'polygon' || c.method === 'polygonDepth'
     expect(a.getType()).toBe(polygon ? 'Polygon' : 'PolyLine')
     expect(infos[i].vertices).toEqual('vertices' in expected ? expected.vertices : [])
     expect(infos[i].quantity).toMatchObject({ method: c.method, ...c.values })
     expect(infos[i].measure?.kind).toBe(polygon ? 'area' : 'perimeter')
     expect(infos[i].quantityDash).toBe('dashed')
     const object = a.getObject(), intent = object.get('IT'), raw = object.get('KaruQuantity'), ap = object.get('AP','N'), stream = ap.readStream()
     try {
      expect(intent.asName()).toBe(polygon ? 'PolygonDimension' : 'PolyLineDimension')
      expect(JSON.parse(raw.asString())).toMatchObject({ method: c.method, ...c.values })
      expect(stream.asString()).toMatch(/\[\s*12\s+6\s*\]\s+0\s+d\b/)
      expect(stream.asString().match(/\bf\b/g)).toHaveLength(polygon ? 2 : 1)
     } finally { stream.destroy(); ap.destroy(); raw.destroy(); intent.destroy(); object.destroy() }
     const display = a.toDisplayList(), text = display.toStructuredText('preserve-whitespace')
     try { let contents = ''; text.walk({ onChar: char => { contents += char } }); expect(contents).toBe(c.text) } finally { text.destroy(); display.destroy() }
    })
   } finally { annotations.forEach(a => a.destroy()); page.destroy() }
  } finally { saved.destroy() }
 } finally { doc.destroy() }
})
it('edits depth, validates dimensions, supports Undo and saves changed Contents and KaruQuantity', async () => {
 const doc = blank(), store = new AnnotationStore(), c = areaVolumeCases[2]
 try {
  applyEdits(doc, [{ kind: 'setCountFixtures', pageIndex: 0, fixtures: [areaVolumeFixture(c, 0)] }, areaVolumeEdit(c)], { BIZUDGothic: font })
  await store.ensurePageLoaded(0, async () => listAnnotations(doc, 0))
  await store.ensureCountFixtures(async () => readCountFixtures(doc), async () => {})
  const a = store.getPageAnnotations(0)[0]
  for (const values of [{ depthM: -1 }, { depthM: 1001 }, { depthM: .123 }, { depthM: NaN }, { widthM: 1 }, { depthM: 2, heightM: 1 }]) store.updateQuantityValues(a.id, values)
  expect(store.get(a.id)?.text).toBe(c.text)
  store.updateQuantityValues(a.id, { depthM: 2 })
  expect(store.get(a.id)?.text).toBe('Q 6.45×D2.00=12.90 m³')
  expect(store.countTotals().get(c.method)?.get(0)).toBeCloseTo(12.9032)
  store.undo(); expect(store.get(a.id)?.text).toBe(c.text)
  store.updateQuantityValues(a.id, { depthM: 2 })
  expect(applyEdits(doc, store.toEdits(), { BIZUDGothic: font }).errors).toEqual([])
  const saved = reopen(doc)
  try {
   const [info] = listAnnotations(saved,0)
   expect(info.contents).toBe('Q 6.45×D2.00=12.90 m³')
   expect(info.quantity).toMatchObject({ depthM: 2, method: 'polygonDepth' })
   expect(readCountFixtures(saved)[0].defaults).toBeUndefined()
  } finally { saved.destroy() }
 } finally { doc.destroy() }
})

it('round-trips specifications, aggregation, mark locations and all items of a shared route', async () => {
 const fixtures:CountFixture[]=[{...fixture,spec:'38sq-3C',aggregation:'document'}, {...fixture,id:'em',code:'EM-CE',spec:'5.5sq-3C',aggregation:'location',order:1}, {...fixture,id:'led',code:'LED',name:'照明器具',spec:'300W',kind:undefined,method:undefined,defaults:undefined,line:undefined,aggregation:'location',order:2}]
 const q:QuantityMark={version:1,id:'route',itemId:'cv',method:'polyline',addM:3,count:2,extra:[{itemId:'em',count:1}],floor:'B1階',room:'電気室'}
 const route={...edit(3),quantity:q,text:quantityLabel(points,measure.mmPerPoint,q,'CV 38sq-3C',true,()=> 'EM-CE 5.5sq-3C')}
 const count={version:2 as const,id:'led-mark',fixtureId:'led',floor:'1階',room:'事務室'}
 const doc=blank()
 try {
  expect(applyEdits(doc,[{kind:'setCountFixtures',pageIndex:0,fixtures},route,{kind:'createSymbol',pageIndex:1,rect:[100,100,110,110],symbol:'circle',color:[1,0,0],count,countFixture:fixtures[2]}],{BIZUDGothic:font}).errors).toEqual([])
  const saved=reopen(doc)
  try {
   expect(readCountFixtures(saved)).toEqual(fixtures)
   const info=listAnnotations(saved,0);expect(info[0].quantity).toEqual({ ...q, cond: {}, rises: [{ m: 3 }], extra: [{ itemId: 'em', count: 1, cond: {} }] });expect(info[0].contents).toBe(route.text)
   expect(listAnnotations(saved,1)[0].count).toEqual(count)
   const store=new AnnotationStore();await store.ensureCountFixtures(async()=>readCountFixtures(saved),async()=>{for(let p=0;p<2;p++)await store.ensurePageLoaded(p,async()=>listAnnotations(saved,p))})
   expect(store.quantityIndex().total('cv')).toBeCloseTo(24.7);expect(store.quantityIndex().total('em')).toBeCloseTo(12.35)
   expect(store.quantityIndex().byFloorRoom('led').get('1階')?.get('事務室')).toBe(1)
   const page=saved.loadPage(0),annots=page.getAnnotations(),object=annots[0].getObject(), raw=object.get('KaruQuantity')
   try {expect(JSON.parse(raw.asString())).toEqual(q)}finally{raw.destroy();object.destroy();annots.forEach(a=>a.destroy());page.destroy()}
  } finally {saved.destroy()}
 }finally{doc.destroy()}
})
it('opens old fields unchanged, edits metadata and saves another compatible PDF', async () => {
 const doc=blank(), oldCount={version:2 as const,id:'old',fixtureId:'led'}, led:CountFixture={id:'led',code:'LED',name:'器具',category:'照明',order:1,style:nextCountStyle([])}
 try {
  expect(applyEdits(doc,[{kind:'setCountFixtures',pageIndex:0,fixtures:[fixture,led]},edit(),{kind:'createSymbol',pageIndex:1,rect:[100,100,110,110],color:[1,0,0],symbol:'circle',count:oldCount,countFixture:led}],{BIZUDGothic:font}).errors).toEqual([])
  const old=reopen(doc)
  try {
   const store=new AnnotationStore();await store.ensureCountFixtures(async()=>readCountFixtures(old),async()=>{for(let p=0;p<2;p++)await store.ensurePageLoaded(p,async()=>listAnnotations(old,p))})
   expect(store.quantityIndex().total('cv')).toBeCloseTo(9.35);expect(store.quantityIndex().total('led')).toBe(1)
   const ids=[0,1].flatMap(p=>store.getPageAnnotations(p).map(a=>a.id));store.updatePickupLocation(ids,'floor','1F')
   const edits=store.toEdits();expect(applyEdits(old,edits,{BIZUDGothic:font}).errors).toEqual([])
   const saved=reopen(old)
   try {expect(listAnnotations(saved,0)[0].quantity?.floor).toBe('1階');expect(listAnnotations(saved,1)[0].count).toMatchObject({...oldCount,floor:'1階'});expect(readCountFixtures(saved)).toEqual([fixture,led])}finally{saved.destroy()}
  }finally{old.destroy()}
 }finally{doc.destroy()}
})

it('saves scoped routes as version 1 JSON, Contents and exact item totals after reopening', async () => {
 const pf: CountFixture = { ...fixture, id: 'pf', name: '立上り電線管', code: 'PF28', order: 1, routeScope: 'rise', defaults: { addM: 3, slackM: 1 } }
 const rack: CountFixture = { ...fixture, id: 'rack', code: 'CR', order: 2, routeScope: 'noSlack' }
 const fixtures = [{ ...fixture, spec: '38sq-3C' }, pf, rack]
 const q: QuantityMark = { version: 1, id: 'route', itemId: 'cv', method: 'polyline', addM: 3, slackM: 1, count: 2, extra: [{ itemId: 'pf', count: 1, cond: { plan: null, slack: null } }, { itemId: 'rack', count: 1, cond: { slack: null } }] }
 const text = quantityLabel(points, measure.mmPerPoint, q, 'CV 38sq-3C', true, id => id === 'pf' ? 'PF28' : 'CR')
 const doc = blank()
 try {
  expect(applyEdits(doc, [{ kind: 'setCountFixtures', pageIndex: 0, fixtures }, { ...edit(), quantity: q, text }, { ...edit(3), pageIndex: 1 }], { BIZUDGothic: font }).errors).toEqual([])
  const saved = reopen(doc)
  try {
   expect(readCountFixtures(saved)).toEqual(fixtures)
   const info = listAnnotations(saved, 0)[0]
   expect(info.quantity).toEqual({ ...q, cond: {}, rises: [{ m: 3 }] })
   expect(info.contents).toBe('CV 38sq-3C×2, PF28（立上り）, CR  9.35+3.00+余1.00=13.35 m')
   const store = new AnnotationStore()
   await store.ensureCountFixtures(async () => readCountFixtures(saved), async () => { await store.ensurePageLoaded(0, async () => listAnnotations(saved, 0)) })
   expect(store.quantityIndex().total('cv')).toBeCloseTo(26.7)
   expect(store.quantityIndex().total('pf')).toBe(3)
   expect(store.quantityIndex().total('rack')).toBeCloseTo(12.35)
   // A legacy addM-only mark in the same PDF keeps its original quantity and text.
   const old = listAnnotations(saved, 1)[0]
   expect(old.quantity).toEqual({ version: 1, id: 'plus', itemId: 'cv', method: 'polyline', addM: 3, cond: {}, rises: [{ m: 3 }] })
   expect(old.contents).toBe('CV 9.35+3.00=12.35 m')
   const page = saved.loadPage(0), annotations = page.getAnnotations(), object = annotations[0].getObject(), raw = object.get('KaruQuantity'), contents = object.get('Contents')
   try {
    expect(JSON.parse(raw.asString())).toEqual({ version: 1, id: 'route', itemId: 'cv', method: 'polyline', addM: 3, slackM: 1, count: 2, extra: [{ itemId: 'pf', count: 1, cond: { plan: null, slack: null }, scope: 'rise' }, { itemId: 'rack', count: 1, cond: { slack: null }, scope: 'noSlack' }] })
    expect(contents.asString()).toBe(text)
   } finally { contents.destroy(); raw.destroy(); object.destroy(); annotations.forEach(a => a.destroy()); page.destroy() }
   store.updateRoute(store.getPageAnnotations(0)[0].id, 2, q.extra!, 'rise')
   expect(applyEdits(saved, store.toEdits(), { BIZUDGothic: font }).errors).toEqual([])
   const again = reopen(saved)
   try {
    expect(listAnnotations(again, 0)[0].quantity).toMatchObject({ cond: { plan: null, slack: null }, slackM: 1, extra: q.extra })
    expect(listAnnotations(again, 0)[0].contents).toContain('CV 38sq-3C（立上り）×2')
   } finally { again.destroy() }
  } finally { saved.destroy() }
 } finally { doc.destroy() }
})

it('saves and reloads per-rise conditions, excluded portions, area/count conditions and clean baselines', async () => {
 const led: CountFixture = { ...fixture, id: 'led', kind: 'count', method: 'click', defaults: undefined, line: undefined, order: 1 }
 const area: CountFixture = { ...fixture, id: 'area', kind: 'area', method: 'polygon', defaults: undefined, order: 2 }
 const q = parseQuantityMark(JSON.stringify({ version: 1, id: 'conditions', itemId: 'cv', method: 'polyline', count: 2, rises: [{ m: 2, at: 0 }, { m: 0 }], slackM: 1, cond: { plan: 'ラック', rise: ['管内', null], slack: null } }))!
 q.cond!.rise = ['管内', undefined]
 const polygon: QuantityMark = { version: 1, id: 'area', itemId: 'area', method: 'polygon', condition: '屋外' }
 const count = { version: 2 as const, id: 'led', fixtureId: 'led', condition: '壁付' }
 const doc = blank()
 try {
  expect(applyEdits(doc, [{ kind: 'setCountFixtures', pageIndex: 0, fixtures: [fixture, led, area] },
   { ...edit(), quantity: q, text: quantityLabel(points, measure.mmPerPoint, q, 'CV', true) },
   { ...edit(), vertices: [[0, 0], [10, 0], [10, 10], [0, 10]], measure: { ...measure, kind: 'area' }, quantity: polygon },
   { kind: 'createSymbol', pageIndex: 1, rect: [100, 100, 110, 110], symbol: 'circle', color: [1, 0, 0], count, countFixture: led }
  ], { BIZUDGothic: font }).errors).toEqual([])
  const saved = reopen(doc)
  try {
   expect(listAnnotations(saved, 0)[0].quantity).toStrictEqual(q)
   expect(listAnnotations(saved, 0)[1].quantity).toStrictEqual(polygon)
   expect(listAnnotations(saved, 1)[0].count).toStrictEqual(count)
   const store = new AnnotationStore()
   await store.ensureCountFixtures(async () => readCountFixtures(saved), async () => {
    for (let p = 0; p < 2; p++) await store.ensurePageLoaded(p, async () => listAnnotations(saved, p))
   })
   expect(store.isDirty()).toBe(false)
   const id = store.getPageAnnotations(0)[0].id
   // The zero rise keeps its quantity/text, yet null versus unset must affect dirty state/history.
   store.setRouteCondition([id], 'cv', 'rise', null, 1)
   expect(store.isDirty()).toBe(true)
   store.undo(); expect(store.isDirty()).toBe(false)
   store.redo(); expect(store.isDirty()).toBe(true)
   const expected = store.get(id)!.quantity!
   expect(parseQuantityMark(serializeQuantityMark(expected))).toStrictEqual(expected)
   const edits = store.toEdits(), result = applyEdits(saved, edits, { BIZUDGothic: font })
   expect(result.errors).toEqual([]); store.markApplied(result)
   expect(store.isDirty()).toBe(false)
   const again = reopen(saved)
   try {
    expect(listAnnotations(again, 0)[0].quantity).toStrictEqual(expected)
    expect(listAnnotations(again, 0)[1].quantity!.condition).toBe('屋外')
    expect(listAnnotations(again, 1)[0].count).toMatchObject({ condition: '壁付' })
   } finally { again.destroy() }
  } finally { saved.destroy() }
 } finally { doc.destroy() }
})
