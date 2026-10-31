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

it('indexes count components by condition, page, floor and room while counting only main marks on the page', () => {
 const first = {
  id: 'switch1', pageIndex: 3,
  count: {
   version: 2 as const, id: 'c1', fixtureId: 'SW', floor: '1階', room: '事務室',
   extra: [{ itemId: 'SB', count: 1, condition: '隠ぺい（埋込）' }, { itemId: 'PL', count: 2 }],
  },
 }
 const second = { id: 'switch2', pageIndex: 3, count: { version: 2 as const, id: 'c2', fixtureId: 'SW', floor: '1階', room: '会議室' } }
 const index = QuantityIndex.build([first, second, { ...first, id: 'deleted', deleted: true }], [fixture('SW'), fixture('SB'), fixture('PL')])
 expect(index.total('SW')).toBe(2)
 expect(index.total('SB')).toBe(1)
 expect(index.total('PL')).toBe(2)
 expect(index.byCondition('SB').get('隠ぺい（埋込）')).toMatchObject({ other: 1, total: 1, raw: 1 })
 expect(index.byCondition('SB').get('隠ぺい（埋込）')?.annotationIds).toEqual(new Set(['switch1']))
 expect(index.byCondition('PL').get('')?.total).toBe(2)
 for (const [id, total] of [['SB', 1], ['PL', 2]] as const) {
  expect(index.byPage(id)).toEqual(new Map([[3, total]]))
  expect(index.byFloor(id)).toEqual(new Map([['1階', total]]))
  expect(index.byRoom(id)).toEqual(new Map([['事務室', total]]))
  expect(index.byFloorRoom(id)).toEqual(new Map([['1階', new Map([['事務室', total]])]]))
  expect(index.pagesOf(id)).toEqual([3])
  expect(index.entries(id)[0]).toMatchObject({ itemId: id, annotationId: 'switch1', pageIndex: 3, value: total, floor: '1階', room: '事務室' })
 }
 expect(index.countEntriesOnPage(3)).toHaveLength(2)
 expect(index.countEntriesOnPage(3).map(e => e.itemId)).toEqual(['SW', 'SW'])
})

it('excludes missing and non-click component fixtures without changing main counts', () => {
 const annotations = [
  {
   id: 'a', pageIndex: 0,
   count: { version: 2 as const, id: 'a', fixtureId: 'SW', extra: [{ itemId: 'missing', count: 2 }, { itemId: 'LINE', count: 3 }] },
  },
  { id: 'b', pageIndex: 0, count: { version: 2 as const, id: 'b', fixtureId: 'SW' } },
 ]
 const index = QuantityIndex.build(annotations, [fixture('SW'), fixture('LINE', 'length', 'polyline')])
 expect(index.total('SW')).toBe(2)
 expect(index.entries('missing')).toEqual([])
 expect(index.entries('LINE')).toEqual([])
 expect([...index.itemIds()]).toEqual(['SW'])
 expect(index.countEntriesOnPage(0)).toHaveLength(2)
})

it('converts count components through the existing add pipeline', () => {
 const index = QuantityIndex.build([{
  id: 'a', pageIndex: 1,
  count: { version: 2, id: 'a', fixtureId: 'SW', floor: '2階', room: '倉庫', extra: [{ itemId: 'PL', count: 2, condition: '露出' }] },
 }], [
  fixture('SW'),
  { ...fixture('PL'), convert: { factor: 3 } as NonNullable<CountFixture['convert']> },
 ])
 expect(index.total('SW')).toBe(1)
 expect(index.total('PL')).toBe(6)
 expect(index.rawTotal('PL')).toBe(2)
 expect(index.entries('PL')[0]).toMatchObject({ annotationId: 'a', value: 6, raw: 2 })
 expect(index.byCondition('PL').get('露出')).toMatchObject({ other: 6, total: 6, raw: 2 })
 expect(index.byPage('PL')).toEqual(new Map([[1, 6]]))
 expect(index.byFloorRoom('PL').get('2階')?.get('倉庫')).toBe(6)
 expect(index.countEntriesOnPage(1)).toHaveLength(1)
})

