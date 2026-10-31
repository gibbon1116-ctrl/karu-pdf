import { describe, expect, it } from 'vitest'
import { parseQuantityMark, quantityLabel, quantityPoints, quantityValue, type QuantityMark } from '../src/core/quantity'
import type { Point } from '../src/core/annotations'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'

const mark = (method: QuantityMark['method'], values = {}): QuantityMark => ({ version: 1, id: 'mark', itemId: 'cv', method, ...values })
const square: Point[] = [[0, 0], [4, 0], [4, 3], [0, 3]]
describe('quantity calculations and parsing', () => {
  it('shows unknown dimensions in previews without guessing a result', () => {
    const line: Point[] = [[0, 0], [24, 0]]
    expect(quantityLabel(line, 1000, mark('lengthHeight'), '外部足場', true)).toBe('外部足場 24.00×H?=? m²')
    expect(quantityLabel(square, 1000, mark('polygonDepth'), '根切り', true)).toBe('根切り 12.00×D?=? m³')
    expect(quantityLabel(line, 1000, mark('lengthWidthDepth', { widthM: .6 }), '', false)).toBe('24.00×W0.60×D?=? m³')
    expect(quantityLabel(line, 1000, mark('lengthHeight', { heightM: 0 }), '', false)).toBe('24.00×H0.00=0.00 m²')
  })
  it('uses scale without rounding, including additions and every non-click method', () => {
    const p: Point[] = [[0, 0], [72, 0]], scale = 25.4 / 72 * 100
    expect(quantityValue(p, scale, mark('polyline'))).toBeCloseTo(2.54)
    expect(quantityValue(p, scale, mark('polyline', { addM: 3 }))).toBeCloseTo(5.54)
    expect(quantityValue(square, 1000, mark('polygon'))).toBe(12)
    expect(quantityValue([[0, 0], [24, 0]], 1000, mark('lengthHeight', { heightM: 3.5 }))).toBe(84)
    expect(quantityValue(square, 1000, mark('polygonDepth', { depthM: 1.2 }))).toBeCloseTo(14.4)
    expect(quantityValue([[0, 0], [10, 0]], 1000, mark('lengthWidthDepth', { widthM: .6, depthM: .8 }))).toBeCloseTo(4.8)
    const l: Point[] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]
    expect(quantityValue(l, 1000, mark('polygon'))).toBe(3)
    expect(quantityValue([...l].reverse(), 1000, mark('polygonDepth', { depthM: 2 }))).toBe(6)
    expect(quantityPoints('polygonDepth')).toBe('polygon')
    expect(quantityPoints('lengthHeight')).toBe('polyline')
  })
  it('formats the six label examples with fixed decimals, grouping and optional code', () => {
    const label = (p: Point[], m: QuantityMark, code: string, show = true) => quantityLabel(p, 1000, m, code, show)
    expect(label([[0, 0], [12.345, 0]], mark('polyline'), 'CV')).toBe('CV 12.35 m')
    expect(label([[0, 0], [9.35, 0]], mark('polyline', { addM: 3 }), 'CV')).toBe('CV 9.35+3.00=12.35 m')
    expect(label([[0, 0], [8, 0], [8, 6], [0, 6]], mark('polygon'), '内部足場')).toBe('内部足場 48.00 m²')
    expect(label([[0, 0], [24, 0]], mark('lengthHeight', { heightM: 3.5 }), '外部足場')).toBe('外部足場 24.00×H3.50=84.00 m²')
    expect(label(square, mark('polygonDepth', { depthM: 1.2 }), '根切り')).toBe('根切り 12.00×D1.20=14.40 m³')
    expect(label([[0, 0], [10, 0]], mark('lengthWidthDepth', { widthM: .6, depthM: .8 }), '溝掘削')).toBe('溝掘削 10.00×W0.60×D0.80=4.80 m³')
    expect(label([[0, 0], [1234.567, 0]], mark('polyline', { addM: 0 }), 'CV', false)).toBe('1,234.57 m')
  })
  it('rejects malformed, unknown and out of range metadata', () => {
    const good = mark('polyline', { addM: 3 })
    expect(parseQuantityMark(JSON.stringify(good))).toEqual({ ...good, cond: {}, rises: [{ m: 3 }] })
    for (const raw of [null, '{', ' '.repeat(401), JSON.stringify({ ...good, version: 2 }), JSON.stringify({ ...good, id: '' }), JSON.stringify({ ...good, itemId: 'x'.repeat(81) }), JSON.stringify({ ...good, method: 'click' }), JSON.stringify({ ...good, method: 'unknown' })]) expect(parseQuantityMark(raw)).toBeNull()
    for (const key of ['addM', 'heightM', 'widthM', 'depthM']) for (const n of [-1, 1001, null, '3']) expect(parseQuantityMark(JSON.stringify({ ...good, [key]: n }))).toBeNull()
    expect(parseQuantityMark(JSON.stringify(mark('polyline', { addM: 1000 })))).not.toBeNull()
  })
})

