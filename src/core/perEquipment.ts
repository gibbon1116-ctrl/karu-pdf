import {
  fixtureIdentity,
  nextCountStyle,
  quantityMethod,
  type CountFixture,
  type FixturePreset,
} from './countFixtures'
import {
  PER_EQUIPMENT_COMPONENTS,
  PER_EQUIPMENT_COMPONENT_NAMES,
} from './breakdown/perEquipmentComponents'
import { normalizeItemName } from './related/suggest'

const componentNames = new Set(
  PER_EQUIPMENT_COMPONENT_NAMES.map(normalizeItemName),
)

/** 基の名称そのものの、機器ごとに分ける個数の項目か。 */
export function isPerEquipmentComponent(
  fixture: Pick<CountFixture, 'name' | 'kind' | 'method'>,
): boolean {
  return (fixture.kind ?? 'count') === 'count'
    && (fixture.method ?? 'click') === 'click'
    && componentNames.has(normalizeItemName(fixture.name))
}

function equipmentDefinition<T extends Pick<CountFixture, 'name' | 'summary'>>(
  base: T,
  parent: Pick<CountFixture, 'name' | 'code' | 'summary'>,
): T {
  const component = PER_EQUIPMENT_COMPONENTS.find(item =>
    normalizeItemName(item.name) === normalizeItemName(base.name))
  const parentCode = parent.code?.trim() ?? ''
  const parentLabel = parentCode
    ? `${parent.name} ${parentCode}`
    : parent.name
  const summary = (base.summary ?? []).map(field => ({ ...field }))

  if (component?.label) {
    const value = component.value === 'code'
      ? parentCode || parent.name
      : parentLabel
    let found = false
    for (const field of summary) {
      if (normalizeItemName(field.label)
        === normalizeItemName(component.label)) {
        field.value = value
        found = true
      }
    }
    if (!found) summary.unshift({ label: component.label, value })
  }

  for (const label of component?.copy ?? []) {
    const source = parent.summary?.find(field =>
      normalizeItemName(field.label) === normalizeItemName(label)
        && Boolean(field.value))
    if (!source) continue

    let found = false
    for (const field of summary) {
      if (normalizeItemName(field.label) === normalizeItemName(label)) {
        field.value = source.value
        found = true
      }
    }
    if (!found) summary.push({ label, value: source.value })
  }

  return {
    ...base,
    name: `${base.name}（${parentLabel}）`,
    summary,
  }
}

/** 項目を生成せず、構成要素として使う項目の同一性を調べる。 */
export function perEquipmentComponentIdentity(
  base: CountFixture | FixturePreset,
  parent: CountFixture,
): string {
  return fixtureIdentity(
    isPerEquipmentComponent(base)
      && (parent.kind ?? 'count') === 'count'
      && quantityMethod(parent) === 'click'
      ? equipmentDefinition(base, parent)
      : base,
  )
}

/** 文書は変更しない。生成した項目は呼出側の履歴にまとめて保存する。 */
export function perEquipmentComponentFixture(
  base: CountFixture,
  parent: CountFixture,
  fixtures: readonly CountFixture[],
): { fixture: CountFixture; newFixtures: CountFixture[] } {
  if (!isPerEquipmentComponent(base)
    || (parent.kind ?? 'count') !== 'count'
    || quantityMethod(parent) !== 'click') {
    return { fixture: base, newFixtures: [] }
  }

  const definition = equipmentDefinition(base, parent)
  const identity = fixtureIdentity(definition)
  const existing = fixtures
    .filter(fixture => quantityMethod(fixture) === 'click'
      && fixtureIdentity(fixture) === identity)
    .sort((left, right) => left.order - right.order)[0]
  if (existing) return { fixture: existing, newFixtures: [] }

  const fixture: CountFixture = {
    ...structuredClone(definition),
    id: crypto.randomUUID(),
    order: fixtures.reduce((order, item) => Math.max(order, item.order + 1), 0),
    style: nextCountStyle(fixtures),
  }
  return { fixture, newFixtures: [fixture] }
}
