import { describe, expect, it } from 'vitest'
import { readExif } from '../src/core/exif'
import { testJpeg, withExif } from './imagePdfFixtures'

describe('JPEG EXIF', () => {
  for (const little of [true, false]) for (let orientation = 1; orientation <= 8; orientation++) {
    it(`向き${orientation}・撮影日時 (${little ? 'II' : 'MM'})`, () => {
      expect(readExif(withExif(testJpeg(), orientation, '2026:10:02 12:34:56', little))).toEqual({ orientation, dateTime: '2026:10:02 12:34:56' })
    })
  }
  it('EXIFのないJPEGと非JPEG', () => {
    expect(readExif(testJpeg())).toEqual({ orientation: 1 })
    expect(readExif(new Uint8Array())).toEqual({ orientation: 1 })
  })
  it('すべての切断位置・不正なIFDのオフセット・不正な向きで落ちない', () => {
    const image = withExif(testJpeg(), 6)
    for (let end = 0; end < 90; end++) expect(() => readExif(image.subarray(0, end))).not.toThrow()
    const broken = image.slice(); broken.fill(255, 16, 20)
    expect(readExif(broken)).toEqual({ orientation: 1 })
    expect(readExif(withExif(testJpeg(), 99)).orientation).toBe(1)
  })
})
