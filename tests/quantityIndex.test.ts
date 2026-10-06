import fs from 'node:fs'
import { expect, it } from 'vitest'
import { QuantityIndex } from '../src/core/quantityIndex'
import type { CountFixture } from '../src/core/countFixtures'
import type { QuantityMark } from '../src/core/quantity'
import type { Point } from '../src/core/annotations'
import { AnnotationStore } from '../src/editor/AnnotationStore'
const style = { shape: 'circle' as const, fill: 'none' as const, color: [1,0,0] as [number,number,number], size: 10, opacity: .8, showCode: true }
const fixture = (id: string, kind: CountFixture['kind'] = 'count', method?: CountFixture['method']): CountFixture => ({ id, code: id, name: id, category: '例', kind, method, style, order: 0 })
const line = (id: string, pageIndex: number, itemId: string, value: number, options: Partial<QuantityMark> = {}) => ({ id, pageIndex, vertices: [[0,0],[value,0]] as Point[], measure: { mmPerPoint: 1000 }, quantity: { version: 1 as const, id, itemId, method: 'polyline' as const, ...options } })
it('indexes the location example, including missing floors/rooms and deleted counts', () => {
 const annotations = [[24,'1階','事務室'],[8,'1階','会議室'],[32,'2階','事務室']].flatMap(([n,floor,room], p) => Array.from({ length: Number(n) }, (_,i) => ({ id: p+':'+i, pageIndex: p, count: { version: 2 as const, id: p+':'+i, fixtureId: 'led', floor: String(floor), room: String(room) } })))
 const index = QuantityIndex.build(annotations, [fixture('led')])
 expect(index.total('led')).toBe(64)
 expect(index.byFloor('led')).toEqual(new Map([['1階',32],['2階',32]]))
 expect(index.byRoom('led').get('事務室')).toBe(56)
 expect(index.byFloorRoom('led').get('1階')?.get('事務室')).toBe(24)
 expect(index.entries('led')).toHaveLength(64)
 expect(index.pagesOf('led')).toEqual([0,1,2])
 const missing = QuantityIndex.build([{ id: 'u', pageIndex: 0, count: { version: 2, id: 'u', fixtureId: 'led' } }, { ...annotations[0], deleted: true }], [])
 expect(missing.byFloorRoom('led').get('')?.get('')).toBe(1)
 expect(index.total('absent')).toBe(0)
 expect(index.entries('absent')).toEqual([])
})
it('indexes document totals independently of locations, deleting and reordering pages', () => {
 const a = [line('a',0,'em55',30,{floor:'1階'}),line('b',2,'em55',20,{floor:'2階'}),line('c',7,'em55',50,{floor:'RF'}),line('d',1,'em14',40)]
 const fixtures = [{ ...fixture('em55','length','polyline'), code:'EM-CE', spec:'3C-5.5sq' },{ ...fixture('em14','length','polyline'), code:'EM-CE', spec:'3C-14sq' }]
 const index = QuantityIndex.build(a, fixtures)
 expect(index.total('em55')).toBe(100); expect(index.total('em14')).toBe(40)
 expect([...index.byPage('em55')]).toEqual([[0,30],[2,20],[7,50]])
 expect(QuantityIndex.build(a.filter(x => x.id !== 'b'), fixtures).total('em55')).toBe(80)
 const reordered = QuantityIndex.build(a.map(x=>({...x,pageIndex: 7-x.pageIndex})),fixtures)
 expect(reordered.total('em55')).toBe(100); expect(reordered.pagesOf('em55')).toEqual([0,5,7])
})
it.each(['polygonDepth','lengthWidthDepth'] as const)('indexes %s volume and removal', method => {
 const fixtures = [fixture('earth','volume',method)]
 const a = [10,15,20].map((v,p) => ({ ...line(String(p),p,'earth',v), vertices: method === 'polygonDepth' ? [[0,0],[v,0],[v,1],[0,1]] as Point[] : [[0,0],[v,0]] as Point[], quantity: { version: 1 as const, id:String(p), itemId:'earth', method, depthM:1, widthM:1 } }))
 expect(QuantityIndex.build(a,fixtures).total('earth')).toBe(45)
 expect(QuantityIndex.build(a.filter(x=>x.pageIndex!==1),fixtures).total('earth')).toBe(30)
})
it('indexes each route item once with its count and excludes non-length extras', () => {
 const a = line('route',0,'cv',9.35,{addM:3,count:2,extra:[{itemId:'em',count:1},{itemId:'led',count:2}],floor:'1階',room:'事務室'})
 const index = QuantityIndex.build([a],[fixture('cv','length','polyline'),fixture('em','length','polyline'),fixture('led')])
 expect(index.total('cv')).toBeCloseTo(24.70);expect(index.total('em')).toBeCloseTo(12.35);expect(index.total('led')).toBe(0)
 expect(index.entries('cv')[0]).toMatchObject({ annotationId:'route',routeCount:2,floor:'1階',room:'事務室' })
})
it('caches the store index across selection/display changes and rebuilds on data edits and Undo', async () => {
 const store = new AnnotationStore()
 await store.ensureCountFixtures(async()=>[fixture('led')],async()=>{})
 const a=store.create({kind:'symbol',pageIndex:0,rect:[0,0,10,10],count:{version:2,id:'a',fixtureId:'led'}})
 const first=store.quantityIndex()
 store.selectOnly(a.id);store.selectFixture('led');store.setFixtureVisible(['led'],false);store.showAllFixtures();store.setCurrentLocation('floor','1F');store.setDrawingInfo([0],{name:'2階',number:''})
 expect(store.quantityIndex()).toBe(first)
 store.updatePickupLocation([a.id],'room','会議室')
 const next=store.quantityIndex();expect(next).not.toBe(first);expect(next.byRoom('led').get('会議室')).toBe(1)
 store.undo();expect(store.quantityIndex().byRoom('led').get('')).toBe(1)
 store.remove(a.id);expect(store.quantityIndex().total('led')).toBe(0)
 store.undo();expect(store.quantityIndex().total('led')).toBe(1)
 store.setCountFixtures([ {...fixture('led'), spec:'300W'} ]);expect(store.quantityIndex()).not.toBe(next)
})
it('measures rebuilding 1,000 fixtures and 10,000 annotations without concurrent heavy tests', () => {
 const fixtures=Array.from({length:1000},(_,i)=>fixture('f'+i,'length','polyline'))
 const a=Array.from({length:10000},(_,i)=>line(String(i),i%100,'f'+(i%1000),12.35,{count:2,floor:String(i%10)+'階',room:'事務室'}))
 QuantityIndex.build(a,fixtures)
 const times:number[]=[]
 for(let i=0;i<7;i++){const start=performance.now();const index=QuantityIndex.build(a,fixtures);times.push(performance.now()-start);expect(index.total('f0')).toBeCloseTo(247)}
 const sorted=[...times].sort((a,b)=>a-b)
 fs.mkdirSync('work', { recursive: true }); fs.writeFileSync('work/spec-05c-index-benchmark.json', JSON.stringify({ items:1000, annotations:10000, times, median:sorted[3], max:sorted[6], node:process.version, platform:process.platform, date:new Date().toISOString() },null,2))
 console.log('QuantityIndex 1000 items / 10000 annotations ms: '+JSON.stringify({times,median:sorted[3],max:sorted[6]}))
 expect(sorted[3]).toBeLessThan(1000)
})

