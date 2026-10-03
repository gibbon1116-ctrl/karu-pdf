import type { AnnotationEdit, ApplyResult } from './annotations'
import { applyEdits } from './annotations'
import type { FontResources } from './fontMetrics'
import { openDocument } from './mupdfDoc'
import { saveDocument } from './save'
import { createSafeOutput, type SafeOutputOptions } from './safeOutput'
import { assertEditablePdf } from './pdfRestrictions'
import { applyTextCorrection, type TextCorrection } from './textCorrection'

export interface PreparedDocumentOutput {
  bytes: Uint8Array
  ms: number
  applied: ApplyResult
}

export function prepareDocumentOutput(
  source: Uint8Array,
  edits: readonly AnnotationEdit[],
  fontResources: FontResources,
  bake: boolean,
  safe?: SafeOutputOptions,
  correction?: TextCorrection,
): PreparedDocumentOutput {
  const started = performance.now()
  const output = openDocument(source)
  try {
    const document = output.document.asPDF()
    if (!document) throw new Error('PDF 文書ではありません。')
    if (output.editRestriction) {
      if (bake || safe || correction || edits.length) assertEditablePdf(document)
      return { bytes: source.slice(), ms: performance.now() - started, applied: { created: [], errors: [], replacedCharacters: 0, unsupportedCharacters: [] } }
    }
    const applied = applyEdits(document, edits, fontResources)
    if (applied.errors.length) throw new Error(applied.errors.map(error => error.message).join(' / '))
    if (correction) applyTextCorrection(document, correction, fontResources)
    if (safe) return { bytes: createSafeOutput(document, safe), ms: performance.now() - started, applied }
    if (bake) document.bake(true, false)
    const saved = saveDocument(document, bake || correction ? 'full' : 'incremental')
    return { bytes: saved.bytes, ms: performance.now() - started, applied }
  } finally {
    output.document.destroy()
  }
}
