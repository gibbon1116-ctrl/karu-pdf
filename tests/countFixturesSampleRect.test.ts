import { expect, it } from 'vitest'
import {
  nextCountStyle,
  parseCountFixtureSample,
  parseCountFixtures,
  serializeCountFixtures,
  type CountFixture,
  type CountFixtureSample,
} from '../src/core/countFixtures'
import type { Rect } from '../src/core/annotations'

// This fixture contains the signature and IHDR bytes inspected by the parser.
// It is used only for serialization tests, never for browser image decoding.
function sample(): CountFixtureSample {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8)
  bytes.set([0, 0, 0, 16, 0, 0, 0, 16, 8, 6, 0, 0, 0], 16)
  return { png: btoa(String.fromCharCode(...bytes)), width: 16, height: 16, pageIndex: 0 }
}

function fixture(value: CountFixtureSample): CountFixture {
  return {
    id: 'sample-rect', name: '感知器', code: 'D', category: '電気設備',
    order: 0, style: nextCountStyle([]), sample: value,
  }
}

it('preserves sample rect when saving and reading fixtures', () => {
  const rect: Rect = [12.5, 24, 48, 60.25]
  const value = { ...sample(), rect }
  const raw = serializeCountFixtures([fixture(value)])
  expect(JSON.parse(raw).fixtures[0].sample.rect).toEqual(rect)
  expect(parseCountFixtures(raw)[0].sample).toEqual(value)
})

it('copies the parsed rect instead of retaining the input array', () => {
  const rect: Rect = [1, 2, 20, 30]
  const value = { ...sample(), rect }
  const parsed = parseCountFixtureSample(value)!
  expect(parsed.rect).toEqual(rect)
  expect(parsed.rect).not.toBe(rect)
  rect[0] = 9
  expect(parsed.rect).toEqual([1, 2, 20, 30])
})

it.each([
  ['three coordinates', [1, 2, 20]],
  ['five coordinates', [1, 2, 20, 30, 40]],
  ['NaN', [1, NaN, 20, 30]],
  ['infinity', [1, 2, Infinity, 30]],
  ['non-number', [1, '2', 20, 30]],
  ['zero width', [1, 2, 1, 30]],
  ['zero height', [1, 2, 20, 2]],
  ['reversed width', [20, 2, 1, 30]],
  ['reversed height', [1, 30, 20, 2]],
])('drops invalid rect (%s) while retaining the sample', (_name, rect) => {
  const original = sample()
  expect(parseCountFixtureSample({ ...original, rect })).toEqual(original)
  const raw = JSON.stringify({ version: 1, fixtures: [{ ...fixture(original), sample: { ...original, rect } }] })
  expect(parseCountFixtures(raw)[0].sample).toEqual(original)
})

it('reads and saves legacy samples without rect', () => {
  const original = sample()
  expect(parseCountFixtureSample(original)).toEqual(original)
  const parsed = parseCountFixtures(serializeCountFixtures([fixture(original)]))
  expect(parsed).toHaveLength(1)
  expect(parsed[0].sample).toEqual(original)
  expect(parsed[0].sample).not.toHaveProperty('rect')
})
