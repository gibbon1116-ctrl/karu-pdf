import { describe, expect, it } from 'vitest'
import { nearestCalloutEdgePoint } from '../src/core/annotations'

describe('吹き出しの接続先', () => {
  const rect: [number, number, number, number] = [100, 100, 260, 180]

  it('指示点に最も近い辺の中点を選ぶ', () => {
    expect(nearestCalloutEdgePoint(rect, [180, 20])).toEqual([180, 100])
    expect(nearestCalloutEdgePoint(rect, [320, 140])).toEqual([260, 140])
    expect(nearestCalloutEdgePoint(rect, [180, 250])).toEqual([180, 180])
    expect(nearestCalloutEdgePoint(rect, [20, 140])).toEqual([100, 140])
  })
})
