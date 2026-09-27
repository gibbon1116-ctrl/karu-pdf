import type { RGB } from './annotations'

export interface ParsedDefaultAppearance {
  fontName: string | null
  fontSize: number | null
  color: RGB | null
}

function formatNumber(value: number, decimals: number): string {
  const rounded = Number(value.toFixed(decimals))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

export function createDefaultAppearance(fontName: string, fontSize: number, color: RGB): string {
  return `/${fontName} ${formatNumber(fontSize, 2)} Tf ${color
    .map((component) => formatNumber(component, 3))
    .join(' ')} rg`
}

function parseNumber(token: string | undefined): number | null {
  if (token === undefined || token.trim() === '') return null
  const value = Number(token)
  return Number.isFinite(value) ? value : null
}

export function parseDefaultAppearance(value: string): ParsedDefaultAppearance {
  const tokens = value.trim().split(/\s+/)
  let fontName: string | null = null
  let fontSize: number | null = null
  let color: RGB | null = null

  for (let index = 0; index < tokens.length; index += 1) {
    const operator = tokens[index]
    if (operator === 'Tf' && index >= 2 && tokens[index - 2].startsWith('/')) {
      fontName = tokens[index - 2].slice(1) || null
      fontSize = parseNumber(tokens[index - 1])
    } else if (operator === 'g' && index >= 1) {
      const gray = parseNumber(tokens[index - 1])
      if (gray !== null) color = [gray, gray, gray]
    } else if (operator === 'rg' && index >= 3) {
      const components = tokens.slice(index - 3, index).map((token) => parseNumber(token))
      if (components.every((component) => component !== null)) color = components as RGB
    } else if (operator === 'k' && index >= 4) {
      const components = tokens.slice(index - 4, index).map((token) => parseNumber(token))
      if (components.every((component) => component !== null)) {
        const [cyan, magenta, yellow, black] = components as [number, number, number, number]
        color = [
          1 - Math.min(1, cyan + black),
          1 - Math.min(1, magenta + black),
          1 - Math.min(1, yellow + black),
        ]
      }
    }
  }

  return { fontName, fontSize, color }
}
