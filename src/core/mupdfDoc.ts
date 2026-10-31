import mupdf, { type Document } from 'mupdf'
import { PdfPasswordError } from './passwordAccess'
import { pdfEditRestriction } from './pdfRestrictions'

export interface PageSize {
  width: number
  height: number
}

export interface OpenedDocument {
  password?: string
  editRestriction: string | null
  document: Document
  pageCount: number
  pageSizes: PageSize[]
  openMs: number
  sizesMs: number
}

const passwords = new WeakMap<Document, string>()
export const documentPassword = (document: Document): string | undefined => passwords.get(document)

const now = () => performance.now()

export function openDocument(bytes: Uint8Array, includePageSizes = true, password?: string): OpenedDocument {
  const openStart = now()
  const document = mupdf.Document.openDocument(bytes, 'application/pdf')
  try {
    if (document.needsPassword()) {
      if (password === undefined) throw new PdfPasswordError('password-required')
      if (!document.authenticatePassword(password)) throw new PdfPasswordError('incorrect-password')
      passwords.set(document, password)
    }
    if (!document.isPDF()) {
      throw new Error('PDF ファイルではありません。')
    }

    const openMs = now() - openStart
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

    return { document, password: passwords.get(document), pageCount, pageSizes, openMs, sizesMs: now() - sizesStart, editRestriction: pdfEditRestriction(document.asPDF()!) }
  } catch (error) {
    document.destroy()
    throw error
  }
}
