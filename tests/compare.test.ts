import { describe, expect, it } from 'vitest'
import { compositeCompare, detectDifferences, differenceLocation, differenceMask, type ComparePixels } from '../src/core/compare'

const pixels = (values: number[][]): ComparePixels => ({ width: values.length, height: 1, rgba: new Uint8ClampedArray(values.flatMap(v => [...v, 255])) })
describe('比較の画素と領域', () => {
  it('共通は灰、旧だけは赤、新だけは青、背景は白になる', () => {
    const a = pixels([[0, 0, 0], [0, 0, 0], [255, 255, 255], [255, 255, 255]])
    const b = pixels([[0, 0, 0], [255, 255, 255], [0, 0, 0], [255, 255, 255]])
    expect([...compositeCompare(a, b).rgba]).toEqual([128, 128, 128, 255, 255, 0, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
    expect([...differenceMask(a, b)]).toEqual([0, 1, 1, 0])
  })
  it('200未満が暗く、赤・青の線も明るさで判定し、透明は白扱い', () => {
    const a = pixels([[199, 199, 199], [200, 200, 200], [255, 0, 0], [0, 0, 255], [0, 0, 0]])
    a.rgba[19] = 0
    const b = pixels(Array.from({ length: 5 }, () => [255, 255, 255]))
    expect([...differenceMask(a, b)]).toEqual([1, 0, 1, 1, 0])
  })
  it('孤立点と小さな点を捨て、近い塊をまとめ、細い長線は残す', () => {
    const mask = new Uint8Array(100 * 100)
    mask[10 * 100 + 10] = 1
    for (let y = 20; y < 22; y++) for (let x = 20; x < 22; x++) mask[y * 100 + x] = 1
    for (let y = 40; y < 50; y++) for (let x = 40; x < 44; x++) mask[y * 100 + x] = 1
    for (let y = 40; y < 50; y++) for (let x = 47; x < 51; x++) mask[y * 100 + x] = 1
    for (let y = 70; y < 80; y++) mask[y * 100 + 70] = 1
    expect(detectDifferences(mask, 100, 100, 2)).toEqual([[20, 20, 25.5, 25], [35, 35, 35.5, 40]])
  })
  it('200を超える領域を近くのものからまとめ、元の差分をすべて囲む', () => {
    const width = 600, height = 600, mask = new Uint8Array(width * height)
    const points: number[][] = []
    for (let row = 0; row < 20; row++) for (let col = 0; col < 20; col++) {
      const x = col * 25 + 5, y = row * 25 + 5
      points.push([x, y])
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) mask[(y + dy) * width + x + dx] = 1
    }
    const regions = detectDifferences(mask, width, height)
    expect(regions.length).toBeLessThanOrEqual(200)
    expect(regions.length).toBeGreaterThan(1)
    for (const [x, y] of points) expect(regions.some(r => r[0] <= x && r[1] <= y && r[2] >= x + 4 && r[3] >= y + 4)).toBe(true)
  })
  it('ページ端で隣接判定を折り返さず、位置を日本語で返す', () => {
    const mask = new Uint8Array(100)
    mask[9] = mask[10] = 1
    expect(detectDifferences(mask, 10, 10)).toEqual([])
    expect(differenceLocation([0, 0, 10, 10], 100, 100)).toBe('左上')
    expect(differenceLocation([40, 40, 60, 60], 100, 100)).toBe('中央')
    expect(differenceLocation([80, 80, 90, 90], 100, 100)).toBe('右下')
  })
})
