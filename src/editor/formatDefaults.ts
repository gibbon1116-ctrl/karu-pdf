import type { RGB } from '../core/annotations'

export const FORMAT_STORAGE_KEY = 'karu-pdf:format'

export interface FormatDefaults {
  color: RGB
  borderWidth: number
  fontSize: number
}

export const DEFAULT_FORMAT: FormatDefaults = {
  color: [1, 0, 0],
  borderWidth: 1,
  fontSize: 10.5,
}

function validColor(value: unknown): value is RGB {
  return Array.isArray(value)
    && value.length === 3
    && value.every((component) => typeof component === 'number' && Number.isFinite(component) && component >= 0 && component <= 1)
}

export function loadFormatDefaults(storage: Storage | null = storageOrNull()): FormatDefaults {
  try {
    const raw = storage?.getItem(FORMAT_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_FORMAT, color: [...DEFAULT_FORMAT.color] }
    const value = JSON.parse(raw) as Partial<FormatDefaults>
    return {
      color: validColor(value.color) ? [...value.color] : [...DEFAULT_FORMAT.color],
      borderWidth: typeof value.borderWidth === 'number' && Number.isFinite(value.borderWidth)
        ? value.borderWidth
        : DEFAULT_FORMAT.borderWidth,
      fontSize: typeof value.fontSize === 'number' && Number.isFinite(value.fontSize)
        ? value.fontSize
        : DEFAULT_FORMAT.fontSize,
    }
  } catch {
    return { ...DEFAULT_FORMAT, color: [...DEFAULT_FORMAT.color] }
  }
}

export function saveFormatDefaults(value: FormatDefaults, storage: Storage | null = storageOrNull()): void {
  try {
    storage?.setItem(FORMAT_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // localStorage が使えなくても編集は続ける。
  }
}

function storageOrNull(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}
