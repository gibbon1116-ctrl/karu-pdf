import { createElement, type ComponentProps, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CountStyle } from '../src/core/countFixtures'
import { CountMarker, countMarkerData, countSvgPath } from '../src/editor/countMarkers'

type MarkerProps = ComponentProps<typeof CountMarker>
const compare = (CountMarker as unknown as { compare: (a: object, b: object) => boolean }).compare
const renderView = (CountMarker as unknown as { type: (props: MarkerProps) => ReactElement }).type

function makeStyle(): CountStyle {
  return {
    shape: 'circle', fill: 'solid', color: [0.2, 0.6, 0.9],
    size: 10, opacity: 0.8, showCode: true,
  }
}

const styleChanges: Array<[string, Partial<CountStyle>]> = [
  ['color', { color: [0.2, 0.600001, 0.9] }],
  ['size', { size: 12 }],
  ['fill', { fill: 'none' }],
  ['shape', { shape: 'square' }],
  ['opacity', { opacity: 0.5 }],
  ['showCode', { showCode: false }],
]
const propChanges: Array<[string, Partial<MarkerProps>]> = [
  ['x', { x: 11 }],
  ['y', { y: 21 }],
  ['code', { code: 'B2' }],
  ['showCode', { showCode: false }],
]

describe('count marker memo comparison', () => {
  it('is memoized and accepts equal styles with different references', () => {
    expect((CountMarker as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    expect(typeof compare).toBe('function')
    const a: MarkerProps = { style: makeStyle(), code: 'A1', x: 10, y: 20, showCode: true }
    const b: MarkerProps = { ...a, style: makeStyle() }
    expect(b.style).not.toBe(a.style)
    expect(b.style.color).not.toBe(a.style.color)
    expect(compare(a, b)).toBe(true)
    expect(compare(a, { ...a })).toBe(true)
  })

  it.each(styleChanges)('rejects a changed style %s', (_field, change) => {
    const a: MarkerProps = { style: makeStyle() }
    const b: MarkerProps = { style: { ...makeStyle(), ...change } }
    expect(compare(a, b)).toBe(false)
    expect(compare(b, a)).toBe(false)
  })

  it.each(propChanges)('rejects a changed prop %s even with the same style reference', (_field, change) => {
    const a: MarkerProps = { style: makeStyle(), code: 'A1', x: 10, y: 20, showCode: true }
    expect(compare(a, { ...a, ...change })).toBe(false)
  })

  it('rejects missing style keys and compares additional own keys', () => {
    const style = makeStyle()
    for (const key of Object.keys(style)) {
      const missing: Partial<CountStyle> = { ...style }
      delete missing[key as keyof CountStyle]
      expect(compare({ style }, { style: missing })).toBe(false)
      expect(compare({ style: missing }, { style })).toBe(false)
    }
    const extra = { ...makeStyle(), futureField: undefined }
    expect(compare({ style }, { style: extra })).toBe(false)
    expect(compare({ style: extra }, { style })).toBe(false)
    expect(compare({ style: extra }, { style: { ...makeStyle(), futureField: undefined } })).toBe(true)
    expect(compare({ style: extra }, { style: { ...makeStyle(), futureField: 1 } })).toBe(false)
  })

  it('uses Object.is for numeric props and style fields', () => {
    const style = makeStyle()
    expect(compare({ style, x: NaN, y: NaN }, { style, x: NaN, y: NaN })).toBe(true)
    expect(compare({ style, x: -0 }, { style, x: 0 })).toBe(false)
    expect(compare({ style, y: -0 }, { style, y: 0 })).toBe(false)
    expect(compare({ style }, { style, x: 0 })).toBe(false)
    expect(compare({ style }, { style, showCode: true })).toBe(false)
    expect(compare({ style }, { style, code: '' })).toBe(false)
    expect(compare(
      { style: { ...makeStyle(), size: NaN } },
      { style: { ...makeStyle(), size: NaN } },
    )).toBe(true)
    expect(compare(
      { style: { ...makeStyle(), size: -0 } },
      { style: { ...makeStyle(), size: 0 } },
    )).toBe(false)
    expect(compare(
      { style: { ...makeStyle(), color: [NaN, -0, 0.9] } },
      { style: { ...makeStyle(), color: [NaN, -0, 0.9] } },
    )).toBe(true)
    expect(compare(
      { style: { ...makeStyle(), color: [0.2, -0, 0.9] } },
      { style: { ...makeStyle(), color: [0.2, 0, 0.9] } },
    )).toBe(false)
  })
})

const examples: Array<[CountStyle['shape'], CountStyle['fill']]> = [
  ['circle', 'solid'],
  ['doubleCircle', 'half'],
  ['star', 'hatch'],
  ['cross', 'dot'],
  ['square', 'none'],
]
const colors: CountStyle['color'][] = [[0.2, 0.6, 0.9], [1, 1, 1]]
const codeCases: Array<Pick<MarkerProps, 'code' | 'showCode'>> = [
  { code: 'A1', showCode: true },
  { code: 'A1', showCode: false },
  { code: '', showCode: true },
  { showCode: true },
  { code: 'A1' },
  {},
]

describe('count marker memo rendering', () => {
  it.each(examples)('preserves paths and code visibility for %s/%s', (shape, fill) => {
    for (const color of colors) for (const styleShowCode of [true, false]) for (const codeProps of codeCases) {
      const style: CountStyle = { ...makeStyle(), shape, fill, color, showCode: styleShowCode }
      const props: MarkerProps = { style, x: 123.25, y: -7.1, ...codeProps }
      const markup = renderToStaticMarkup(createElement(CountMarker, props))
      expect(markup).toBe(renderToStaticMarkup(renderView(props)))

      const data = countMarkerData(style, props.x, props.y)
      const outline = countSvgPath(data.outline)
      expect(markup).toContain(`d="${countSvgPath(data.fills)}"`)
      expect(markup).toContain(`d="${outline} ${countSvgPath(data.strokes, false)}"`)
      if (data.bright) expect(markup).toContain(`d="${outline}"`)
      expect(markup.match(/<path\b/g) ?? []).toHaveLength(data.bright ? 3 : 2)
      expect(markup).toContain(`opacity="${data.opacity}"`)
      expect(markup).toContain('pointer-events="none"')
      expect(markup).toContain(`data-count-shape="${shape}"`)
      expect(markup).toContain(`data-count-fill="${fill}"`)
      expect(markup).toContain(`fill="${data.color}"`)

      const hasCode = style.showCode && (props.showCode ?? true) && Boolean(props.code)
      expect(markup.includes('<text')).toBe(hasCode)
      if (hasCode) {
        expect(markup).toContain(`x="${data.code.x}"`)
        expect(markup).toContain(`y="${data.code.y}"`)
        expect(markup).toContain(`font-size="${data.code.size}"`)
        expect(markup).toContain('>A1</text>')
      }
    }
  })

  it('preserves default coordinates and code visibility', () => {
    const style = makeStyle()
    const props: MarkerProps = { style, code: 'A1' }
    const markup = renderToStaticMarkup(createElement(CountMarker, props))
    const data = countMarkerData(style)
    expect(markup).toBe(renderToStaticMarkup(renderView(props)))
    expect(markup).toContain(`d="${countSvgPath(data.outline)} ${countSvgPath(data.strokes, false)}"`)
    expect(markup).toContain(`x="${data.code.x}"`)
    expect(markup).toContain(`y="${data.code.y}"`)
    expect(markup).toContain('>A1</text>')
  })
})
