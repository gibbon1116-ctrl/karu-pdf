import { expect, it } from 'vitest'
import { fixtureCode, nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { quantityLabel } from '../src/core/quantity'
import { AnnotationStore } from '../src/editor/AnnotationStore'

const points: [number, number][] = [[0, 0], [10, 0]]
const measure = { kind: 'perimeter' as const, unit: 'mm' as const, decimals: null, mmPerPoint: 1000 }

async function storeWithFixtures(fixtures: CountFixture[]): Promise<AnnotationStore> {
  const store = new AnnotationStore()
  await store.ensureCountFixtures(async () => fixtures, async () => {})
  return store
}

function lengthFixture(id: string, spec?: string, showCode = true): CountFixture {
  return {
    id, code: id.toUpperCase(), name: `${id}の名称`, category: '電気', order: 0,
    kind: 'length', spec, style: { ...nextCountStyle([]), showCode },
  }
}

it('keeps specifications on the main and extra members of a route label', async () => {
  const main = lengthFixture('cv', '3C-5.5sq')
  const extra = lengthFixture('pf', 'φ22')
  const store = await storeWithFixtures([main, extra])
  const quantity = {
    version: 1 as const, id: 'route', itemId: main.id, method: 'polyline' as const,
    extra: [{ itemId: extra.id, count: 1 }],
  }
  const text = store.quantityText({ quantity, vertices: points, measure, text: '' })
  expect(text).toContain('CV 3C-5.5sq')
  expect(text).toContain('PF φ22')
  expect(fixtureCode(main)).toBe('CV 3C-5.5sq')
  expect(fixtureCode(extra)).toBe('PF φ22')
})

it('omits specifications from area and volume labels', async () => {
  const vertices: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]]
  for (const [kind, method] of [['area', 'polygon'], ['volume', 'polygonDepth']] as const) {
    const fixture: CountFixture = {
      ...lengthFixture('wall', '規格を札に出さない'), kind,
    }
    const store = await storeWithFixtures([fixture])
    const quantity = {
      version: 1 as const, id: kind, itemId: fixture.id, method, depthM: 1,
    }
    const text = store.quantityText({
      quantity, vertices, measure: { ...measure, kind: 'area' }, text: '',
    })
    expect(text).toContain('WALL')
    expect(text).not.toContain(fixture.spec!)
  }
})

it('refreshes a saved legacy area label and restores it with one Undo', async () => {
  const fixture: CountFixture = { ...lengthFixture('floor', '長尺シート'), kind: 'area', method: 'polygon' }
  const store = await storeWithFixtures([fixture])
  const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]]
  const areaMeasure = { ...measure, kind: 'area' as const }
  const quantity = { version: 1 as const, id: 'floor', itemId: fixture.id, method: 'polygon' as const }
  const legacyText = quantityLabel(square, areaMeasure.mmPerPoint, quantity, fixtureCode(fixture), true)
  expect(legacyText).toContain(fixture.spec!)
  const annotation = store.create({
    kind: 'area', pageIndex: 0, rect: [0, 0, 10, 10],
    vertices: square, measure: areaMeasure, quantity, text: legacyText,
  })
  expect(store.get(annotation.id)!.text).toBe(legacyText)

  store.setCountFixtures(store.getCountFixtures(), [], [fixture.id])
  expect(store.get(annotation.id)!.text).toBe(store.quantityText(store.get(annotation.id)!))
  expect(store.get(annotation.id)!.text).not.toContain(fixture.spec!)

  store.undo()
  expect(store.get(annotation.id)!.text).toBe(legacyText)
  expect(store.getCountFixture(fixture.id)!.spec).toBe(fixture.spec)
})

it('does not notify, change pending edits or add history when the label is already current', async () => {
  const fixture = lengthFixture('cv', '3C-5.5sq')
  const store = await storeWithFixtures([fixture])
  const quantity = { version: 1 as const, id: 'route', itemId: fixture.id, method: 'polyline' as const }
  const text = store.quantityText({ quantity, vertices: points, measure, text: '' })
  const annotation = store.create({
    kind: 'perimeter', pageIndex: 0, rect: [0, 0, 10, 0],
    vertices: points, measure, quantity, text,
  })
  const before = JSON.stringify(store.toEdits())
  const snapshot = store.getSnapshot()
  store.setCountFixtures(store.getCountFixtures(), [], [fixture.id])
  expect(JSON.stringify(store.toEdits())).toBe(before)
  expect(store.getSnapshot()).toBe(snapshot)

  store.undo()
  expect(store.get(annotation.id)).toBeUndefined()
})

it('does not refresh count appearances for items without a specification or with hidden codes', async () => {
  for (const fixture of [
    { ...lengthFixture('plain'), kind: 'count' as const },
    { ...lengthFixture('hidden', '規格', false), kind: 'count' as const },
  ]) {
    const store = await storeWithFixtures([fixture])
    const annotation = store.create({
      kind: 'symbol', symbol: 'circle', pageIndex: 0, rect: [10, 10, 20, 20],
      count: { version: 2, id: fixture.id, fixtureId: fixture.id },
    })
    const before = JSON.stringify(store.toEdits())
    const snapshot = store.getSnapshot()
    store.setCountFixtures(store.getCountFixtures(), [], [fixture.id])
    expect(JSON.stringify(store.toEdits())).toBe(before)
    expect(store.getSnapshot()).toBe(snapshot)

    store.undo()
    expect(store.get(annotation.id)).toBeUndefined()
  }
})
