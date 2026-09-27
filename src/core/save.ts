import type { PDFDocument } from 'mupdf'

export type SaveMode = 'incremental' | 'full'

export interface SaveResult {
  bytes: Uint8Array
  mode: SaveMode
  ms: number
}

export function saveDocument(doc: PDFDocument, requestedMode: SaveMode): SaveResult {
  const mode: SaveMode = requestedMode === 'incremental' && doc.canBeSavedIncrementally()
    ? 'incremental'
    : 'full'
  const options = mode === 'incremental'
    ? 'incremental'
    : 'garbage=4,compress,compress-images'
  const started = performance.now()
  const buffer = doc.saveToBuffer(options)
  try {
    return {
      bytes: new Uint8Array(buffer.asUint8Array()),
      mode,
      ms: performance.now() - started,
    }
  } finally {
    buffer.destroy()
  }
}
