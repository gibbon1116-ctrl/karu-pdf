import type { AnnotationEdit, ApplyResult } from './annotations'
import { applyEdits } from './annotations'
import type { FontResources } from './fontMetrics'
import { openDocument } from './mupdfDoc'
import { saveDocument } from './save'
import { assertEditablePdf } from './pdfRestrictions'

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
): PreparedDocumentOutput {
  const started = performance.now()
  const output = openDocument(source)
  try {
    const document = output.document.asPDF()
    if (!document) throw new Error('PDF 文書ではありません。')
    if (output.editRestriction) {
      if (bake || edits.length) assertEditablePdf(document)
      return { bytes: source.slice(), ms: performance.now() - started, applied: { created: [], errors: [], replacedCharacters: 0, unsupportedCharacters: [] } }
    }
    const applied = applyEdits(document, edits, fontResources)
    if (applied.errors.length) throw new Error(applied.errors.map(error => error.message).join(' / '))
    if (bake) document.bake(true, false)
    const saved = saveDocument(document, bake ? 'full' : 'incremental')
    return { bytes: saved.bytes, ms: performance.now() - started, applied }
  } finally {
    output.document.destroy()
  }
}
