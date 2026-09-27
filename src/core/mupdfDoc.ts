import mupdf, { type Document } from 'mupdf'

export interface PageSize {
  width: number
  height: number
}

export interface OpenedDocument {
  document: Document
  pageCount: number
  pageSizes: PageSize[]
  openMs: number
  sizesMs: number
}

const now = () => performance.now()

export function openDocument(bytes: Uint8Array): OpenedDocument {
  const openStart = now()
  const document = mupdf.Document.openDocument(bytes, 'application/pdf')
  const openMs = now() - openStart
  if (!document.isPDF()) {
    document.destroy()
    throw new Error('PDF ファイルではありません。')
  }

  const sizesStart = now()
  const pageCount = document.countPages()
  const pageSizes: PageSize[] = []
  for (let index = 0; index < pageCount; index += 1) {
    const page = document.loadPage(index)
    try {
      const [x0, y0, x1, y1] = page.getBounds()
      pageSizes.push({ width: x1 - x0, height: y1 - y0 })
    } finally {
      page.destroy()
    }
  }

  return { document, pageCount, pageSizes, openMs, sizesMs: now() - sizesStart }
}
