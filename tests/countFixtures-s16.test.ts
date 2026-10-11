import { describe, expect, it } from 'vitest'
import {
  fixtureOpeningSize, parseCountFixtures, serializeCountFixtures, type CountFixture,
} from '../src/core/countFixtures'

const fixture: CountFixture = {
  id: 'door', name: '建具', code: 'D1', category: '建具', order: 0,
  style: { shape: 'circle', fill: 'none', color: [1, 0, 0], size: 10, opacity: 1, showCode: true },
}

describe('SPEC-S16 fixture opening dimensions', () => {
  it('preserves dimensions on explicit and legacy count fixtures', () => {
    for (const value of [
      { ...fixture, opening: { widthM: .9, heightM: 2.4 } },
      { ...fixture, kind: 'count' as const, opening: { widthM: 100, heightM: 100 } },
    ]) {
      const parsed = parseCountFixtures(serializeCountFixtures([value]))
      expect(parsed).toHaveLength(1)
      expect(parsed[0].opening).toEqual(value.opening)
    }
  })

  it.each([
    null, [], {}, { widthM: 0, heightM: 2 }, { widthM: -1, heightM: 2 },
    { widthM: 101, heightM: 2 }, { widthM: 1, heightM: 101 },
    { widthM: '1', heightM: 2 }, { widthM: 1 },
    { widthM: Infinity, heightM: 2 }, { widthM: 1, heightM: NaN },
  ])('discards invalid dimensions and keeps the fixture: %j', opening => {
    const value = { ...fixture, opening } as unknown as CountFixture
    const read = parseCountFixtures(JSON.stringify({ version: 1, fixtures: [value] }))
    expect(read).toHaveLength(1)
    expect(read[0].opening).toBeUndefined()
    const saved = parseCountFixtures(serializeCountFixtures([value]))
    expect(saved).toHaveLength(1)
    expect(saved[0].opening).toBeUndefined()
  })

  it.each(['area', 'length', 'volume'] as const)('discards opening dimensions on %s items', kind => {
    const value: CountFixture = { ...fixture, kind, opening: { widthM: 1, heightM: 2 } }
    expect(parseCountFixtures(JSON.stringify({ version: 1, fixtures: [value] }))[0].opening).toBeUndefined()
    expect(parseCountFixtures(serializeCountFixtures([value]))[0].opening).toBeUndefined()
    expect(fixtureOpeningSize([value])('door')).toBeUndefined()
  })

  it('resolves count dimensions and leaves absent dimensions unresolved', () => {
    const values: CountFixture[] = [
      { ...fixture, opening: { widthM: .9, heightM: 2.4 } },
      { ...fixture, id: 'unset' },
    ]
    const resolve = fixtureOpeningSize(values)
    expect(resolve('door')).toEqual({ widthM: .9, heightM: 2.4 })
    expect(resolve('unset')).toBeUndefined()
    expect(resolve('deleted')).toBeUndefined()
  })

  it('keeps the legacy serialization unchanged without opening dimensions', () => {
    expect(serializeCountFixtures([fixture])).toBe(
      '{"version":1,"fixtures":[{"id":"door","name":"建具","code":"D1","category":"建具","order":0,"style":{"shape":"circle","fill":"none","color":[1,0,0],"size":10,"opacity":1,"showCode":true}}]}',
    )
  })
})
