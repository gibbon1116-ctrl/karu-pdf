import { describe, expect, it } from 'vitest'
import {
  parseCountFixtures,
  serializeCountFixtures,
  type CountFixture,
} from '../src/core/countFixtures'
import {
  fixtureLinkError,
  shapeBaseEdgeLength,
  shapeLengthTimesHeight,
  type FixtureLink,
} from '../src/core/fixtureLink'

const style: CountFixture['style'] = {
  shape: 'circle',
  fill: 'none',
  color: [1, 0, 0],
  size: 10,
  opacity: .8,
  showCode: true,
}

function linkedFixture(shape: NonNullable<FixtureLink['shape']>): CountFixture {
  return {
    id: 'mark',
    name: '墨出し',
    code: 'M',
    category: '例',
    kind: 'area',
    method: 'polygon',
    style,
    order: 0,
    link: {
      kind: 'shape',
      shape,
      sources: [{ itemId: 'wall' }],
    },
  }
}

const rectangle = [
  { x: 0, y: 0 },
  { x: 125, y: 0 },
  { x: 125, y: 30 },
  { x: 0, y: 30 },
]

describe('lengthTimesHeight', () => {
  it.each(['polyline', 'lengthHeight'] as const)(
    '%s の線10mは高さ3.6mを転記せず帯幅1mで10㎡',
    method => {
      const result = shapeLengthTimesHeight({
        method,
        lengthM: 10,
        perimeterM: 27.2,
        heightM: 3.6,
        count: 1,
      }, {
        output: 'lengthTimesHeight',
        heightM: 1,
      })

      expect(result.quantity).toBe(10)
      expect(result.note).toBe('線の平面長 10m × 1m = 10㎡')
      expect(result.warnings).toEqual([])
    },
  )

  it.each(['polygon', 'polygonDepth'] as const)(
    '%s の12.5×3mの長方形は底辺12.5mから12.5㎡',
    method => {
      const result = shapeLengthTimesHeight({
        method,
        lengthM: 0,
        perimeterM: 31,
        count: 1,
        pathPoints: rectangle,
      }, {
        output: 'lengthTimesHeight',
        heightM: 1,
        lengthBasis: 'baseEdge',
      })

      expect(result.quantity).toBeCloseTo(12.5, 10)
      expect(result.note).toBe('底辺 12.5m × 1m = 12.5㎡')
      expect(result.warnings).toEqual([])
    },
  )

  it('lengthBasis省略時はpolygonの外周を使う', () => {
    const result = shapeLengthTimesHeight({
      method: 'polygon',
      lengthM: 0,
      perimeterM: 31,
      count: 1,
      pathPoints: rectangle,
    }, {
      output: 'lengthTimesHeight',
      heightM: 1,
    })

    expect(result.quantity).toBe(31)
    expect(result.note).toBe('外周 31m × 1m = 31㎡')
    expect(result.warnings).toEqual([])
  })

  it('水平に近い辺がなければ外周の半分を使わず数量0と警告にする', () => {
    const result = shapeLengthTimesHeight({
      method: 'polygon',
      lengthM: 0,
      perimeterM: 4 * Math.SQRT2,
      count: 1,
      pathPoints: [
        { x: 0, y: 1 },
        { x: 1, y: 0 },
        { x: 2, y: 1 },
        { x: 1, y: 2 },
      ],
    }, {
      output: 'lengthTimesHeight',
      heightM: 1,
      lengthBasis: 'baseEdge',
    })

    expect(result.quantity).toBe(0)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.note).toContain('底辺')
    expect(result.note).not.toContain('外周')
  })

  it('点列未取得時は外周へ置き換えず数量0と警告にする', () => {
    const result = shapeLengthTimesHeight({
      method: 'polygon',
      lengthM: 0,
      perimeterM: 31,
      count: 1,
    }, {
      output: 'lengthTimesHeight',
      heightM: 1,
      lengthBasis: 'baseEdge',
    })

    expect(result.quantity).toBe(0)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.note).toContain('底辺')
    expect(result.note).not.toContain('外周')
  })

  it('高さ未設定は0と警告で扱い、既定高さを補わない', () => {
    const result = shapeLengthTimesHeight({
      method: 'polygon',
      lengthM: 0,
      perimeterM: 31,
      count: 1,
      pathPoints: rectangle,
    }, {
      output: 'lengthTimesHeight',
    })

    expect(result.quantity).toBe(0)
    expect(result.warnings).toContain('連動に使う高さが未設定です。')
  })

  it('拾いの数を一度だけ掛ける', () => {
    const result = shapeLengthTimesHeight({
      method: 'lengthHeight',
      lengthM: 10,
      perimeterM: 0,
      heightM: 3.6,
      count: 2,
    }, {
      output: 'lengthTimesHeight',
      heightM: 1,
    })

    expect(result.quantity).toBe(20)
  })
})

