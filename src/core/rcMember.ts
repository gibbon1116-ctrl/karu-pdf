import { clipParallelBars, type ShapeMetrics } from './shapeMetrics'
import {
  REBAR_MASS_KG_PER_M, REBAR_GRADES, rebarDiameterMm,
  DEFAULT_ANCHORAGE_D, DEFAULT_LAP_D, MIN_DIAMETER_GAS_PRESSURE,
  rebarJoints, barCount,
} from './breakdown/rcData'

export type RcMemberKind =
  | 'slab' | 'foundationSlab' | 'wall'
  | 'beam' | 'foundationBeam' | 'column' | 'footing'

export interface RcBar {
  role: 'x' | 'y' | 'vertical' | 'horizontal'
    | 'top' | 'bottom' | 'stirrup' | 'hoop' | 'main' | 'base'
  size: string
  grade?: string
  spacingMm?: number
  count?: number
  layers?: 1 | 2
}

export interface RcMember {
  kind: RcMemberKind
  thicknessMm?: number
  widthMm?: number
  depthMm?: number
  heightMm?: number
  slabDeductMm?: number
  bars: RcBar[]
  anchorageD?: number
  lapD?: number
  joint?: 'lap' | 'gas'
}

export interface RcResult {
  shapeDimensionText?: string
  concreteM3: number
  formworkM2: number
  bars: Array<{
    size: string
    grade?: string
    role: RcBar['role']
    count: number
    lengthM: number
    massKg: number
    layers?: number
    spacingMm?: number
    countPerLayer?: number
    spanM?: number
    perLayerCount?: number
    anchorageM?: number
    lapM?: number
    massKgPerM?: number
    pickupCount?: number
    allocationCount?: number
    allocations?: Array<{
      spanM: number
      perLayerCount: number
      allocationCount?: number
    }>
    shapeDimensionText?: string
    joint?: 'lap' | 'gas'
    jointCount?: number
  }>
  lapJoints: number
  gasJoints: Array<{ size: string; count: number }>
}

