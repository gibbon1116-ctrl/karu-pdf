import { describe, expect, it } from 'vitest'
import type { Point } from '../src/core/annotations'
import {
  measureText, normalizeMeasureSettings, validAreaHoles, type MeasureSettings,
} from '../src/core/measure'

const outer: Point[] = [[0, 0], [5, 0], [5, 5], [0, 5]]
const hole: Point[] = [[.5, .5], [4.5, .5], [4.5, 1.3], [.5, 1.3]]
const settings: MeasureSettings = { kind: 'area', unit: 'm', mmPerPoint: 1000, decimals: null }

describe('SPEC-S16 area measurements', () => {
  it('subtracts holes and formats the formula with the existing decimal settings', () => {
    expect(measureText(outer, { ...settings, holes: [hole] })).toBe('25.00−3.20=21.80 m²')
    expect(measureText(outer, { ...settings, holes: [hole], decimals: 1 })).toBe('25.0−3.2=21.8 m²')
    expect(measureText(outer, { ...settings, holes: [hole], unit: 'mm' })).toBe('25.00−3.20=21.80 m²')
    expect(measureText(outer, { ...settings, holes: [hole], mmPerPoint: 500 })).toBe('6.25−0.80=5.45 m²')
  })

  it('clamps negative net area to zero', () => {
    const large: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]]
    expect(measureText(outer, { ...settings, holes: [large] })).toBe('25.00−100.00=0.00 m²')
  })

  it('keeps old labels without exclusions', () => {
    expect(measureText(outer, settings)).toBe('25.00 m²')
    expect(measureText(outer, { ...settings, holes: [] })).toBe('25.00 m²')
    const line: Point[] = [[0, 0], [5, 0]]
    expect(measureText(line, { ...settings, kind: 'distance' })).toBe('5.00 m')
    expect(measureText(line, { ...settings, kind: 'perimeter', holes: [hole] })).toBe('合計 5.00 m')
  })

  it('keeps valid area holes and copies their coordinates', () => {
    const original = { ...settings, holes: [hole] }
    const normalized = normalizeMeasureSettings(original)
    expect(normalized).toEqual(original)
    expect(normalized.holes).not.toBe(original.holes)
    expect(normalized.holes?.[0][0]).not.toBe(hole[0])
    expect(normalizeMeasureSettings(settings)).toBe(settings)
  })

  it('discards invalid holes and holes on non-area measurements', () => {
    expect(normalizeMeasureSettings({ ...settings, holes: [[[0, 0], [1, 0]]] }).holes).toBeUndefined()
    expect(normalizeMeasureSettings({ ...settings, kind: 'distance', holes: [hole] }).holes).toBeUndefined()
    expect(normalizeMeasureSettings({ ...settings, kind: 'perimeter', holes: [hole] }).holes).toBeUndefined()
    expect(validAreaHoles([[[0, 0], [1, 0], [Infinity, 1]]])).toBe(false)
    expect(validAreaHoles(Array.from({ length: 51 }, () => hole))).toBe(false)
    expect(validAreaHoles([Array.from({ length: 501 }, () => [0, 0])])).toBe(false)
  })
})