it('indexes linked count totals and bases without adding drawing marks', () => {
 const fixtures: CountFixture[] = [
  fixture('DL'), fixture('SL'),
  { ...fixture('L'), link: { kind: 'factor', sources: [{ itemId: 'DL' }, { itemId: 'SL', factor: 2 }] } },
 ]
 const annotations = [
  ...Array.from({ length: 10 }, (_, i) => ({
   id: 'DL'+i, pageIndex: 1,
   count: { version: 2 as const, id: 'DL'+i, fixtureId: 'DL', floor: '1階', room: '事務室', condition: '露出' },
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
   id: 'SL'+i, pageIndex: 3,
   count: { version: 2 as const, id: 'SL'+i, fixtureId: 'SL', floor: '2階', room: '倉庫', condition: '隠ぺい' },
  })),
 ]
 const index = QuantityIndex.build(annotations, fixtures)
 expect(index.total('L')).toBe(16)
 expect(index.byCondition('L').get('露出')?.total).toBe(10)
 expect(index.byCondition('L').get('隠ぺい')?.total).toBe(6)
 expect(index.byPage('L')).toEqual(new Map([[1,10],[3,6]]))
 expect(index.byFloor('L')).toEqual(new Map([['1階',10],['2階',6]]))
 expect(index.byRoom('L')).toEqual(new Map([['事務室',10],['倉庫',6]]))
 expect(index.byFloorRoom('L').get('2階')?.get('倉庫')).toBe(6)
 expect(index.linkResult('L')?.sources).toEqual([
  { itemId:'DL', quantity:10, subtotal:10 },
  { itemId:'SL', quantity:3, factor:2, subtotal:6 },
 ])
 expect(index.linkResult('DL')).toBeUndefined()
 expect(index.countEntriesOnPage(1)).toHaveLength(10)
 expect(index.countEntriesOnPage(3)).toHaveLength(3)
 expect(index.countEntriesOnPage(1).every(e => e.itemId === 'DL')).toBe(true)
})

it('keeps linked page and floor sums unrounded while rounding total and conditions', () => {
 const sources = [{itemId:'E25',perM:1.5},{itemId:'E31',perM:1.5}]
 const fixtures: CountFixture[] = [
  fixture('E25','length','polyline'),fixture('E31','length','polyline'),
  { ...fixture('total'),link:{kind:'factor',sources} },
  { ...fixture('none'),link:{kind:'factor',sources,rounding:'none'} },
  { ...fixture('fixed'),link:{kind:'factor',sources,condition:{mode:'fixed',value:'撤去'}} },
  { ...fixture('exposed'),link:{kind:'factor',sources:[
   {itemId:'E25',perM:1.5,conditions:['露出']},
   {itemId:'E31',perM:1.5,conditions:['露出']},
  ]} },
 ]
 const index = QuantityIndex.build([
  line('a',3,'E25',10.2,{floor:'1階',room:'事務室',cond:{plan:'露出'}}),
  line('b',1,'E31',4,{floor:'2階',room:'倉庫',cond:{plan:'隠ぺい'}}),
 ],fixtures)
 expect(index.total('total')).toBe(10)
 expect(index.byCondition('total').get('露出')?.total).toBe(7)
 expect(index.byCondition('total').get('隠ぺい')?.total).toBe(3)
 expect(index.byCondition('total').get('露出')?.plan).toBeCloseTo(6.8)
 expect(index.byPage('total').get(3)).toBeCloseTo(6.8)
 expect(index.byPage('total').get(1)).toBeCloseTo(4/1.5)
 expect(index.pagesOf('total')).toEqual([1,3])
 expect(index.byFloor('total').get('1階')).toBeCloseTo(6.8)
 expect(index.byRoom('total').get('倉庫')).toBeCloseTo(4/1.5)
 expect(index.total('none')).toBeCloseTo(14.2/1.5)
 expect(index.byCondition('none').get('露出')?.total).toBeCloseTo(6.8)
 expect([...index.byCondition('fixed').keys()]).toEqual(['撤去'])
 expect(index.byCondition('fixed').get('撤去')?.total).toBe(10)
 expect(index.total('exposed')).toBe(7)
 expect(index.byPage('exposed')).toEqual(new Map([[3,10.2/1.5]]))
 expect(index.linkResult('exposed')?.sources.map(s => s.quantity)).toEqual([10.2,0])
 expect(index.countEntriesOnPage(1)).toEqual([])
})

