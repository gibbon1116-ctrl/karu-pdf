import { expect, it } from 'vitest'
import { fixtureCode, fixtureDrawingCode } from '../src/core/countFixtures'

it('uses only the code for marks, areas and volumes while retaining the specification in selection labels', () => {
  for (const kind of [undefined, 'count', 'area', 'volume'] as const) {
    const fixture = { code: 'DS', spec: '1.2m*2m', kind }
    expect(fixtureDrawingCode(fixture)).toBe('DS')
    expect(fixtureCode(fixture)).toBe('DS 1.2m*2m')
  }
})

it('keeps the specification on line pickups, where it is the size', () => {
  expect(fixtureDrawingCode({ code: 'CV', spec: '38sq-3C', kind: 'length' })).toBe('CV 38sq-3C')
  expect(fixtureDrawingCode({ code: 'PF22', kind: 'length' })).toBe('PF22')
})

it('preserves codes without specifications', () => {
  expect(fixtureDrawingCode({ code: 'LED' })).toBe('LED')
  expect(fixtureDrawingCode({ code: 'DL φ150' })).toBe('DL φ150')
})

it('does not substitute the specification when the drawing code is empty', () => {
  const fixture = { code: '', spec: '1.2m*2m' }
  expect(fixtureDrawingCode(fixture)).toBe('')
  expect(fixtureCode(fixture)).toBe('1.2m*2m')
})
