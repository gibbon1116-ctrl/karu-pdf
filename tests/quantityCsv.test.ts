import { expect, it } from 'vitest'
import { createQuantityCsv, createCsv, quantityCsvFileName, QUANTITY_DETAIL_HEADER } from '../src/app/annotationCsv'
import { QuantityIndex, compareFloors } from '../src/core/quantityIndex'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import type { Point } from '../src/core/annotations'
import type { EditableAnnotation } from '../src/editor/AnnotationStore'

const fixture = (id: string, kind: CountFixture['kind'], order: number): CountFixture => ({ id, code: id, name: id, category: '例', kind, order, style: nextCountStyle([]) })
const fixtures = [{ ...fixture('EM-CE', 'length', 0), spec: '3C-5.5sq' }, { ...fixture('根切り', 'volume', 1), method: 'polygonDepth' as const }, { ...fixture('溝掘削', 'volume', 2), method: 'lengthWidthDepth' as const }, fixture('LED埋込形', 'count', 3)]
const line = (id: string, pageIndex: number, value: number, itemId = 'EM-CE') => ({ id, pageIndex, vertices: [[0, 0], [value, 0]] as Point[], measure: { mmPerPoint: 1000 }, quantity: { version: 1 as const, id, itemId, method: 'polyline' as const } })
const measurements = [30.2, 28.1, 34.1].map((n, p) => line('c' + p, p, n))
const earth = [12.5, 18.2, 8.4].map((n, p) => ({ ...line('e' + p, p, n, '根切り'), vertices: [[0,0],[n,0],[n,1],[0,1]] as Point[], quantity: { version: 1 as const, id: 'e' + p, itemId: '根切り', method: 'polygonDepth' as const, depthM: 1 } }))
const trenches = [4.2, 6.5, 3.1].map((n, p) => ({ ...line('t' + p, p, n, '溝掘削'), quantity: { version: 1 as const, id: 't' + p, itemId: '溝掘削', method: 'lengthWidthDepth' as const, widthM: 1, depthM: 1 } }))
const counts = [[24, '1階', '事務室', 0], [8, '1階', '会議室', 0], [32, '2階', '事務室', 1]].flatMap(([n, floor, room, p]) => Array.from({ length: Number(n) }, (_, i) => ({ id: `${floor}${room}${i}`, pageIndex: Number(p), count: { version: 2 as const, id: `${floor}${room}${i}`, fixtureId: 'LED埋込形', floor: String(floor), room: String(room) } })))
const index = QuantityIndex.build([...measurements, ...earth, ...trenches, ...counts], fixtures)
const drawing = (p: number) => ({ number: ['E-101', 'E-102', 'E-401'][p], name: ['1階 幹線設備平面図', '2階 幹線設備平面図', '幹線系統図'][p] })
it('exports specified summary totals, page columns, spec, kind and aggregation', () => {
  const csv = createQuantityCsv(index, fixtures, 0, 'summary', drawing)
  expect(csv.split('\r\n')[0]).toBe('\uFEFF分類,略号,名称,規格,施工条件,集計区分,種別,単位,集計方式,平面,立上り・立下り,その他の加算,全図面の合計,表示中の図面（p.1）,p.1 E-101,p.2 E-102,p.3 E-401')
  expect(csv).toContain('例,EM-CE,EM-CE,3C-5.5sq,,施工条件別,長さ,m,全図面,92.40,0.00,0.00,92.40,30.20,30.20,28.10,34.10\r\n')
  expect(csv).toContain('例,根切り,根切り,,,施工条件別,体積,m³,全図面,,,,39.10,12.50,12.50,18.20,8.40')
  expect(csv).toContain('例,溝掘削,溝掘削,,,施工条件別,体積,m³,全図面,,,,13.80,4.20,4.20,6.50,3.10')
  expect(csv).toContain('例,LED埋込形,LED埋込形,,,施工条件別,個数,個,場所別,,,,64,32,32,32,0')
  expect(createQuantityCsv(index, fixtures, 0, 'summary').split('\r\n')[0]).toContain(',p.1,p.2,p.3')
})
it('groups detail rows by item/page/floor/room and counts marks, with drawing names', () => {
  const csv = createQuantityCsv(index, fixtures, 0, 'detail', drawing)
  expect(csv.split('\r\n')[0]).toBe('\uFEFF' + QUANTITY_DETAIL_HEADER.join(','))
  expect(csv).toContain('例,EM-CE,EM-CE,3C-5.5sq,,平面,長さ,m,全図面,,,1,E-101,1階 幹線設備平面図,30.20,1')
  expect(csv).toContain('場所別,1階,事務室,1,E-101,1階 幹線設備平面図,24,24')
  expect(csv).toContain('場所別,1階,会議室,1,E-101,1階 幹線設備平面図,8,8')
  expect(csv).toContain('場所別,2階,事務室,2,E-102,2階 幹線設備平面図,32,32')
  expect(csv.indexOf('例,EM-CE')).toBeLessThan(csv.indexOf('例,根切り'))
})
it('orders floors, including basements, roof, penthouse and unknown names', () => {
  expect(['別棟', 'PH階', 'RF', '10階', '2F', '1階', 'B1階', 'B2階', 'PH2階'].sort(compareFloors)).toEqual(['B2階', 'B1階', '1階', '2F', '10階', 'RF', 'PH階', 'PH2階', '別棟'])
  const a = ['PH階', 'RF', '2階', 'B2階', 'B1階'].map((floor, i) => ({ id: String(i), pageIndex: 0, count: { version: 2 as const, id: String(i), fixtureId: 'LED埋込形', floor } }))
  const csv = createQuantityCsv(QuantityIndex.build(a, fixtures), fixtures, 0, 'detail')
  expect(csv.match(/場所別,([^,]*),/g)).toEqual(['場所別,B2階,', '場所別,B1階,', '場所別,2階,', '場所別,RF,', '場所別,PH階,'])
})
it('multiplies shared routes, groups missing locations and protects text fields', () => {
  const f = [{ ...fixtures[0], code: '=EM', spec: '+規格' }, fixture('extra', 'length', 1)]
  const a = { ...line('route', 2, 10), quantity: { ...line('route', 2, 10).quantity, count: 2, extra: [{ itemId: 'extra', count: 3 }] } }
  const i = QuantityIndex.build([a, line('other', 2, 4)], f)
  const csv = createQuantityCsv(i, f, 0, 'detail', () => ({ number: '@図面', name: '-名称' }))
  expect(csv).toContain("例,'=EM,EM-CE,'+規格,,平面,長さ,m,全図面,,,3,'@図面,'-名称,24.00,2")
  expect(csv).toContain('例,extra,extra,,,平面,長さ,m,全図面,,,3')
  expect(csv).toContain('30.00,1')
  expect(quantityCsvFileName('文書.pdf', 'summary')).toBe('文書_数量集計.csv')
  expect(quantityCsvFileName('文書.pdf', 'detail')).toBe('文書_数量明細.csv')
})
it('adds location/drawing fields to annotation CSV only for quantity rows', () => {
  const csv = createCsv([{ ...counts[0], kind: 'symbol', rect: [0,0,10,10], text: '', color: [1,0,0] } as EditableAnnotation], ['count'], { fixtures, drawingInfo: drawing })
  expect(csv).toContain('階,部屋\r\n')
  expect(csv).toContain('数量拾い,,1,E-101')
  expect(csv).toContain('LED埋込形,LED埋込形,例,1階,事務室')
})
it('matches the grouped item list order even for an interleaved saved catalog', () => {
  const f = [{ ...fixtures[0], category: '電気' }, { ...fixtures[1], category: '土工' }, { ...fixtures[3], category: '電気' }]
  const csv = createQuantityCsv(index, f, 0, 'detail', drawing)
  expect(csv.indexOf('電気,EM-CE')).toBeLessThan(csv.indexOf('電気,LED埋込形'))
  expect(csv.indexOf('電気,LED埋込形')).toBeLessThan(csv.indexOf('土工,根切り'))
})