describe('shapeBaseEdgeLength', () => {
  it('閉じた点列と閉じていない点列を同じように扱う', () => {
    expect(shapeBaseEdgeLength(rectangle, 31)).toBeCloseTo(12.5)
    expect(shapeBaseEdgeLength([
      ...rectangle,
      { x: 0, y: 0 },
    ], 31)).toBeCloseTo(12.5)
  })

  it('タプルの点列も扱う', () => {
    expect(shapeBaseEdgeLength([
      [0, 0],
      [125, 0],
      [125, 30],
      [0, 30],
    ], 31)).toBeCloseTo(12.5)
  })

  it('10°以内の辺を採用し、10°を超える辺は採用しない', () => {
    const rotated = (degrees: number) => {
      const angle = degrees * Math.PI / 180
      return rectangle.map(({ x, y }) => ({
        x: x * Math.cos(angle) - y * Math.sin(angle),
        y: x * Math.sin(angle) + y * Math.cos(angle),
      }))
    }

    expect(shapeBaseEdgeLength(rotated(9.9), 31)).toBeCloseTo(12.5)
    expect(shapeBaseEdgeLength(rotated(10.1), 31)).toBeUndefined()
  })

  it('不正な点列を底辺の数量に変換しない', () => {
    expect(shapeBaseEdgeLength(undefined, 31)).toBeUndefined()
    expect(shapeBaseEdgeLength([], 31)).toBeUndefined()
    expect(shapeBaseEdgeLength([
      { x: 0, y: 0 },
      { x: Number.NaN, y: 0 },
      { x: 0, y: 1 },
    ], 31)).toBeUndefined()
  })
})

describe('shape設定の検証と保存', () => {
  it.each(['perimeter', 'baseEdge'] as const)(
    'lengthBasis %sを受け入れて往復する',
    lengthBasis => {
      const fixture = linkedFixture({
        output: 'lengthTimesHeight',
        heightM: 1,
        lengthBasis,
      })

      expect(fixtureLinkError(fixture)).toBeUndefined()

      const restored = parseCountFixtures(serializeCountFixtures([fixture]))
      expect(restored).toEqual([fixture])
    },
  )

  it('baseLengthと扉幅控除の設定を受け入れて往復する', () => {
    const fixture = linkedFixture({
      output: 'baseLength',
      deductDoorWidths: true,
    })

    expect(fixtureLinkError(fixture)).toBeUndefined()
    expect(parseCountFixtures(serializeCountFixtures([fixture])))
      .toEqual([fixture])
  })

  it('省略したlengthBasisを勝手に追加しない', () => {
    const fixture = linkedFixture({
      output: 'lengthTimesHeight',
      heightM: 1,
    })

    expect(parseCountFixtures(serializeCountFixtures([fixture])))
      .toEqual([fixture])
  })

  it.each(['unknown', '', 1, null])(
    '不正なlengthBasis %sを拒否する',
    lengthBasis => {
      const fixture = linkedFixture({
        output: 'lengthTimesHeight',
        heightM: 1,
      })
      const invalid = {
        ...fixture,
        link: {
          ...fixture.link,
          shape: {
            output: 'lengthTimesHeight',
            heightM: 1,
            lengthBasis,
          },
        },
      }

      expect(fixtureLinkError(
        invalid as unknown as Parameters<typeof fixtureLinkError>[0],
      )).toBeDefined()
    },
  )

  it.each(['true', 1, null])(
    '不正なdeductDoorWidths %sを拒否する',
    deductDoorWidths => {
      const fixture = linkedFixture({
        output: 'baseLength',
      })
      const invalid = {
        ...fixture,
        link: {
          ...fixture.link,
          shape: {
            output: 'baseLength',
            deductDoorWidths,
          },
        },
      }

      expect(fixtureLinkError(
        invalid as unknown as Parameters<typeof fixtureLinkError>[0],
      )).toBeDefined()
    },
  )
})
