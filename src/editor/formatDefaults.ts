import type { RGB } from '../core/annotations'
import type { FontName } from '../core/fontMetrics'

export const FORMAT_STORAGE_KEY = 'karu-pdf:format'

export type FormatTool = 'text' | 'line' | 'arrow' | 'square' | 'circle' | 'highlight' | 'ink' | 'whiteout'

export interface ToolFormat {
  color: RGB
  borderWidth: number
  fontSize: number
  font: FontName
}

export type FormatDefaults = Record<FormatTool, ToolFormat>

const red: RGB = [1, 0, 0]
const yellow: RGB = [1, 0.9, 0]

function format(color: RGB, borderWidth = 1, fontSize = 10.5, font: FontName = 'BIZUDGothic'): ToolFormat {
  return { color: [...color], borderWidth, fontSize, font }
}

export const DEFAULT_FORMAT: FormatDefaults = {
  text: format(red),
  line: format(red),
  arrow: format(red),
  square: format(red),
  circle: format(red),
  highlight: format(yellow, 12),
  ink: format(red, 1.5),
  whiteout: format(red, 0),
}

function validColor(value: unknown): value is RGB {
  return Array.isArray(value)
    && value.length === 3
    && value.every((component) => typeof component === 'number' && Number.isFinite(component) && component >= 0 && component <= 1)
}

function readTool(value: unknown, fallback: ToolFormat): ToolFormat {
  const item = value && typeof value === 'object' ? value as Partial<ToolFormat> : {}
  return {
    color: validColor(item.color) ? [...item.color] : [...fallback.color],
    borderWidth: typeof item.borderWidth === 'number' && Number.isFinite(item.borderWidth) ? item.borderWidth : fallback.borderWidth,
    fontSize: typeof item.fontSize === 'number' && Number.isFinite(item.fontSize) ? item.fontSize : fallback.fontSize,
    font: item.font === 'BIZUDMincho' || item.font === 'BIZUDGothic' ? item.font : fallback.font,
  }
}

export function loadFormatDefaults(storage: Storage | null = storageOrNull()): FormatDefaults {
  try {
    const raw = storage?.getItem(FORMAT_STORAGE_KEY)
    if (!raw) return cloneDefaults(DEFAULT_FORMAT)
    const value = JSON.parse(raw) as Record<string, unknown>
    // 旧版の { color, borderWidth, fontSize } は、全ツールの初期値として引き継ぐ。
    const legacy = 'color' in value || 'borderWidth' in value || 'fontSize' in value
      ? readTool(value, DEFAULT_FORMAT.text)
      : null
    return Object.fromEntries((Object.keys(DEFAULT_FORMAT) as FormatTool[]).map((tool) => [
      tool,
      readTool(value[tool], legacy ?? DEFAULT_FORMAT[tool]),
    ])) as FormatDefaults
  } catch {
    return cloneDefaults(DEFAULT_FORMAT)
  }
}

export function saveFormatDefaults(value: FormatDefaults, storage: Storage | null = storageOrNull()): void {
  try { storage?.setItem(FORMAT_STORAGE_KEY, JSON.stringify(value)) } catch { /* 編集は続ける。 */ }
}

export function updateToolFormat(defaults: FormatDefaults, tool: FormatTool, values: Partial<ToolFormat>): FormatDefaults {
  return { ...defaults, [tool]: { ...defaults[tool], ...values, color: values.color ? [...values.color] : defaults[tool].color } }
}

function cloneDefaults(value: FormatDefaults): FormatDefaults {
  return Object.fromEntries((Object.keys(value) as FormatTool[]).map((tool) => [tool, { ...value[tool], color: [...value[tool].color] }])) as FormatDefaults
}

function storageOrNull(): Storage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}
