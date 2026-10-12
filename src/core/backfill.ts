import type { CountFixture } from './countFixtures'
import type { QuantityMark, RouteExtra } from './quantity'
import {
  CONDUIT_OUTER_DIAMETERS,
  STEEL_PIPE_OUTER_DIAMETERS,
  BURIED_PIPE_OUTER_DIAMETERS,
} from './breakdown/pipeDiameters'

export interface BackfillPipe {
  itemId: string
  label: string
  outerDiameterMm: number
  lengthM: number
  count: number
  volumeM3: number
}

export interface BackfillVolume {
  lengthM: number
  widthM: number
  depthM: number
  count: number
  perM: number
  grossM3: number
  deductionM3: number
  valueM3: number
  pipes: BackfillPipe[]
  warnings: string[]
}

const positive = (value: number | undefined): number =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : 0

const diameterKey = (value: string): string =>
  value.normalize('NFKC').replace(/\s+/gu, '').toUpperCase()

export function pipeOuterDiameterMm(fixture: CountFixture): number | undefined {
  if (fixture.attributes?.outerDiameterMm !== undefined) {
    const diameter = positive(fixture.attributes.outerDiameterMm)
    return diameter || undefined
  }

  const keys = [...new Set([
    diameterKey(fixture.code),
    diameterKey(fixture.spec ?? ''),
    diameterKey(fixture.code + (fixture.spec ?? '')),
  ].filter(Boolean))]

  // 表の優先順を守り、各表で略号・規格・略号＋規格を調べる。
  for (const table of [
    CONDUIT_OUTER_DIAMETERS,
    STEEL_PIPE_OUTER_DIAMETERS,
    BURIED_PIPE_OUTER_DIAMETERS,
  ]) {
    for (const key of keys) {
      const diameter = table[key]
      if (positive(diameter)) return diameter
    }
  }
  return undefined
}

function pipeLabel(fixture: CountFixture): string {
  return [fixture.code.trim(), fixture.spec?.trim()].filter(Boolean).join('')
    || fixture.name
}

/**
 * 経路の追加要素である長さ×幅×深さだけに使う。
 * 管側の立上り・余長・1mあたり係数は控除に含めない。
 */
export function calculateBackfillVolume(
  planM: number,
  mark: QuantityMark,
  member: RouteExtra,
  fixture: CountFixture,
  fixtureById: (id: string) => CountFixture | undefined,
): BackfillVolume {
  const lengthM = member.cond?.plan === null ? 0 : positive(planM)
  const widthM = positive(fixture.defaults?.widthM)
  const depthM = positive(fixture.defaults?.depthM)
  const count = member.count
  const perM = member.perM ?? 1
  const grossM3 = lengthM * widthM * depthM * count * perM
  const pipes: BackfillPipe[] = []
  const warnings: string[] = []

  if (lengthM > 0 && fixture.backfill?.deductPipes === true) {
    const others: RouteExtra[] = [
      { itemId: mark.itemId, count: mark.count ?? 1, cond: mark.cond },
      ...(mark.extra ?? []),
    ]
    for (const other of others) {
      if (other.itemId === member.itemId || other.cond?.plan === null) continue
      const condition = other.cond?.plan ?? mark.condition
      if (typeof condition !== 'string'
        || !fixture.backfill.conditionIncludes.some(word => condition.includes(word))) {
        continue
      }

      const pipe = fixtureById(other.itemId)
      if (!pipe || pipe.link !== undefined || pipe.kind !== 'length') continue
      const label = pipeLabel(pipe)
      const outerDiameterMm = pipeOuterDiameterMm(pipe)
      if (outerDiameterMm === undefined) {
        warnings.push(
          `${label} の外径が分からないため引いていません（項目の質量・寸法に外径を入れてください）`,
        )
        continue
      }
      const volumeM3 = Math.PI / 4 * (outerDiameterMm / 1000) ** 2
        * lengthM * other.count
      pipes.push({
        itemId: pipe.id, label, outerDiameterMm,
        lengthM, count: other.count, volumeM3,
      })
    }
  }

  const deductionM3 = pipes.reduce((sum, pipe) => sum + pipe.volumeM3, 0)
  const valueM3 = Math.max(0, grossM3 - deductionM3)
  if (deductionM3 > grossM3) {
    warnings.push('管の体積が埋戻しの総体積を超えたため、埋戻しの数量を0にしています。')
  }
  return {
    lengthM, widthM, depthM, count, perM,
    grossM3, deductionM3, valueM3, pipes, warnings,
  }
}

export function backfillSummary(result: BackfillVolume): string {
  return `−管 ${result.deductionM3.toFixed(2)} ＝ ${result.valueM3.toFixed(2)} ㎥`
    + (result.warnings.length ? '（要確認）' : '')
}

export function backfillDetail(result: BackfillVolume): string {
  const gross = `平面 ${result.lengthM.toFixed(2)}`
    + ` × 幅 ${result.widthM.toFixed(2)} × 深さ ${result.depthM.toFixed(2)}`
    + (result.count !== 1 ? ` × ${result.count}条` : '')
    + (result.perM !== 1 ? ` × ${result.perM.toFixed(3)}/m` : '')
    + ` = ${result.grossM3.toFixed(2)}`
  const deductions = result.pipes.map(pipe =>
    ` − 管 ${pipe.label}（φ${pipe.outerDiameterMm}mm）`
    + `× ${pipe.lengthM.toFixed(2)}`
    + (pipe.count !== 1 ? ` × ${pipe.count}条` : '')
    + ` = ${pipe.volumeM3.toFixed(2)}`).join('')
  return gross + deductions + ` ＝ ${result.valueM3.toFixed(2)} ㎥`
}
