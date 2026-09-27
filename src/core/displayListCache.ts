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
    maxBytes = 48 * 1024 * 1024,
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
      const estimatedBytes = Math.min(
        this.maxBytes,
        Math.max(4 * 1024 * 1024, Math.ceil(elapsed * 256 * 1024)),
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