const roles: Record<RcMemberKind, readonly RcBar['role'][]> = {
  slab: ['x', 'y'],
  foundationSlab: ['x', 'y'],
  wall: ['vertical', 'horizontal'],
  beam: ['top', 'bottom', 'stirrup'],
  foundationBeam: ['top', 'bottom', 'stirrup'],
  column: ['main', 'hoop'],
  footing: ['base'],
}
const countedRoles = new Set<RcBar['role']>(['top', 'bottom', 'main'])

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function rcMemberError(
  member: unknown,
  options: { fromShape?: boolean; fromLine?: boolean } = {},
): string | undefined {
  if (!record(member) || typeof member.kind !== 'string'
    || !Object.hasOwn(roles, member.kind)) {
    return 'RC部材の種類が正しくありません。'
  }
  const kind = member.kind as RcMemberKind
  for (const key of ['thicknessMm', 'widthMm', 'depthMm', 'heightMm'] as const) {
    if (member[key] !== undefined && !positive(member[key])) {
      return 'RC部材の寸法は0より大きい有限の数で入れてください。'
    }
  }
  if (!options.fromShape && kind === 'wall') {
    if (!positive(member.thicknessMm)) return 'RC部材の厚さを入れてください。'
    if (options.fromLine && !positive(member.heightMm)) {
      return 'RC部材の高さを入れてください。'
    }
  } else if (!options.fromShape && kind !== 'slab' && kind !== 'foundationSlab') {
    if (!positive(member.widthMm) || !positive(member.depthMm)) {
      return 'RC部材の幅とせい・長さを入れてください。'
    }
    if ((kind === 'footing' || kind === 'column' && !options.fromLine)
      && !positive(member.heightMm)) {
      return 'RC部材の高さを入れてください。'
    }
  }
  if (member.slabDeductMm !== undefined) {
    if ((kind !== 'beam' && kind !== 'foundationBeam')
      || !nonnegative(member.slabDeductMm)
      || (member.depthMm === undefined
        ? !options.fromShape
        : !positive(member.depthMm) || member.slabDeductMm >= member.depthMm)) {
      return '梁の床板控除は0以上、梁のせい未満で入れてください。'
    }
  }
  for (const key of ['anchorageD', 'lapD'] as const) {
    if (member[key] !== undefined && !nonnegative(member[key])) {
      return '定着・重ね継手のd倍数は0以上の有限の数で入れてください。'
    }
  }
  if (member.joint !== undefined && member.joint !== 'lap' && member.joint !== 'gas') {
    return 'RC部材の継手は重ね・ガス圧接から選んでください。'
  }
  if (!Array.isArray(member.bars) || member.bars.length > 20) {
    return 'RC部材の鉄筋設定は配列で、20件までです。'
  }
  for (const bar of Array.from(member.bars)) {
    if (!record(bar) || !roles[kind].includes(bar.role as RcBar['role'])
      || typeof bar.size !== 'string' || !Object.hasOwn(REBAR_MASS_KG_PER_M, bar.size)) {
      return 'RC部材の鉄筋の役割・径が正しくありません。'
    }
    if (bar.grade !== undefined
      && !REBAR_GRADES.some(grade => grade === bar.grade)) {
      return '鉄筋の規格は SD295・SD345・SD390・SD490 から選んでください。'
    }
    if (bar.layers !== undefined && bar.layers !== 1 && bar.layers !== 2) {
      return '鉄筋の層数は1または2で入れてください。'
    }
    if (bar.spacingMm !== undefined && !positive(bar.spacingMm)) {
      return '鉄筋間隔は0より大きい有限の数で入れてください。'
    }
    if (bar.count !== undefined
      && (typeof bar.count !== 'number' || !Number.isSafeInteger(bar.count) || bar.count < 1)) {
      return '鉄筋本数は1以上の安全な整数で入れてください。'
    }
    if (countedRoles.has(bar.role as RcBar['role'])) {
      if (bar.count === undefined || bar.spacingMm !== undefined) {
        return '主筋・上端筋・下端筋は本数だけを指定してください。'
      }
    } else if (bar.spacingMm === undefined || bar.count !== undefined) {
      return '間隔で割り付ける鉄筋は間隔だけを指定してください。'
    }
    if ((bar.role === 'stirrup' || bar.role === 'hoop' || bar.role === 'base')
      && bar.layers === 2) {
      return 'スタラップ・フープ・ベース筋は1層で設定してください。'
    }
  }
}

/** Import only the documented fields; never retain unknown PDF properties. */
export function readRcMember(value: unknown): RcMember | undefined {
  // Shape-derived dimensions are resolved when the pickup method is available.
  // Explicit invalid dimensions and invalid bar settings are still rejected.
  if (rcMemberError(value, { fromShape: true })) return undefined
  const member = value as RcMember
  return {
    kind: member.kind,
    bars: member.bars.map(bar => ({
      role: bar.role,
      size: bar.size,
      ...(bar.grade !== undefined ? { grade: bar.grade } : {}),
      ...(bar.spacingMm !== undefined ? { spacingMm: bar.spacingMm } : {}),
      ...(bar.count !== undefined ? { count: bar.count } : {}),
      ...(bar.layers !== undefined ? { layers: bar.layers } : {}),
    })),
    ...(member.thicknessMm !== undefined ? { thicknessMm: member.thicknessMm } : {}),
    ...(member.widthMm !== undefined ? { widthMm: member.widthMm } : {}),
    ...(member.depthMm !== undefined ? { depthMm: member.depthMm } : {}),
    ...(member.heightMm !== undefined ? { heightMm: member.heightMm } : {}),
    ...(member.slabDeductMm !== undefined ? { slabDeductMm: member.slabDeductMm } : {}),
    ...(member.anchorageD !== undefined ? { anchorageD: member.anchorageD } : {}),
    ...(member.lapD !== undefined ? { lapD: member.lapD } : {}),
    ...(member.joint !== undefined ? { joint: member.joint } : {}),
  }
}