it('rounds each condition independently of the overall linked total', () => {
 const fixtures: CountFixture[] = [
  fixture('A','length','polyline'),
  { ...fixture('L'),link:{kind:'factor',sources:[{itemId:'A',perM:5}]} },
 ]
 const index = QuantityIndex.build([
  line('a',0,'A',1,{cond:{plan:'露出'}}),
  line('b',1,'A',1,{cond:{plan:'隠ぺい'}}),
 ],fixtures)
 expect(index.total('L')).toBe(1)
 expect(index.byCondition('L').get('露出')?.total).toBe(1)
 expect(index.byCondition('L').get('隠ぺい')?.total).toBe(1)
 expect(index.byPage('L').get(0)).toBeCloseTo(.2)
 expect(index.byPage('L').get(1)).toBeCloseTo(.2)
})

it('rounds linked quantities per annotation and preserves proportional route portions', () => {
 const fixtures: CountFixture[] = [
  fixture('A','length','polyline'),
  { ...fixture('L'),link:{kind:'factor',sources:[{itemId:'A',perM:1.5}],rounding:'each'} },
 ]
 const index = QuantityIndex.build([
  line('a',0,'A',3,{floor:'1階'}),
  line('b',0,'A',3,{floor:'1階'}),
  line('c',1,'A',3,{addM:1.2,floor:'2階',cond:{plan:'露出',rise:'隠ぺい'}}),
 ],fixtures)
 expect(index.total('L')).toBeCloseTo(7)
 expect(index.byPage('L').get(0)).toBeCloseTo(4)
 expect(index.byPage('L').get(1)).toBeCloseTo(3)
 expect(index.byFloor('L').get('2階')).toBeCloseTo(3)
 const portions = index.entries('L').filter(e => e.annotationId === 'c')
 expect(portions.find(e => e.part === 'plan')?.value).toBeCloseTo(3*3/4.2)
 expect(portions.find(e => e.part === 'rise')?.value).toBeCloseTo(3*1.2/4.2)
 expect(index.byCondition('L').get('露出')?.total).toBeCloseTo(3*3/4.2)
 expect(index.byCondition('L').get('隠ぺい')?.total).toBeCloseTo(3*1.2/4.2)
 expect(index.linkResult('L')?.sources[0].subtotal).toBeCloseTo(6.8)
})

it('feeds converted ordinary quantities into links exactly once', () => {
 const fixtures: CountFixture[] = [
  { ...fixture('A','length','polyline'),convert:{factor:2,unit:'m',basis:'2倍'} },
  { ...fixture('B','length','polyline'),link:{kind:'factor',sources:[{itemId:'A',factor:3}]} },
  { ...fixture('C','length','polyline'),link:{kind:'factor',sources:[{itemId:'B',factor:2}]} },
 ]
 const index = QuantityIndex.build([line('a',0,'A',5,{floor:'1階'})],fixtures)
 expect(index.rawTotal('A')).toBe(5)
 expect(index.total('A')).toBe(10)
 expect(index.total('B')).toBe(30)
 expect(index.total('C')).toBe(60)
 expect(index.entries('B')[0].raw).toBeUndefined()
 expect(index.linkResult('B')?.sources[0]).toEqual({
  itemId:'A',quantity:10,factor:3,subtotal:30,
 })
 expect(index.byFloor('C').get('1階')).toBe(60)
})

it('indexes overrides under the fixed or unset condition without drawing locations', () => {
 const sources = [{itemId:'A',perM:1.5}]
 const fixtures: CountFixture[] = [
  fixture('A','length','polyline'),
  { ...fixture('L'),link:{kind:'factor',sources,override:{value:12}} },
  { ...fixture('fixed'),link:{
   kind:'factor',sources,condition:{mode:'fixed',value:'撤去'},override:{value:0},
  } },
 ]
 const index = QuantityIndex.build([
  line('a',2,'A',14.2,{floor:'1階',room:'事務室',cond:{plan:'露出'}}),
 ],fixtures)
 expect(index.total('L')).toBe(12)
 expect([...index.byCondition('L').keys()]).toEqual([''])
 expect(index.byCondition('L').get('')).toMatchObject({other:12,total:12})
 expect(index.byCondition('L').get('')?.annotationIds.size).toBe(0)
 expect(index.linkResult('L')).toMatchObject({total:12,computed:10,overridden:true,entries:[]})
 expect(index.byPage('L').size).toBe(0)
 expect(index.byFloor('L').size).toBe(0)
 expect(index.byRoom('L').size).toBe(0)
 expect(index.byFloorRoom('L').size).toBe(0)
 expect(index.pagesOf('L')).toEqual([])
 expect(index.total('fixed')).toBe(0)
 expect(index.byCondition('fixed').get('撤去')?.total).toBe(0)
})

