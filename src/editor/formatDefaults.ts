import type { RGB } from '../core/annotations'
import type { FontName } from '../core/fontMetrics'

export const FORMAT_STORAGE_KEY = 'karu-pdf:format'

export type FormatTool = 'text' | 'callout' | 'line' | 'arrow' | 'square' | 'circle' | 'highlight' | 'ink'

export interface ToolFormat {
  color: RGB
  borderWidth: number
  fontSize: number
  font: FontName
  fillColor: RGB | null
  borderColor: RGB | null
  opacity: number
}

export type FormatDefaults = Record<FormatTool, ToolFormat>

const red: RGB = [1, 0, 0]
const yellow: RGB = [1, 0.9, 0]

function format(
  color: RGB,
  borderWidth = 1,
  fontSize = 10.5,
  font: FontName = 'BIZUDGothic',
  fillColor: RGB | null = null,
  borderColor: RGB | null = null,
  opacity = 1,
): ToolFormat {
  return {
    color: [...color], borderWidth, fontSize, font,
    fillColor: fillColor ? [...fillColor] : null,
    borderColor: borderColor ? [...borderColor] : null,
    opacity,
  }
}

export const DEFAULT_FORMAT: FormatDefaults = {
  text: format(red),
  callout: format(red, 1, 10.5, 'BIZUDGothic', [1, 1, 1], red),
  line: format(red),
  arrow: format(red),
  square: format(red, 1, 10.5, 'BIZUDGothic', null, red),
  circle: format(red, 1, 10.5, 'BIZUDGothic', null, red),
  highlight: format(yellow, 12),
  ink: format(red, 1.5),
}

function validColor(value: unknown): value is RGB {
  return Array.isArray(value)
    && value.length === 3
    && value.every((component) => typeof component === 'number' && Number.isFinite(component) && component >= 0 && component <= 1)
}

function readTool(value: unknown, fallback: ToolFormat): ToolFormat {
  const item = value && typeof value === 'object' ? value as Partial<ToolFormat> : {}
  const legacyBorder = fallback.borderColor && validColor(item.color) ? item.color : fallback.borderColor
  return {
    color: validColor(item.color) ? [...item.color] : [...fallback.color],
    borderWidth: typeof item.borderWidth === 'number' && Number.isFinite(item.borderWidth) ? item.borderWidth : fallback.borderWidth,
    fontSize: typeof item.fontSize === 'number' && Number.isFinite(item.fontSize) ? item.fontSize : fallback.fontSize,
    font: item.font === 'BIZUDMincho' || item.font === 'BIZUDGothic' ? item.font : fallback.font,
    fillColor: item.fillColor === null ? null : validColor(item.fillColor) ? [...item.fillColor] : fallback.fillColor ? [...fallback.fillColor] : null,
    borderColor: item.borderColor === null ? null : validColor(item.borderColor) ? [...item.borderColor] : legacyBorder ? [...legacyBorder] : null,
    opacity: typeof item.opacity === 'number' && [0.25, 0.5, 1].includes(item.opacity) ? item.opacity : fallback.opacity,
  }
}

export function loadFormatDefaults(storage: Storage | null = storageOrNull()): FormatDefaults {
  try {
    const raw = storage?.getItem(FORMAT_STORAGE_KEY)
    if (!raw) return cloneDefaults(DEFAULT_FORMAT)
    const value = JSON.parse(raw) as Record<string, unknown>
    // 旧版の { color, borderWidth, fontSize } は、全ツールの初期値として引き継ぐ。
    const legacy = 'color' in value || 'borderWidth' in value || 'fontSize' in value
    return Object.fromEntries((Object.keys(DEFAULT_FORMAT) as FormatTool[]).map((tool) => [
      tool,
      readTool(value[tool], legacy ? readTool(value, DEFAULT_FORMAT[tool]) : DEFAULT_FORMAT[tool]),
    ])) as FormatDefaults
  } catch {
    return cloneDefaults(DEFAULT_FORMAT)
  }
}

export function saveFormatDefaults(value: FormatDefaults, storage: Storage | null = storageOrNull()): void {
  try { storage?.setItem(FORMAT_STORAGE_KEY, JSON.stringify(value)) } catch { /* 編集は続ける。 */ }
}

export function updateToolFormat(defaults: FormatDefaults, tool: FormatTool, values: Partial<ToolFormat>): FormatDefaults {
  return {
    ...defaults,
    [tool]: {
      ...defaults[tool],
      ...values,
      color: values.color ? [...values.color] : defaults[tool].color,
      fillColor: values.fillColor === undefined ? defaults[tool].fillColor : values.fillColor ? [...values.fillColor] : null,
      borderColor: values.borderColor === undefined ? defaults[tool].borderColor : values.borderColor ? [...values.borderColor] : null,
    },
  }
}

function cloneDefaults(value: FormatDefaults): FormatDefaults {
  return Object.fromEntries((Object.keys(value) as FormatTool[]).map((tool) => [tool, {
    ...value[tool],
    color: [...value[tool].color],
    fillColor: value[tool].fillColor ? [...value[tool].fillColor] : null,
    borderColor: value[tool].borderColor ? [...value[tool].borderColor] : null,
  }])) as FormatDefaults
}

function storageOrNull(): Storage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}
