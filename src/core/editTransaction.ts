import type { PDFDocument } from 'mupdf'
import { applyEdits, type AnnotationEdit, type ApplyResult } from './annotations'
import type { FontResources } from './fontMetrics'
import { saveDocument, type SaveMode } from './save'
import { openDocument, type OpenedDocument } from './mupdfDoc'
import { assertEditablePdf } from './pdfRestrictions'

/** MuPDF journals changed objects, avoiding a copy of a large drawing. */
export function pdfOperation<T>(document: PDFDocument, action: () => T): T {
  assertEditablePdf(document)
  document.enableJournal()
  document.beginOperation('かるPDF 編集')
  try {
    const result = action()
    document.endOperation()
    return result
  } catch (error) {
    document.abandonOperation()
    throw error
  }
}

export function applyEditsAtomically(document: PDFDocument, edits: readonly AnnotationEdit[], fonts: FontResources): ApplyResult {
  return pdfOperation(document, () => {
    const applied = applyEdits(document, edits, fonts)
    if (applied.errors.length) throw new Error(applied.errors.map(error => error.message).join(' / '))
    return applied
  })
}

export function applyAndSaveAtomically(document: PDFDocument, edits: readonly AnnotationEdit[], fonts: FontResources, mode: SaveMode) {
  const staged: { opened: OpenedDocument | null } = { opened: null }
  try {
    return pdfOperation(document, () => {
      const applied = applyEdits(document, edits, fonts)
      if (applied.errors.length) throw new Error(applied.errors.map(error => error.message).join(' / '))
      const saved = saveDocument(document, mode)
      // Validate before committing and reuse this copy as the next baseline.
      const opened = openDocument(saved.bytes)
      staged.opened = opened
      return { applied, saved, opened }
    })
  } catch (error) { staged.opened?.document.destroy(); throw error }
}
