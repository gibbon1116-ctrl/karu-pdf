import type { AnnotationEdit, ApplyResult } from './annotations'
import { applyEdits } from './annotations'
import type { FontResources } from './fontMetrics'
import { openDocument } from './mupdfDoc'
import { saveDocument } from './save'

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
    const applied = applyEdits(document, edits, fontResources)
    if (bake) document.bake(true, false)
    const saved = saveDocument(document, bake ? 'full' : 'incremental')
    return { bytes: saved.bytes, ms: performance.now() - started, applied }
  } finally {
    output.document.destroy()
  }
}
