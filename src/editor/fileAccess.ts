export interface FileSystemWritableFileStreamLike {
  write(data: BufferSource | Blob | string): Promise<void>
  close(): Promise<void>
}

export interface PdfFileHandle {
  readonly name?: string
  getFile(): Promise<File>
  queryPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  isSameEntry?(other: PdfFileHandle): Promise<boolean>
  createWritable(): Promise<FileSystemWritableFileStreamLike>
}

export interface PdfDirectoryHandle {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<PdfFileHandle>
}

export const PDF_PICKER_TYPES = [{
  description: 'PDF',
  accept: { 'application/pdf': ['.pdf'] },
}]

declare global {
  interface Window {
    showOpenFilePicker?: (options: {
      id?: string
      multiple?: boolean
      types?: typeof PDF_PICKER_TYPES
      startIn?: PdfFileHandle
    }) => Promise<PdfFileHandle[]>
    showSaveFilePicker?: (options: {
      id?: string
      suggestedName?: string
      types?: typeof PDF_PICKER_TYPES
      startIn?: PdfFileHandle
    }) => Promise<PdfFileHandle>
    showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<PdfDirectoryHandle>
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

export async function pickOpenHandles(startIn?: PdfFileHandle): Promise<PdfFileHandle[]> {
  if (!window.showOpenFilePicker) return []
  const options = { id: 'karu-pdf-open', multiple: true, types: PDF_PICKER_TYPES }
  if (!startIn) return window.showOpenFilePicker(options)
  try {
    return await window.showOpenFilePicker({ ...options, startIn })
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') throw reason
    return window.showOpenFilePicker(options)
  }
}

export async function pickSaveHandle(suggestedName: string, startIn?: PdfFileHandle): Promise<PdfFileHandle | null> {
  if (!window.showSaveFilePicker) return null
  const options = { id: 'karu-pdf-save', suggestedName, types: PDF_PICKER_TYPES }
  if (!startIn) return window.showSaveFilePicker(options)
  try {
    return await window.showSaveFilePicker({ ...options, startIn })
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') throw reason
    return window.showSaveFilePicker(options)
  }
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

export async function writePdfWithoutOverwrite(
  directory: PdfDirectoryHandle,
  desiredName: string,
  bytes: Uint8Array,
): Promise<string> {
  const extension = desiredName.toLowerCase().endsWith('.pdf') ? '.pdf' : ''
  const stem = extension ? desiredName.slice(0, -extension.length) : desiredName
  for (let suffix = 1; ; suffix += 1) {
    const name = suffix === 1 ? `${stem}${extension}` : `${stem} (${suffix})${extension}`
    try {
      await directory.getFileHandle(name)
    } catch (reason) {
      if (!(reason instanceof DOMException) || reason.name !== 'NotFoundError') throw reason
      const handle = await directory.getFileHandle(name, { create: true })
      await writePdf(handle, bytes)
      return name
    }
  }
}