type JointRule = Parameters<typeof rebarJoints>[2]

export function rcBarCountText(bar: RcResult['bars'][number]): string {
  const number = (value: number) => String(Number(value.toFixed(6)))
  const spacing = ((bar.spacingMm ?? 0) / 1000).toFixed(3)
  const spaced = (span: number, count: number) =>
    `${span.toFixed(2)}m÷${spacing}m→${number(count)}本`
  let text: string
  if (bar.allocations?.length) {
    text = `（${bar.allocations.map(allocation => {
      const count = allocation.allocationCount ?? allocation.perLayerCount
      const clipped = count !== allocation.perLayerCount
        ? `（形・開口で切り分け→${number(allocation.perLayerCount)}本）` : ''
      return spaced(allocation.spanM, count) + clipped
    }).join('＋')}）`
  } else if (bar.spacingMm !== undefined && bar.spanM !== undefined
    && bar.perLayerCount !== undefined) {
    text = spaced(bar.spanM, bar.allocationCount ?? bar.perLayerCount)
    if (bar.allocationCount !== undefined
      && bar.allocationCount !== bar.perLayerCount) {
      text += `（形・開口で切り分け→${number(bar.perLayerCount)}本）`
    }
  } else if (bar.countPerLayer !== undefined) {
    text = `${number(bar.countPerLayer)}本`
  } else {
    return `${number(bar.count)}本`
  }
  text += `×${number(bar.layers ?? 1)}段`
  if ((bar.pickupCount ?? 1) !== 1) {
    text += `×${number(bar.pickupCount!)}（拾いの数）`
  }
  text += `=${number(bar.count)}本`
  if (bar.spacingMm !== undefined) {
    text += bar.role === 'horizontal'
      ? '（切り上げ−1）' : '（切り上げ＋1）'
  }
  return bar.shapeDimensionText ? `${bar.shapeDimensionText}；${text}` : text
}

function rcShapeDimensions(member: RcMember, metrics: ShapeMetrics): {
  width: number
  depth: number
  height: number
  length: number
  text: string
} {
  const dimensionError =
    'RC部材の寸法を入れるか、深さ（体積）で拾ってください。'
  const polygon = metrics.polygonM
  if (!positive(metrics.areaM2) || !polygon
    || ![polygon.outer, ...polygon.holes].every(ring =>
      ring.length >= 3 && ring.every(point => point.every(Number.isFinite)))) {
    throw new Error(dimensionError)
  }

  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  for (const [x, y] of polygon.outer) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  const spanX = maxX - minX
  const spanY = maxY - minY
  const shortSide = Math.min(spanX, spanY)
  if (!positive(spanX) || !positive(spanY)) throw new Error(dimensionError)

  const wall = member.kind === 'wall'
  const beam = member.kind === 'beam' || member.kind === 'foundationBeam'
  const thickness = member.thicknessMm === undefined
    ? shortSide : member.thicknessMm / 1000
  const width = beam
    ? member.widthMm === undefined ? shortSide : member.widthMm / 1000
    : spanX
  const depth = beam
    ? member.depthMm === undefined ? metrics.depthM ?? 0 : member.depthMm / 1000
    : spanY
  const height = member.heightMm === undefined
    ? metrics.depthM ?? 0 : member.heightMm / 1000
  const length = wall ? metrics.areaM2 / thickness
    : beam ? metrics.areaM2 / width : Math.max(spanX, spanY)

  if ((wall && ![thickness, length, height].every(positive))
    || (beam && ![width, length, depth].every(positive))
    || (!wall && !beam && ![height, metrics.perimeterM].every(positive))) {
    throw new Error(dimensionError)
  }
  if (beam && (member.slabDeductMm ?? 0) / 1000 >= depth) {
    throw new Error('梁の床板控除は0以上、梁のせい未満で入れてください。')
  }

  const heightSource = member.heightMm === undefined ? '拾いの深さ' : '入力'
  let text: string
  if (wall) {
    const thicknessSource = member.thicknessMm === undefined
      ? '平面の短い辺' : '入力'
    text = `壁 面積 ${metrics.areaM2.toFixed(2)}㎡ ÷ 厚さ ${thickness.toFixed(2)}m`
      + ` = 長さ ${length.toFixed(2)}m、高さ ${height.toFixed(2)}m（${heightSource}）`
      + `、厚さは${thicknessSource}`
  } else if (beam) {
    const label = member.kind === 'beam' ? '梁' : '基礎梁'
    const widthSource = member.widthMm === undefined ? '平面の短い辺' : '入力'
    const depthSource = member.depthMm === undefined ? '拾いの深さ' : '入力'
    text = `${label} 面積 ${metrics.areaM2.toFixed(2)}㎡ ÷ 幅 ${width.toFixed(2)}m`
      + ` = 長さ ${length.toFixed(2)}m、せい ${depth.toFixed(2)}m（${depthSource}）`
      + `、幅は${widthSource}`
    if (member.slabDeductMm !== undefined) {
      text += `、床板控除 ${(member.slabDeductMm / 1000).toFixed(2)}m`
    }
  } else {
    const label = member.kind === 'column' ? '柱' : '独立基礎'
    text = `${label} 平面の面積 ${metrics.areaM2.toFixed(2)}㎡`
      + `、外周 ${metrics.perimeterM.toFixed(2)}m`
      + `、高さ ${height.toFixed(2)}m（${heightSource}）`
  }
  return { width, depth, height, length, text }
}

