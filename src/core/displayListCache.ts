import mupdf, {
  type DisplayList,
  type DisplayListDevice,
  type Document,
  type PDFPage,
} from 'mupdf'

interface Entry {
  list: DisplayList
  usedAt: number
  estimatedBytes: number
}

export class DisplayListCache {
  readonly maxBytes: number
  private readonly entries = new Map<string, Entry>()
  private clock = 0
  private bytes = 0

  constructor(
    private readonly document: Document,
    maxBytes = 96 * 1024 * 1024,
  ) {
    this.maxBytes = maxBytes
  }

  get count(): number {
    return this.entries.size
  }

  get usedBytes(): number {
    return this.bytes
  }

  get(pageIndex: number, excludeAnnotObjNums: ReadonlySet<number> = new Set()): DisplayList {
    const exclusions = [...excludeAnnotObjNums].sort((a, b) => a - b).join(',')
    const key = `${pageIndex}:${exclusions}`
    const cached = this.entries.get(key)
    if (cached) {
      cached.usedAt = ++this.clock
      return cached.list
    }

    const page = this.document.loadPage(pageIndex)
    const started = performance.now()
    let list: DisplayList | undefined
    let device: DisplayListDevice | undefined
    try {
      list = new mupdf.DisplayList(page.getBounds())
      device = new mupdf.DisplayListDevice(list)
      page.runPageContents(device, mupdf.Matrix.identity)

      if (page.isPDF()) {
        const pdfPage = page as PDFPage
        for (const annotation of pdfPage.getAnnotations()) {
          try {
            const object = annotation.getObject()
            let objectNumber: number | undefined
            try {
              if (object.isIndirect()) objectNumber = object.asIndirect()
            } finally {
              object.destroy()
            }
            if (objectNumber === undefined || !excludeAnnotObjNums.has(objectNumber)) {
              annotation.run(device, mupdf.Matrix.identity)
            }
          } finally {
            annotation.destroy()
          }
        }
      }
      page.runPageWidgets(device, mupdf.Matrix.identity)
      device.close()
      device.destroy()
      device = undefined

      const elapsed = performance.now() - started
      // MuPDF.js から DisplayList の実サイズは取れないため、生成時間から見積もる。
      // 線分 15 万本のページ（生成 0.3〜0.5 秒）でノード1つ 60〜100 バイト程度、
      // 実サイズは 10〜20MB と見込み、1ページの見積もりを 2〜12MB に収める。
      const estimatedBytes = Math.min(
        12 * 1024 * 1024,
        Math.max(2 * 1024 * 1024, Math.ceil(elapsed * 32 * 1024)),
      )
      this.entries.set(key, { list, usedAt: ++this.clock, estimatedBytes })
      this.bytes += estimatedBytes
      this.evict()
      return list
    } catch (error) {
      device?.destroy()
      list?.destroy()
      throw error
    } finally {
      page.destroy()
    }
  }

  clear(): void {
    for (const { list } of this.entries.values()) list.destroy()
    this.entries.clear()
    this.bytes = 0
  }

  destroy(): void {
    this.clear()
  }

  private evict(): void {
    while (this.bytes > this.maxBytes && this.entries.size > 1) {
      let oldestKey: string | undefined
      let oldest = Number.POSITIVE_INFINITY
      for (const [key, entry] of this.entries) {
        if (entry.usedAt < oldest) {
          oldest = entry.usedAt
          oldestKey = key
        }
      }
      if (oldestKey === undefined) return
      const entry = this.entries.get(oldestKey)
      entry?.list.destroy()
      this.bytes -= entry?.estimatedBytes ?? 0
      this.entries.delete(oldestKey)
    }
  }
}