it('keeps totals, edits, copy identities, styles and visibility in the existing store history', async () => {
  const store = new AnnotationStore()
  const f: CountFixture = { id: 'cv', name: 'ケーブル（CV）', code: 'CV', category: '電線・ケーブル', kind: 'length', style: nextCountStyle([]), order: 0, line: { width: 2, dash: 'dashed' } }
  const other = { ...f, id: 'cvt', code: 'CVT', order: 1 }
  await store.ensureCountFixtures(async () => [f, other], async () => {})
  const a = store.create({ pageIndex: 0, kind: 'perimeter', measure: { kind: 'perimeter', mmPerPoint: 25.4 / 72 * 100, unit: 'mm', decimals: null }, vertices: [[100, 200], [172, 200]], rect: [95, 180, 180, 220], quantity: mark('polyline'), quantityDash: 'dashed', text: 'CV 2.54 m' })
  expect(store.countTotals().get('cv')?.get(0)).toBeCloseTo(2.54)
  store.updateQuantityAdd(a.id, 3)
  expect(store.get(a.id)?.text).toBe('CV 2.54+3.00=5.54 m')
  store.undo(); expect(store.get(a.id)?.text).toBe('CV 2.54 m')
  store.updateMeasureVertices(a.id, [[100, 200], [244, 200]])
  expect(store.get(a.id)?.text).toBe('CV 5.08 m')
  store.reassignCounts([a.id], 'cvt'); expect(store.get(a.id)?.text).toBe('CVT 5.08 m')
  store.undo(); expect(store.get(a.id)?.quantity?.itemId).toBe('cv')
  store.selectOnly(a.id)
  const [copy] = store.pasteAnnotations(store.copySelected(), 0, { width: 500, height: 500 }, 10)
  expect(store.get(copy)?.quantity?.id).not.toBe('mark')
  expect(store.get(copy)?.quantityDash).toBe('dashed')
  expect(store.countTotals().get('cv')?.get(0)).toBeCloseTo(10.16)
  store.setFixtureVisible(['cv'], false); expect(store.isShownOnDrawing(store.get(a.id)!)).toBe(false)
  store.selectFixture('cv'); store.prepareCountTool(); expect(store.isShownOnDrawing(store.get(a.id)!)).toBe(true)
  store.setCountFixtures([{ ...f, code: 'C', style: { ...f.style, showCode: false } }, other])
  expect(store.get(a.id)?.text).toBe('5.08 m')
  store.undo(); expect(store.get(a.id)?.text).toBe('CV 5.08 m')
  expect(store.fixtureMarkCount('cv')).toBe(2)
  store.setCountFixtures([other], ['cv']); expect(store.get(a.id)).toBeUndefined()
  store.undo(); expect(store.countTotals().get('cv')?.get(0)).toBeCloseTo(10.16)
})

