import { expect, it } from 'vitest'
import {
  fixtureSamplePixelsMatch,
  fixtureSampleRectFitsPage,
  type FixtureSamplePixels,
} from '../src/app/fixtureSampleMatch'

function pixels(gray: number, width = 2, height = 2): FixtureSamplePixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = gray
    data[offset + 1] = gray
    data[offset + 2] = gray
    data[offset + 3] = 255
  }
  return { width, height, data }
}

it('matches identical pixels', () => {
  expect(fixtureSamplePixelsMatch(pixels(80), pixels(80))).toBe(true)
})

it('rejects different image dimensions', () => {
  expect(fixtureSamplePixelsMatch(pixels(80, 2, 2), pixels(80, 1, 4))).toBe(false)
})

it('matches a mean grayscale difference of exactly six', () => {
  expect(fixtureSamplePixelsMatch(pixels(80), pixels(86))).toBe(true)
})

it('rejects a mean grayscale difference above six', () => {
  expect(fixtureSamplePixelsMatch(pixels(80), pixels(87))).toBe(false)
})

it('uses the average difference across the whole image', () => {
  const a = pixels(80)
  const b = pixels(80)
  b.data.set([104, 104, 104, 255], 0)
  expect(fixtureSamplePixelsMatch(a, b)).toBe(true)
  b.data.set([105, 105, 105, 255], 0)
  expect(fixtureSamplePixelsMatch(a, b)).toBe(false)
})

it('compares grayscale values rather than individual RGB channels', () => {
  const a = pixels(0, 1, 1)
  const b = pixels(0, 1, 1)
  a.data.set([100, 0, 0, 255])
  b.data.set([0, 51, 0, 255])
  expect(fixtureSamplePixelsMatch(a, b)).toBe(true)
})

it('composites transparent pixels onto white', () => {
  const transparent = pixels(0)
  for (let offset = 3; offset < transparent.data.length; offset += 4) transparent.data[offset] = 0
  expect(fixtureSamplePixelsMatch(transparent, pixels(255))).toBe(true)
})

it('rejects incomplete pixel buffers', () => {
  expect(fixtureSamplePixelsMatch({ width: 2, height: 2, data: new Uint8ClampedArray(4) }, pixels(0))).toBe(false)
})

it('accepts a positive rectangle wholly inside the page, including its edges', () => {
  expect(fixtureSampleRectFitsPage([0, 0, 200, 300], { width: 200, height: 300 })).toBe(true)
  expect(fixtureSampleRectFitsPage([10, 20, 50, 60], [200, 300])).toBe(true)
  expect(fixtureSampleRectFitsPage([10, 20, 50, 60], [0, 0, 200, 300])).toBe(true)
})

it('rejects out-of-page, invalid, or unverifiable rectangles', () => {
  const size = { width: 200, height: 300 }
  expect(fixtureSampleRectFitsPage([-1, 0, 20, 30], size)).toBe(false)
  expect(fixtureSampleRectFitsPage([0, -1, 20, 30], size)).toBe(false)
  expect(fixtureSampleRectFitsPage([0, 0, 201, 30], size)).toBe(false)
  expect(fixtureSampleRectFitsPage([0, 0, 20, 301], size)).toBe(false)
  expect(fixtureSampleRectFitsPage([1, 2, 1, 30], size)).toBe(false)
  expect(fixtureSampleRectFitsPage([1, NaN, 20, 30], size)).toBe(false)
  expect(fixtureSampleRectFitsPage([1, 2, 20, 30], undefined)).toBe(false)
  expect(fixtureSampleRectFitsPage([1, 2, 20, 30], { width: Infinity, height: 300 })).toBe(false)
})
