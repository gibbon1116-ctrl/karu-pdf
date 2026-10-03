import { SYMBOL_OPTIONS, type RGB, type SymbolName } from '../core/annotations'
import type { FontName } from '../core/fontMetrics'

export const FORMAT_STORAGE_KEY = 'karu-pdf:format'

export type FormatTool = 'change' | 'count' | 'cloudSquare' | 'cloudPolygon' | 'issue' | 'distance' | 'perimeter' | 'area' | 'text' | 'callout' | 'line' | 'arrow' | 'square' | 'circle' | 'highlight' | 'ink' | 'textHighlight' | 'underline' | 'strikeout' | 'symbol'

export interface ToolFormat {
  countGroup?: string
  arrowHeadSize?: number | null
  cloudIntensity: 0 | 1 | 2
  color: RGB
  borderWidth: number
  fontSize: number
  font: FontName
  fillColor: RGB | null
  borderColor: RGB | null
  opacity: number
  textOpacity: number
  boxOpacity: number
  symbolSize: number
  symbol: SymbolName
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
  symbol: SymbolName = 'check',
  textOpacity = 1,
  boxOpacity = 1,
  symbolSize = 16,
): ToolFormat {
  return {
    arrowHeadSize: null,
    cloudIntensity: 1,
    color: [...color], borderWidth, fontSize, font,
    fillColor: fillColor ? [...fillColor] : null,
    borderColor: borderColor ? [...borderColor] : null,
    opacity,
    textOpacity,
    boxOpacity,
    symbolSize,
    symbol,
  }
}

export const DEFAULT_FORMAT: FormatDefaults = {
  change: format([.55, .1, .7]),
  count: { ...format([0, .25, 1]), symbol: 'circle', symbolSize: 8, countGroup: '照明器具' },
  cloudSquare: format(red, 1, 10.5, 'BIZUDGothic', null, red),
  cloudPolygon: format(red, 1, 10.5, 'BIZUDGothic', null, red),
  issue: format(red),
  distance: format(red), perimeter: format(red), area: format(red),
  text: format(red),
  callout: format(red, 1, 10.5, 'BIZUDGothic', [1, 1, 1], red),
  line: format(red),
  arrow: format(red),
  square: format(red, 1, 10.5, 'BIZUDGothic', null, red),
  circle: format(red, 1, 10.5, 'BIZUDGothic', null, red),
  highlight: format(yellow, 12, 10.5, 'BIZUDGothic', null, null, 0.35),
  ink: format(red, 1.5),
  textHighlight: format(yellow, 1, 10.5, 'BIZUDGothic', null, null, 0.4),
  underline: format(red),
  strikeout: format(red),
  symbol: format(red),
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
    arrowHeadSize: typeof item.arrowHeadSize === 'number' && Number.isFinite(item.arrowHeadSize) && item.arrowHeadSize >= 2 && item.arrowHeadSize <= 72 ? item.arrowHeadSize : null,
    cloudIntensity: item.cloudIntensity === 0 || item.cloudIntensity === 1 || item.cloudIntensity === 2 ? item.cloudIntensity : fallback.cloudIntensity,
    color: validColor(item.color) ? [...item.color] : [...fallback.color],
    borderWidth: typeof item.borderWidth === 'number' && Number.isFinite(item.borderWidth) ? item.borderWidth : fallback.borderWidth,
    fontSize: typeof item.fontSize === 'number' && Number.isFinite(item.fontSize) ? item.fontSize : fallback.fontSize,
    font: item.font === 'BIZUDMincho' || item.font === 'BIZUDGothic' ? item.font : fallback.font,
    fillColor: item.fillColor === null ? null : validColor(item.fillColor) ? [...item.fillColor] : fallback.fillColor ? [...fallback.fillColor] : null,
    borderColor: item.borderColor === null ? null : validColor(item.borderColor) ? [...item.borderColor] : legacyBorder ? [...legacyBorder] : null,
    opacity: typeof item.opacity === 'number' && [0.25, 0.35, 0.4, 0.5, 0.75, 1].includes(item.opacity) ? item.opacity : fallback.opacity,
    textOpacity: typeof item.textOpacity === 'number' && [0.25, 0.5, 0.75, 1].includes(item.textOpacity) ? item.textOpacity : fallback.textOpacity,
    boxOpacity: typeof item.boxOpacity === 'number' && [0.25, 0.5, 0.75, 1].includes(item.boxOpacity) ? item.boxOpacity : fallback.boxOpacity,
    symbolSize: typeof item.symbolSize === 'number' && [8, 12, 16, 24, 32, 48, 72].includes(item.symbolSize) ? item.symbolSize : fallback.symbolSize,
    symbol: SYMBOL_OPTIONS.some((option) => option.name === item.symbol) ? item.symbol as SymbolName : fallback.symbol,
    countGroup: typeof item.countGroup === 'string' && item.countGroup.trim() && item.countGroup.length <= 80 ? item.countGroup : fallback.countGroup,
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
