import type { PDFDocument } from 'mupdf'
import { applyEdits, type AnnotationEdit, type ApplyResult } from './annotations'
import type { FontResources } from './fontMetrics'
import { saveDocument, type SaveMode } from './save'
import { documentPassword, openDocument, type OpenedDocument } from './mupdfDoc'
import { assertEditablePdf } from './pdfRestrictions'
import { hasOutline, readOutline } from './outline'

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

/** Bound journal lookup work while retaining rollback across all chunks. */
export function pdfChunkedOperation<T>(document: PDFDocument, action: (checkpoint: () => void) => T): T {
  assertEditablePdf(document)
  document.enableJournal()
  const initialPosition = document.getJournal().position
  document.beginOperation('かるPDF 編集')
  let operationOpen = true
  let checkpoints = 0
  let completedOperations = 0
  const checkpoint = () => {
    if (++checkpoints % 50 !== 0) return
    document.endOperation()
    operationOpen = false
    completedOperations++
    document.beginOperation('かるPDF 編集')
    operationOpen = true
  }
  try {
    const result = action(checkpoint)
    document.endOperation()
    operationOpen = false
    return result
  } catch (error) {
    if (operationOpen) document.abandonOperation()
    // Empty chunks need not produce journal entries. Never undo an earlier call.
    const undoCount = Math.min(completedOperations, document.getJournal().position - initialPosition)
    for (let index = 0; index < undoCount; index++) document.undo()
    throw error
  }
}

export function applyEditsAtomically(document: PDFDocument, edits: readonly AnnotationEdit[], fonts: FontResources): ApplyResult {
  return pdfChunkedOperation(document, checkpoint => {
    const applied = applyEdits(document, edits, fonts, { checkpoint })
    if (applied.errors.length) throw new Error(applied.errors.map(error => error.message).join(' / '))
    return applied
  })
}

export function applyAndSaveAtomically(document: PDFDocument, edits: readonly AnnotationEdit[], fonts: FontResources, mode: SaveMode) {
  const staged: { opened: OpenedDocument | null } = { opened: null }
  try {
    return pdfChunkedOperation(document, checkpoint => {
      const applied = applyEdits(document, edits, fonts, { checkpoint })
      if (applied.errors.length) throw new Error(applied.errors.map(error => error.message).join(' / '))
      const saved = saveDocument(document, mode)
      // Validate before committing and reuse this copy as the next baseline.
      const opened = openDocument(saved.bytes, true, documentPassword(document))
      staged.opened = opened
      if (hasOutline(document) && readOutline(document).revision !== readOutline(opened.document.asPDF()!).revision) throw new Error('保存後の目次が保存前と一致しません。')
      return { applied, saved, opened }
    })
  } catch (error) { staged.opened?.document.destroy(); throw error }
}
