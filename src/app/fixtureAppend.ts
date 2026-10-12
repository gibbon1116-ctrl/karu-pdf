import {
  countHex,
  fixtureIdentity,
  nextCountStyle,
  nextQuantityLineStyle,
  quantityKind,
  quantityLine,
  type CountFixture,
  type FixturePreset,
  type QuantityLineAppearance,
} from '../core/countFixtures'

import { quantityBreakdownRowKey } from './breakdownOutline'

export interface FixtureAppendOptions {
  rank?(fixture: CountFixture): number | undefined
}

/** 既存と追加予定の重複を除き、従来の追加処理と同じ見た目を割り当てる。 */
export function appendFixtures(
  existing: readonly CountFixture[],
  items: ReadonlyArray<FixturePreset | CountFixture>,
  options?: FixtureAppendOptions,
): CountFixture[] {
  const rank = options?.rank
  const next = rank ? [...existing].sort((a, b) => a.order - b.order) : [...existing]
  let order = next.reduce((value, fixture) => Math.max(value, fixture.order + 1), 0)

  for (const item of items) {
    if (next.some(fixture => fixtureIdentity(fixture) === fixtureIdentity(item))) continue

    const imported = 'style' in item
    const isLine = item.kind && item.kind !== 'count'
    let appearance: QuantityLineAppearance | undefined

    if (isLine && (!imported || next.some(fixture =>
      quantityKind(fixture) !== 'count'
      && countHex(fixture.style.color) === countHex(item.style.color)
      && quantityLine(fixture).width === quantityLine(item).width
      && quantityLine(fixture).dash === quantityLine(item).dash,
    ))) {
      appearance = nextQuantityLineStyle(next)
    }

    const style = imported ? structuredClone(item.style) : nextCountStyle(isLine ? [] : next)
    const { category, code, spec, name, kind, method, defaults, aggregation } = item
    const data = imported ? {
      ...item,
      sample: item.sample ? {
        png: item.sample.png,
        width: item.sample.width,
        height: item.sample.height,
        pageIndex: item.sample.pageIndex,
      } : undefined,
    } : {
      category, code, spec, name, kind, method, defaults, aggregation,
      ...(item.unit !== undefined ? { unit: item.unit } : {}),
      ...(item.breakdown !== undefined ? { breakdown: { ...item.breakdown } } : {}),
      ...(item.summary !== undefined ? { summary: item.summary.map(field => ({ ...field })) } : {}),
      ...(item.remark !== undefined ? { remark: item.remark } : {}),
      ...(item.attributes !== undefined ? { attributes: { ...item.attributes } } : {}),
      ...(item.convert !== undefined ? { convert: { ...item.convert } } : {}),
    }

    const added: CountFixture = {
      ...data,
      id: crypto.randomUUID(),
      order: order++,
      style: appearance ? { ...style, color: appearance.color } : style,
      ...(appearance ? { line: appearance.line } : {}),
    }
    const addedRank = added.breakdown ? rank?.(added) : undefined
    let insertion = next.length
    if (added.breakdown && addedRank !== undefined) {
      const rowKey = quantityBreakdownRowKey(added.breakdown)
      const lastPeer = next.findLastIndex(fixture => fixture.breakdown !== undefined
        && quantityBreakdownRowKey(fixture.breakdown) === rowKey)
      if (lastPeer >= 0) {
        insertion = lastPeer + 1
      } else {
        const following = next.findIndex(fixture => {
          if (!fixture.breakdown) return false
          const fixtureRank = rank!(fixture)
          return fixtureRank !== undefined && fixtureRank > addedRank
        })
        insertion = following >= 0
          ? following
          : next.findLastIndex(fixture => fixture.breakdown !== undefined) + 1
      }
    }
    next.splice(insertion, 0, added)
  }

  if (next.length === existing.length) return [...existing]
  return rank
    ? next.map((fixture, order) => fixture.order === order ? fixture : { ...fixture, order })
    : next
}