it('round-trips route/location metadata and validates optional fields', () => {
 const q = mark('polyline', { floor: '1階', room: '事務室', count: 2, extra: [{ itemId: 'em', count: 1 }] })
 expect(parseQuantityMark(JSON.stringify(q))).toEqual({ ...q, cond: {}, extra: q.extra!.map(e => ({ ...e, cond: {} })) })
 for (const value of [0, 100, 1.5, '2', null]) {
  expect(parseQuantityMark(JSON.stringify({ ...q, count: value }))).toBeNull()
  expect(parseQuantityMark(JSON.stringify({ ...q, extra: [{ itemId: 'em', count: value }] }))).toBeNull()
 }
 for (const extra of [Array.from({ length: 11 }, (_, i) => ({ itemId: String(i), count: 1 })), [{ itemId: 'cv', count: 1 }], [{ itemId: 'em', count: 1 }, { itemId: 'em', count: 2 }], null]) expect(parseQuantityMark(JSON.stringify({ ...q, extra }))).toBeNull()
 expect(parseQuantityMark(JSON.stringify({ ...q, method: 'polygon', count: 0, extra: null }))).toEqual({ version: 1, id: 'mark', itemId: 'cv', method: 'polygon', floor: '1階', room: '事務室' })
 for (const key of ['floor', 'room']) expect(parseQuantityMark(JSON.stringify({ ...q, [key]: 'x'.repeat(41) }))).toBeNull()
 const max = mark('polyline', { id: 'a'.repeat(80), itemId: 'b'.repeat(80), floor: '階'.repeat(40), room: '室'.repeat(40), count: 99, extra: Array.from({ length: 10 }, (_, i) => ({ itemId: String(i).repeat(80), count: 99 })) })
 expect(JSON.stringify(max).length).toBeGreaterThan(400)
 expect(parseQuantityMark(JSON.stringify(max))).toEqual({ ...max, cond: {}, extra: max.extra!.map(e => ({ ...e, cond: {} })) })
 expect(parseQuantityMark(' '.repeat(2001))).toBeNull()
 expect(parseQuantityMark(JSON.stringify(mark('polyline')))).toEqual({ ...mark('polyline'), cond: {} })
})
it('labels shared routes with specifications, counts, additions and unchanged one-item format', () => {
 const points: Point[] = [[0,0],[9.35,0]], q = mark('polyline', { addM: 3, count: 2, extra: [{ itemId: 'pf', count: 1 }] })
 expect(quantityLabel(points, 1000, q, 'CV 38sq-3C', true, () => 'PF28')).toBe('CV 38sq-3C×2, PF28  9.35+3.00=12.35 m')
 expect(quantityLabel([[0,0],[12.35,0]], 1000, { ...q, addM: undefined }, 'CV 38sq-3C', true, () => 'PF28')).toBe('CV 38sq-3C×2, PF28  12.35 m')
 expect(quantityLabel(points, 1000, q, 'CV', false)).toBe('9.35+3.00=12.35 m')
 expect(quantityLabel(points, 1000, mark('polyline'), 'CV', true)).toBe('CV 9.35 m')
})

