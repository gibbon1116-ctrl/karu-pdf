export interface FileSystemWritableFileStreamLike {
  write(data: BufferSource | Blob | string): Promise<void>
  close(): Promise<void>
}

export interface PdfFileHandle {
  getFile(): Promise<File>
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>
  createWritable(): Promise<FileSystemWritableFileStreamLike>
}

export const PDF_PICKER_TYPES = [{
  description: 'PDF',
  accept: { 'application/pdf': ['.pdf'] },
}]

declare global {
  interface Window {
    showOpenFilePicker?: (options: {
      multiple?: boolean
      types?: typeof PDF_PICKER_TYPES
    }) => Promise<PdfFileHandle[]>
    showSaveFilePicker?: (options: {
      suggestedName?: string
      types?: typeof PDF_PICKER_TYPES
    }) => Promise<PdfFileHandle>
  }
}

export async function requestWritePermission(handle: PdfFileHandle): Promise<boolean> {
  if (!handle.requestPermission) return true
  if (handle.queryPermission && await handle.queryPermission({ mode: 'readwrite' }) === 'granted') return true
  return await handle.requestPermission({ mode: 'readwrite' }) === 'granted'
}

export async function writePdf(handle: PdfFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(new Uint8Array(bytes).buffer)
  await writable.close()
}

export async function pickSaveHandle(suggestedName: string): Promise<PdfFileHandle | null> {
  if (!window.showSaveFilePicker) return null
  return window.showSaveFilePicker({ suggestedName, types: PDF_PICKER_TYPES })
}

export function downloadPdf(bytes: Uint8Array, fileName: string): void {
  const copy = new Uint8Array(bytes)
  const url = URL.createObjectURL(new Blob([copy], { type: 'application/pdf' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
