import { Buffer } from 'node:buffer'
import { deflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import mupdf, { type PDFDocument } from 'mupdf'
import * as countFixtures from '../src/core/countFixtures'
import type { CountFixture } from '../src/core/countFixtures'
import {
  applyPageLayout,
  getPageInfo,
  type PageLayoutCard,
  type PageRotation,
} from '../src/core/pageOps'

const TARGET_DOC_ID = 'target'

function createSamplePng(): string {
  function chunk(name: string, data: Buffer): Buffer {
    const type = Buffer.from(name, 'ascii')
    const content = Buffer.concat([type, data])
    let crc = 0xffffffff
    for (const byte of content) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
      }
    }
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([length, content, checksum])
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(16, 0)
  header.writeUInt32BE(16, 4)
  header[8] = 8
  header[9] = 6
  const pixels = Buffer.alloc(16 * (1 + 16 * 4))
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64')
}

const SAMPLE_PNG = createSamplePng()

function createDocument(
  rotations: readonly PageRotation[] = [0, 0, 0],
): PDFDocument {
  const document = new mupdf.PDFDocument()
  try {
    for (const rotation of rotations) {
      const page = document.addPage([0, 0, 100, 100], rotation, {}, '')
      try {
        document.insertPage(-1, page)
      } finally {
        page.destroy()
      }
    }
    return document
  } catch (error) {
    document.destroy()
    throw error
  }
}

function createFixtures(): CountFixture[] {
  return [0, 1, 2].map((pageIndex): CountFixture => ({
    id: `fixture-${pageIndex}`,
    name: `項目${pageIndex + 1}`,
    code: `F${pageIndex + 1}`,
    category: '設備',
    memo: `メモ${pageIndex + 1}`,
    order: pageIndex,
    style: {
      shape: 'square',
      fill: 'none',
      color: [0.1, 0.2, 0.3],
      size: 12,
      opacity: 0.75,
      showCode: true,
    },
    sample: {
      png: SAMPLE_PNG,
      width: 16,
      height: 16,
      pageIndex,
      rect: [10, 10, 30, 30],
      lines: {
        segments: [10, 10, 30, 10, 30, 10, 30, 30],
        widths: [1, 2],
      },
    },
  }))
}

function withFixtures(
  run: (document: PDFDocument, before: CountFixture[]) => void,
  rotations: readonly PageRotation[] = [0, 0, 0],
): void {
  const document = createDocument(rotations)
  try {
    countFixtures.writeCountFixtures(document, createFixtures())
    const before = countFixtures.readCountFixtures(document)
    expect(before).toHaveLength(3)
    for (const fixture of before) {
      expect(fixture.sample?.png).toBe(SAMPLE_PNG)
      expect(fixture.sample?.rect).toEqual([10, 10, 30, 30])
      expect(fixture.sample?.lines).toEqual({
        segments: [10, 10, 30, 10, 30, 10, 30, 30],
        widths: [1, 2],
      })
    }
    run(document, before)
  } finally {
    document.destroy()
  }
}

function pageCards(indices: readonly number[]): PageLayoutCard[] {
  return indices.map((pageIndex, index) => ({
    id: `page-${index}`,
    source: { kind: 'page', docId: TARGET_DOC_ID, pageIndex },
    rotation: 0,
  }))
}

function expectFixtures(
  document: PDFDocument,
  before: CountFixture[],
  pageIndices: readonly number[],
  withoutCoordinates: readonly number[] = [],
): void {
  const expected = structuredClone(before)
  pageIndices.forEach((pageIndex, fixtureIndex) => {
    expected[fixtureIndex].sample!.pageIndex = pageIndex
  })
  for (const fixtureIndex of withoutCoordinates) {
    delete expected[fixtureIndex].sample!.rect
    delete expected[fixtureIndex].sample!.lines
  }

  const actual = countFixtures.readCountFixtures(document)
  expect(actual).toEqual(expected)
  for (const fixtureIndex of withoutCoordinates) {
    expect(actual[fixtureIndex].sample?.rect).toBeUndefined()
    expect(actual[fixtureIndex].sample?.lines).toBeUndefined()
  }
}

function readRawFixtures(document: PDFDocument): string | null {
  const root = document.getTrailer().get('Root')
  try {
    const value = root.get('KaruCountFixtures')
    try {
      return value.isString() ? value.asString() : null
    } finally {
      value.destroy()
    }
  } finally {
    root.destroy()
  }
}