export function computeRcMember(member: RcMember, metrics: ShapeMetrics): RcResult {
  const fromShape = metrics.method === 'polygonDepth'
  const fromLine = metrics.method === 'polyline'
  const error = rcMemberError(member, { fromShape, fromLine })
  if (error) throw new Error(error)
  if (![metrics.count, metrics.areaM2, metrics.lengthM, metrics.perimeterM]
    .every(nonnegative)) {
    throw new Error('RC部材の拾いの数量・寸法が正しくありません。')
  }
  const enclosing = metrics.method === 'polygon' || metrics.method === 'polygonDepth'
  const slab = member.kind === 'slab' || member.kind === 'foundationSlab'
  const beam = member.kind === 'beam' || member.kind === 'foundationBeam'
  if ((slab && (!enclosing || !metrics.polygonM))
    || (member.kind === 'wall' && !fromShape
      && !fromLine
      && (metrics.method !== 'lengthHeight' || !positive(metrics.heightM)))
    || (beam && !fromShape && !fromLine)
    || (member.kind === 'column' && !fromShape
      && !fromLine && metrics.method !== 'click')
    || (member.kind === 'footing' && !fromShape && metrics.method !== 'click')) {
    throw new Error('RC部材の種類と拾い方・必要な寸法が一致していません。')
  }

  const result: RcResult = {
    concreteM3: 0, formworkM2: 0, bars: [], lapJoints: 0, gasJoints: [],
  }
  const multiplicity = metrics.count
  const thickness = member.thicknessMm !== undefined
    ? member.thicknessMm / 1000
    : slab && metrics.method === 'polygonDepth' ? metrics.depthM ?? 0 : 0
  if (slab && !positive(thickness)) {
    throw new Error('RC部材の厚さを入れるか、深さ（体積）で拾ってください。')
  }
  const shape = fromShape && !slab ? rcShapeDimensions(member, metrics) : undefined
  if (shape) result.shapeDimensionText = shape.text
  const width = shape?.width ?? (member.widthMm ?? 0) / 1000
  const depth = shape?.depth ?? (member.depthMm ?? 0) / 1000
  const height = shape?.height ?? (member.kind === 'column' && fromLine
    ? metrics.lengthM
    : member.kind === 'wall' && !fromLine
      ? metrics.heightM! : (member.heightMm ?? 0) / 1000)
  const length = shape?.length ?? metrics.lengthM
  if (fromLine && member.kind === 'column') {
    result.shapeDimensionText = `柱 ${width.toFixed(2)}×${depth.toFixed(2)}m`
      + ` 断面の周長 ${(2 * (width + depth)).toFixed(2)}m`
      + ` × 長さ ${length.toFixed(2)}m`
  } else if (fromLine && member.kind === 'wall') {
    result.shapeDimensionText = `壁 長さ ${length.toFixed(2)}m`
      + ` × 高さ ${height.toFixed(2)}m × 厚さ ${thickness.toFixed(2)}m`
  }

  if (slab) {
    result.concreteM3 = metrics.areaM2 * thickness * multiplicity
    result.formworkM2 = (member.kind === 'foundationSlab'
      ? metrics.perimeterM * thickness : metrics.areaM2) * multiplicity
  } else if (member.kind === 'wall') {
    result.concreteM3 = fromLine
      ? length * height * thickness * multiplicity
      : metrics.areaM2 * (shape ? height : thickness) * multiplicity
    result.formworkM2 = (shape || fromLine ? length * height : metrics.areaM2)
      * 2 * multiplicity
  } else if (beam) {
    const netDepth = depth - (member.slabDeductMm ?? 0) / 1000
    result.concreteM3 = length * width * netDepth * multiplicity
    result.formworkM2 = length
      * (2 * netDepth + (member.kind === 'beam' ? width : 0)) * multiplicity
  } else {
    result.concreteM3 = shape
      ? metrics.areaM2 * height * multiplicity
      : multiplicity * width * depth * height
    result.formworkM2 = shape
      ? metrics.perimeterM * height * multiplicity
      : multiplicity * 2 * (width + depth) * height
  }

  const gasBySize = new Map<string, number>()
  for (const bar of member.bars) {
    const diameter = rebarDiameterMm(bar.size)!
    const anchorageM = (member.anchorageD ?? DEFAULT_ANCHORAGE_D) * diameter / 1000
    const lapM = (member.lapD ?? DEFAULT_LAP_D) * diameter / 1000
    const joint = member.joint
      ?? (diameter >= MIN_DIAMETER_GAS_PRESSURE ? 'gas' : 'lap')
    const layers = bar.layers ?? 1
    const spacing = (bar.spacingMm ?? 0) / 1000
    const computed: RcResult['bars'][number] = {
      size: bar.size, role: bar.role, count: 0, lengthM: 0, massKg: 0,
      ...(bar.grade !== undefined ? { grade: bar.grade } : {}),
      layers, pickupCount: multiplicity,
      ...(result.shapeDimensionText
        ? { shapeDimensionText: result.shapeDimensionText } : {}),
      massKgPerM: REBAR_MASS_KG_PER_M[bar.size],
      joint, jointCount: 0,
      ...(bar.spacingMm !== undefined ? { spacingMm: bar.spacingMm } : {}),
      ...(bar.count !== undefined ? { countPerLayer: bar.count } : {}),
    }
    let anchorageLengthM = 0
    let lapLengthM = 0

    const add = (
      spanM: number,
      count: number,
      anchorageEnds = 0,
      rule?: JointRule,
    ): void => {
      if (spanM <= 0 || count <= 0) return
      // Joint categories use the structural span, before anchorage/lap additions.
      const joints = rule === undefined ? 0 : rebarJoints(spanM, diameter, rule) * count
      computed.jointCount = (computed.jointCount ?? 0) + joints
      anchorageLengthM += anchorageEnds * anchorageM * count
      computed.count += count
      computed.lengthM += (spanM + anchorageEnds * anchorageM) * count
      if (joint === 'lap') {
        result.lapJoints += joints
        lapLengthM += joints * lapM
        computed.lengthM += joints * lapM
      } else if (joints > 0) {
        gasBySize.set(bar.size, (gasBySize.get(bar.size) ?? 0) + joints)
      }
    }

    if (slab) {
      const spans = clipParallelBars(
        metrics.polygonM!, bar.role as 'x' | 'y', spacing,
      )
      const axis = bar.role === 'x' ? 1 : 0
      let minimum = Infinity
      let maximum = -Infinity
      for (const point of metrics.polygonM!.outer) {
        minimum = Math.min(minimum, point[axis])
        maximum = Math.max(maximum, point[axis])
      }
      if (Number.isFinite(minimum) && Number.isFinite(maximum)) {
        computed.spanM = maximum - minimum
        computed.allocationCount = barCount(computed.spanM, spacing)
      }
      computed.perLayerCount = spans.filter(span => span > 0).length
      for (const spanM of spans) add(spanM, layers * multiplicity, 2, 'slab')
    } else if (member.kind === 'wall') {
      computed.spanM = bar.role === 'vertical' ? length : height
      computed.perLayerCount = barCount(
        computed.spanM, spacing, bar.role === 'horizontal',
      )
      if (bar.role === 'vertical') {
        add(height, barCount(length, spacing) * layers * multiplicity, 1, 'perFloor')
      } else {
        add(length, barCount(height, spacing, true) * layers * multiplicity, 1, 'general')
      }
    } else if (beam) {
      if (bar.role === 'stirrup') {
        computed.layers = 1
        computed.spanM = length
        computed.perLayerCount = barCount(length, spacing)
        add(2 * (width + depth), barCount(length, spacing) * multiplicity)
      } else {
        computed.perLayerCount = bar.count!
        add(length, bar.count! * layers * multiplicity, 2, 'beam')
      }
    } else if (member.kind === 'column') {
      if (bar.role === 'main') {
        computed.perLayerCount = bar.count!
        add(height, bar.count! * layers * multiplicity, 0, 'perFloor')
      } else {
        computed.layers = 1
        computed.spanM = height
        computed.perLayerCount = barCount(height, spacing)
        add(shape ? metrics.perimeterM : 2 * (width + depth),
          barCount(height, spacing) * multiplicity)
      }
    } else if (shape) {
      computed.layers = 1
      computed.allocations = []
      computed.perLayerCount = 0
      for (const direction of ['x', 'y'] as const) {
        const spans = clipParallelBars(metrics.polygonM!, direction, spacing)
        const spanM = direction === 'x' ? shape.depth : shape.width
        const perLayerCount = spans.filter(span => span > 0).length
        computed.allocations.push({
          spanM, perLayerCount, allocationCount: barCount(spanM, spacing),
        })
        computed.perLayerCount += perLayerCount
        // Preserve the footing's existing anchorage and joint rules.
        for (const barLengthM of spans) {
          add(barLengthM, multiplicity, 0, 'general')
        }
      }
    } else {
      computed.layers = 1
      computed.allocations = [
        { spanM: width, perLayerCount: barCount(width, spacing) },
        { spanM: depth, perLayerCount: barCount(depth, spacing) },
      ]
      computed.perLayerCount = computed.allocations.reduce(
        (sum, allocation) => sum + allocation.perLayerCount, 0,
      )
      add(depth, barCount(width, spacing) * multiplicity, 0, 'general')
      add(width, barCount(depth, spacing) * multiplicity, 0, 'general')
    }
    computed.anchorageM = computed.count > 0 ? anchorageLengthM / computed.count : 0
    computed.lapM = computed.count > 0 ? lapLengthM / computed.count : 0
    computed.massKg = computed.lengthM * REBAR_MASS_KG_PER_M[bar.size]
    result.bars.push(computed)
  }

  result.gasJoints = [...gasBySize].map(([size, count]) => ({ size, count }))
  if (![result.concreteM3, result.formworkM2, result.lapJoints,
    ...result.bars.flatMap(bar => [bar.count, bar.lengthM, bar.massKg]),
    ...result.gasJoints.map(joint => joint.count)].every(nonnegative)) {
    throw new Error('RC部材の計算結果が有限の数量を超えています。')
  }
  return result
}
