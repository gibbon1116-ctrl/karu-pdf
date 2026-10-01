import type { ImageInfo } from '../client/ImageWorkerClient'
import type { ImagePdfSettings } from '../core/imagePdfLayout'

export const IMAGE_ACCEPT = 'image/jpeg,image/png,.jpg,.jpeg,.png,.heic,.heif'
export const IMAGE_PICKER_TYPES = [{ description: '画像（JPEG・PNG）', accept: { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/heic': ['.heic', '.heif'] } }]
export function isImageFile(file: File) { return /^image\//.test(file.type) || /\.(jpe?g|png|hei[cf])$/i.test(file.name) }
export async function pickImages(fallback: () => void): Promise<File[]> {
  if (!window.showOpenFilePicker) { fallback(); return [] }
  // fileAccess's existing declaration narrows the browser API to PDF picker types.
  const picker = window.showOpenFilePicker as unknown as (options: { id: string; multiple: boolean; types: typeof IMAGE_PICKER_TYPES }) => ReturnType<NonNullable<Window['showOpenFilePicker']>>
  const handles = await picker({ id: 'karu-pdf-images', multiple: true, types: IMAGE_PICKER_TYPES })
  return Promise.all(handles.map(handle => handle.getFile()))
}

export interface ImageEntry { id: number; order: number; file: File; info?: ImageInfo; error?: string }
export type ImageSort = 'selected' | 'name' | 'date'
function shotTime(entry: ImageEntry) {
  if (!entry.info?.dateTime) return entry.file.lastModified
  const [year, month, day, hour, minute, second] = entry.info.dateTime.split(/[: ]/).map(Number)
  const time = new Date(year, month - 1, day, hour, minute, second).getTime()
  return Number.isFinite(time) ? time : entry.file.lastModified
}
export function sortImageEntries(entries: readonly ImageEntry[], sort: ImageSort): ImageEntry[] {
  const collator = new Intl.Collator('ja', { numeric: true })
  return [...entries].sort((a, b) => (sort === 'name' ? collator.compare(a.file.name, b.file.name) : sort === 'date' ? shotTime(a) - shotTime(b) : a.order - b.order) || a.order - b.order)
}
export function estimateImagePdf(entries: readonly ImageEntry[], quality: ImagePdfSettings['quality']): number {
  return entries.filter(e => !e.error).reduce((sum, e) => {
    if (quality === 'original' || !e.info) return sum + e.file.size
    const cap = quality === 'standard' ? 2400 : 1600, scale = Math.min(1, cap / Math.max(e.info.width, e.info.height))
    return sum + e.info.width * e.info.height * scale * scale * (quality === 'standard' ? .35 : .22)
  }, 0)
}
export function imagesPdfName(date = new Date()) {
  return `画像から作成_${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}.pdf`
}