it('edits shared routes, promotes/deletes items and merges reassignment counts with Undo', async () => {
 const f = (id:string): CountFixture => ({id,code:id,name:id,category:'線',kind:'length',method:'polyline',order:0,style:nextCountStyle([])})
 const store = new AnnotationStore(), fixtures = [f('cv'),f('em'),f('pf')]
 await store.ensureCountFixtures(async()=>fixtures,async()=>{})
 const a=store.create({kind:'perimeter',pageIndex:0,rect:[0,0,12.35,1],vertices:[[0,0],[12.35,0]],measure:{kind:'perimeter',unit:'mm',decimals:null,mmPerPoint:1000},quantity:mark('polyline',{count:2,extra:[{itemId:'em',count:1},{itemId:'pf',count:3}],floor:'1階',room:'事務室'})})
 const index=()=>store.quantityIndex()
 expect(index().total('cv')).toBeCloseTo(24.7)
 store.selectOnly(a.id); store.setFixtureVisible(['cv'],false)
 expect(store.isShownOnDrawing(store.get(a.id)!)).toBe(true)
 store.selectFixture('em');store.setOnlySelectedFixture(true);expect(store.isShownOnDrawing(store.get(a.id)!)).toBe(true)
 store.showAllFixtures()
 store.updateRoute(a.id,4,[{itemId:'em',count:1}]);expect(index().total('cv')).toBeCloseTo(49.4);expect(index().total('pf')).toBe(0)
 store.undo();expect(index().total('pf')).toBeCloseTo(37.05)
 store.updateMeasureVertices(a.id,[[0,0],[20,0]]);expect(index().total('cv')).toBe(40);expect(index().total('em')).toBe(20);store.undo()
 store.reassignCounts([a.id],'em');expect(store.get(a.id)?.quantity).toMatchObject({itemId:'em',count:3,extra:[{itemId:'pf',count:3}],floor:'1階',room:'事務室'})
 expect(index().total('em')).toBeCloseTo(37.05);store.undo()
 expect(store.fixtureRemovalCounts('cv')).toEqual({deleted:0,detached:1})
 store.setCountFixtures(fixtures.filter(f=>f.id!=='cv'),['cv']);expect(store.get(a.id)?.quantity).toMatchObject({itemId:'em',extra:[{itemId:'pf',count:3}]});expect(store.get(a.id)?.quantity?.count).toBeUndefined()
 store.undo();store.setCountFixtures(fixtures.filter(f=>f.id!=='em'),['em']);expect(store.get(a.id)?.quantity?.itemId).toBe('cv');expect(index().total('em')).toBe(0);store.undo()
 const edit=store.getCountFixtures().map(f=>f.id==='em'?{...f,spec:'3C-5.5sq'}:f)
 store.setCountFixtures(edit);expect(store.get(a.id)?.text).toContain('em 3C-5.5sq');store.undo()
 store.updateRoute(a.id,99,[{itemId:'em',count:2}]);expect(store.reassignCounts([a.id],'em')).toContain('99');expect(store.get(a.id)?.quantity?.itemId).toBe('cv');store.undo()
 store.setCountFixtures([],['cv','em','pf']);expect(store.get(a.id)).toBeUndefined();store.undo();expect(index().total('cv')).toBeCloseTo(24.7)
})
it('sets mixed count/quantity locations in one Undo, keeps locations on reassign and across page reset', async () => {
 const fixtures:CountFixture[] = ['a','b'].map(id=>({id,name:id,code:id,category:'器具',order:0,style:nextCountStyle([])}))
 const store=new AnnotationStore();await store.ensureCountFixtures(async()=>fixtures,async()=>{})
 const a=store.create({kind:'symbol',pageIndex:0,rect:[0,0,10,10],count:{version:2,id:'a',fixtureId:'a',floor:'1階',room:'事務室'}})
 const b=store.create({kind:'perimeter',pageIndex:0,rect:[0,0,10,10],vertices:[[0,0],[10,0]],measure:{kind:'perimeter',unit:'mm',decimals:null,mmPerPoint:1000},quantity:mark('polyline',{floor:'2階'})})
 store.selectOnly(a.id);store.toggleSelection(b.id);expect(store.selectedPickupsOnly()).toBe(true)
 store.updatePickupLocation([a.id,b.id],'room','会議室');expect(store.get(a.id)?.count).toMatchObject({room:'会議室'});expect(store.get(b.id)?.quantity?.room).toBe('会議室')
 store.undo();expect(store.get(a.id)?.count).toMatchObject({room:'事務室'});expect(store.get(b.id)?.quantity?.room).toBeUndefined()
 store.updatePickupLocation([a.id,b.id],'floor','１Ｆ');expect(store.get(b.id)?.quantity?.floor).toBe('1階');store.undo()
 store.updatePickupLocation([a.id],'room','');expect(store.get(a.id)?.count).not.toHaveProperty('room');store.undo()
 store.reassignCounts([a.id],'b');expect(store.get(a.id)?.count).toMatchObject({fixtureId:'b',floor:'1階',room:'事務室'})
 store.setDrawingInfo([0],{name:'2階 電灯設備平面図'});expect(store.pickupLocation(0)).toEqual({floor:'2階'})
 store.setCurrentLocation('floor','1F');store.setCurrentLocation('room','事務室');expect(store.pickupLocation(0)).toEqual({floor:'1階',room:'事務室'})
 store.reset(true);expect(store.currentFloor).toBe('1階');expect(store.currentRoom).toBe('事務室');store.reset();expect(store.currentFloor).toBe('')
})