it('caches visible counts without rebuilding quantities for selection, filters or visibility', async () => {
 const store=new AnnotationStore();await store.ensureCountFixtures(async()=>[fixture('a'),fixture('b')],async()=>{})
 const a=store.create({kind:'symbol',pageIndex:0,rect:[0,0,10,10],count:{version:2,id:'a',fixtureId:'a'}})
 store.create({kind:'symbol',pageIndex:0,rect:[10,0,20,10],count:{version:2,id:'b',fixtureId:'b'}})
 const index=store.quantityIndex();expect(store.visibleCountTotal(0)).toBe(2)
 store.selectOnly(a.id);expect(store.visibleCountTotal(0)).toBe(2);expect(store.quantityIndex()).toBe(index)
 store.setFixtureVisible(['a'],false);expect(store.visibleCountTotal(0)).toBe(1);expect(store.quantityIndex()).toBe(index)
 store.showAllFixtures();store.selectFixture('b');store.setOnlySelectedFixture(true);expect(store.visibleCountTotal(0)).toBe(1)
 store.selectFixture('a');expect(store.visibleCountTotal(0)).toBe(1)
 store.setAnnotationFilter({kind:'measure',discipline:'',status:''});store.setDrawingFollowsFilter(true);expect(store.visibleCountTotal(0)).toBe(0)
 store.setDrawingFollowsFilter(false);expect(store.visibleCountTotal(0)).toBe(1);expect(store.quantityIndex()).toBe(index)
 store.setDrawingInfo([0],{name:'2階'});store.undo();expect(store.quantityIndex()).toBe(index)
})
