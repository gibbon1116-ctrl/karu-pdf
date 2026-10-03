import mupdf, { type Document } from 'mupdf'
import { pdfEditRestriction } from './pdfRestrictions'

export interface PageSize {
  width: number
  height: number
}

export interface OpenedDocument {
  editRestriction: string | null
  document: Document
  pageCount: number
  pageSizes: PageSize[]
  openMs: number
  sizesMs: number
}

const now = () => performance.now()

export function openDocument(bytes: Uint8Array, includePageSizes = true): OpenedDocument {
  const openStart = now()
  const document = mupdf.Document.openDocument(bytes, 'application/pdf')
  const openMs = now() - openStart
  if (document.needsPassword()) {
    document.destroy()
    throw new Error('パスワードが必要なPDFには対応していません。権限のある方法で解除したコピーを使用してください。')
  }
  if (!document.isPDF()) {
    document.destroy()
    throw new Error('PDF ファイルではありません。')
  }

  const sizesStart = now()
  const pageCount = document.countPages()
  const pageSizes: PageSize[] = []
  for (let index = 0; includePageSizes && index < pageCount; index += 1) {
    const page = document.loadPage(index)
    try {
      const [x0, y0, x1, y1] = page.getBounds()
      pageSizes.push({ width: x1 - x0, height: y1 - y0 })
    } finally {
      page.destroy()
    }
  }

  return { document, pageCount, pageSizes, openMs, sizesMs: now() - sizesStart, editRestriction: pdfEditRestriction(document.asPDF()!) }
}