describe('applyPageLayout の項目の見本', () => {
  it('並べ替えでページ番号を付け替え、座標と他の値を保持する', () => {
    withFixtures((document, before) => {
      applyPageLayout(TARGET_DOC_ID, document, pageCards([2, 0, 1]), new Map())
      expectFixtures(document, before, [1, 2, 0])
      expect(document.countPages()).toBe(3)
    })
  })

  it('削除したページの座標だけを外し、画像と元のページ番号を保持する', () => {
    withFixtures((document, before) => {
      applyPageLayout(TARGET_DOC_ID, document, pageCards([0, 2]), new Map())
      expectFixtures(document, before, [0, 1, 1], [1])
      expect(document.countPages()).toBe(2)
    })
  })

  it('前への空白ページ挿入でページ番号を1ずつ増やす', () => {
    withFixtures((document, before) => {
      const cards: PageLayoutCard[] = [
        {
          id: 'blank',
          source: { kind: 'blank', width: 100, height: 100 },
          rotation: 0,
        },
        ...pageCards([0, 1, 2]),
      ]
      applyPageLayout(TARGET_DOC_ID, document, cards, new Map())
      expectFixtures(document, before, [1, 2, 3])
      expect(document.countPages()).toBe(4)
    })
  })

  it('複製したページは最初の位置を使う', () => {
    withFixtures((document, before) => {
      applyPageLayout(TARGET_DOC_ID, document, pageCards([0, 0, 1, 2]), new Map())
      expectFixtures(document, before, [0, 2, 3])
      expect(document.countPages()).toBe(4)
    })
  })

  it('別PDFの同じページ番号を対応表に含めない', () => {
    withFixtures((document, before) => {
      const source = createDocument([0])
      try {
        const cards: PageLayoutCard[] = [
          {
            id: 'external',
            source: { kind: 'page', docId: 'external', pageIndex: 0 },
            rotation: 90,
          },
          ...pageCards([0, 1, 2]),
        ]
        applyPageLayout(
          TARGET_DOC_ID,
          document,
          cards,
          new Map([['external', source]]),
        )
        expectFixtures(document, before, [1, 2, 3])
        expect(document.countPages()).toBe(4)
      } finally {
        source.destroy()
      }
    })
  })

  it('追加回転のあるページだけ座標を外し、元からの回転だけなら保持する', () => {
    withFixtures((document, before) => {
      const cards = pageCards([0, 1, 2])
      cards[0].rotation = 90
      applyPageLayout(TARGET_DOC_ID, document, cards, new Map())
      expectFixtures(document, before, [0, 1, 2], [0])
      expect(getPageInfo(document).map(page => page.rotation)).toEqual([90, 90, 0])
    }, [0, 90, 0])
  })

  it.each([
    { first: 0, second: 90, withoutCoordinates: [] },
    { first: 90, second: 0, withoutCoordinates: [0] },
  ] as const)(
    '複製の回転判定も最初の位置を使う（最初=$first、次=$second）',
    ({ first, second, withoutCoordinates }) => {
      withFixtures((document, before) => {
        const cards = pageCards([0, 0, 1, 2])
        cards[0].rotation = first
        cards[1].rotation = second
        applyPageLayout(TARGET_DOC_ID, document, cards, new Map())
        expectFixtures(document, before, [0, 2, 3], withoutCoordinates)
      })
    },
  )

  it('ページ番号と座標に変更がなければ書き込まない', () => {
    withFixtures((document, before) => {
      const raw = readRawFixtures(document)
      const write = vi.spyOn(countFixtures, 'writeCountFixtures')
      try {
        applyPageLayout(TARGET_DOC_ID, document, pageCards([0, 1, 2]), new Map())
        expect(write).not.toHaveBeenCalled()
        expect(countFixtures.readCountFixtures(document)).toEqual(before)
        expect(readRawFixtures(document)).toBe(raw)
      } finally {
        write.mockRestore()
      }
    }, [0, 90, 0])
  })

  it('見本のない項目を変更せず、書き込まない', () => {
    withFixtures((document, before) => {
      const fixture = structuredClone(before[0])
      delete fixture.sample
      countFixtures.writeCountFixtures(document, [fixture])
      const expected = countFixtures.readCountFixtures(document)
      const write = vi.spyOn(countFixtures, 'writeCountFixtures')
      try {
        expect(() => {
          applyPageLayout(TARGET_DOC_ID, document, pageCards([2, 0, 1]), new Map())
        }).not.toThrow()
        expect(write).not.toHaveBeenCalled()
        expect(countFixtures.readCountFixtures(document)).toEqual(expected)
      } finally {
        write.mockRestore()
      }
    })
  })

  it.each([null, '{ invalid JSON'])(
    '項目の一覧がない・壊れているPDFでも例外を出さない（%s）',
    (raw) => {
      const document = createDocument()
      try {
        if (raw !== null) {
          const root = document.getTrailer().get('Root')
          try {
            const value = document.newString(raw)
            try {
              root.put('KaruCountFixtures', value)
            } finally {
              value.destroy()
            }
          } finally {
            root.destroy()
          }
        }

        const write = vi.spyOn(countFixtures, 'writeCountFixtures')
        try {
          expect(() => {
            applyPageLayout(TARGET_DOC_ID, document, pageCards([2, 0, 1]), new Map())
          }).not.toThrow()
          expect(write).not.toHaveBeenCalled()
          expect(readRawFixtures(document)).toBe(raw)
          expect(document.countPages()).toBe(3)
        } finally {
          write.mockRestore()
        }
      } finally {
        document.destroy()
      }
    },
  )

  it('項目の読み取りが例外になってもページ操作を完了する', () => {
    withFixtures((document) => {
      const raw = readRawFixtures(document)
      const read = vi.spyOn(countFixtures, 'readCountFixtures').mockImplementation(() => {
        throw new Error('項目を読み取れません')
      })
      const write = vi.spyOn(countFixtures, 'writeCountFixtures')
      try {
        expect(() => {
          applyPageLayout(TARGET_DOC_ID, document, pageCards([2, 0, 1]), new Map())
        }).not.toThrow()
        expect(read).toHaveBeenCalledTimes(1)
        expect(write).not.toHaveBeenCalled()
        expect(readRawFixtures(document)).toBe(raw)
        expect(document.countPages()).toBe(3)
      } finally {
        write.mockRestore()
        read.mockRestore()
      }
    })
  })
})