it('exposes cycle and missing-source errors and retains valid partial quantities', () => {
 const fixtures: CountFixture[] = [
  fixture('A'),
  { ...fixture('B'),link:{kind:'factor',sources:[{itemId:'C'}]} },
  { ...fixture('C'),link:{kind:'factor',sources:[{itemId:'B'}]} },
  { ...fixture('partial'),link:{kind:'factor',sources:[{itemId:'missing'},{itemId:'A'}]} },
 ]
 const index = QuantityIndex.build([{
  id:'a',pageIndex:0,count:{version:2,id:'a',fixtureId:'A'},
 }],fixtures)
 expect(index.total('B')).toBe(0)
 expect(index.total('C')).toBe(0)
 expect(index.linkResult('B')?.error).toBe('連動の元が循環しています。')
 expect(index.linkResult('C')?.error).toBe('連動の元が循環しています。')
 expect(index.total('partial')).toBe(1)
 expect(index.linkResult('partial')?.error).toBe('連動の元の項目が見つかりません。')
 expect(index.byPage('partial')).toEqual(new Map([[0,1]]))
})

it('ignores stale drawing pickups referencing linked fixtures', () => {
 const fixtures: CountFixture[] = [
  fixture('A'),fixture('route','length','polyline'),
  { ...fixture('L'),link:{kind:'factor',sources:[{itemId:'A'}]} },
  { ...fixture('linkedRoute','length','polyline'),link:{kind:'factor',sources:[]} },
 ]
 const index = QuantityIndex.build([
  {id:'a',pageIndex:0,count:{version:2,id:'a',fixtureId:'A',extra:[{itemId:'L',count:99}]}},
  {id:'stale',pageIndex:0,count:{version:2,id:'stale',fixtureId:'L'}},
  line('route',0,'route',3,{extra:[{itemId:'linkedRoute',count:99}]}),
  line('stale-route',0,'linkedRoute',99),
 ],fixtures)
 expect(index.total('L')).toBe(1)
 expect(index.total('linkedRoute')).toBe(0)
 expect(index.entries('L').map(e => e.annotationId)).toEqual(['a'])
 expect(index.byPage('linkedRoute').size).toBe(0)
 expect(index.countEntriesOnPage(0).map(e => e.annotationId)).toEqual(['a'])
})

it('records build times for 20 links and 5,000 source annotations against zero links', () => {
 const ordinary = Array.from({length:20},(_,i)=>fixture('source'+i,'length','polyline'))
 const linked: CountFixture[] = Array.from({length:20},(_,i)=>({
  ...fixture('link'+i),
  link:{kind:'factor',sources:[{itemId:'source'+i,perM:1.5}]},
 }))
 const annotations = Array.from({length:5000},(_,i)=>line(
  String(i),i%50,'source'+(i%20),3,{floor:String(i%10)+'階',cond:{plan:'露出'}},
 ))
 const fixtures = [...ordinary,...linked]
 QuantityIndex.build(annotations,ordinary)
 QuantityIndex.build(annotations,fixtures)
 const baselineMs:number[] = [], linkedMs:number[] = []
 const measure = (items: CountFixture[], times: number[]) => {
  const start = performance.now()
  const index = QuantityIndex.build(annotations,items)
  times.push(performance.now()-start)
  return index
 }
 for(let i=0;i<7;i++){
  if(i%2===0){
   expect(measure(ordinary,baselineMs).total('source0')).toBe(750)
   expect(measure(fixtures,linkedMs).total('link0')).toBe(500)
  }else{
   expect(measure(fixtures,linkedMs).total('link0')).toBe(500)
   expect(measure(ordinary,baselineMs).total('source0')).toBe(750)
  }
 }
 const median = (times: number[]) => [...times].sort((a,b)=>a-b)[3]
 const baselineMedianMs = median(baselineMs), linkedMedianMs = median(linkedMs)
 console.log('QuantityIndex B05 links ms: '+JSON.stringify({
  sourceFixtures:20,sourceAnnotations:5000,links:20,samples:7,
  condition:'同一プロセス・ウォームアップ後・交互測定。他の重い試験を並行実行しないこと',
  baselineMs,linkedMs,baselineMedianMs,linkedMedianMs,
  absoluteDeltaMs:linkedMedianMs-baselineMedianMs,
  relativeDeltaPercent:baselineMedianMs>0
   ? (linkedMedianMs-baselineMedianMs)/baselineMedianMs*100 : null,
 }))
})
