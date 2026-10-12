import type { CountFixture } from './countFixtures'
import { quantityDimensions, type QuantityMark } from './quantity'

export const FIXTURE_DIMENSION_KEYS = ['widthM', 'depthM', 'heightM'] as const
export type FixtureDimensionKey = typeof FIXTURE_DIMENSION_KEYS[number]
export type FixtureDimensionValues = Partial<Pick<QuantityMark, FixtureDimensionKey>>

export interface FixtureDimensionPlan {
  values: FixtureDimensionValues
  customized: boolean
}

/**
 * 主項目の拾いだけを対象にする。
 * 変更する寸法に個別値がある拾いは、拾い全体を更新対象から外す。
 * 変更しない寸法や、拾い方で使わない寸法は判定に含めない。
 */
export function planFixtureDimensions(
  mark: QuantityMark,
  previous: CountFixture,
  next: CountFixture,
): FixtureDimensionPlan | undefined {
  if (mark.itemId !== previous.id || previous.id !== next.id) return undefined
  const dimensions = quantityDimensions(mark.method)
  const changed = FIXTURE_DIMENSION_KEYS.filter(key =>
    dimensions.includes(key)
    && previous.defaults?.[key] !== next.defaults?.[key])
  if (!changed.length) return undefined

  const customized = changed.some(key =>
    mark[key] !== undefined && mark[key] !== previous.defaults?.[key])
  const values: FixtureDimensionValues = {}
  if (!customized) {
    for (const key of changed) values[key] = next.defaults?.[key]
  }
  return { values, customized }
}
