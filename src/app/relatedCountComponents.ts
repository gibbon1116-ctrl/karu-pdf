import {
  fixtureIdentity,
  nextCountStyle,
  quantityMethod,
  type CountFixture,
  type FixturePreset,
} from '../core/countFixtures'
import type { RelatedSuggestion } from '../core/related/suggest'
import type { RelatedModel } from './relatedModel'

export interface RelatedCountComponentChoice {
  key: string
  category: string
  name: string
  preset?: FixturePreset
}

const isAvailableCountFixture = (fixture: CountFixture): boolean =>
  quantityMethod(fixture) === 'click' && fixture.link === undefined

export function relatedCountComponentChoices(
  suggestion: RelatedSuggestion,
  origin: CountFixture | undefined,
  fixtures: readonly CountFixture[],
  model: RelatedModel | null,
): RelatedCountComponentChoice[] {
  if (suggestion.kind !== 'item' || !origin || !isAvailableCountFixture(origin)) {
    return []
  }

  const choices = new Map<string, RelatedCountComponentChoice>()
  const add = (category: string, name: string, preset?: FixturePreset) => {
    const key = JSON.stringify([category, name])
    const previous = choices.get(key)
    if (!previous) choices.set(key, { key, category, name, ...(preset ? { preset } : {}) })
    else if (!previous.preset && preset) choices.set(key, { ...previous, preset })
  }

  for (const target of suggestion.targets) {
    // 標準マスタの順序を、複数品目の選択肢の既定順序にする。
    for (const candidate of target.candidates) {
      const preset = model?.countComponentPreset?.(candidate.key)
      if (preset) add(candidate.category, candidate.name, preset)
    }
    for (const fixture of fixtures) {
      if (fixture.id !== origin.id && isAvailableCountFixture(fixture)
        && fixture.category === target.category
        && (target.name === undefined || fixture.name === target.name)) {
        add(fixture.category, fixture.name)
      }
    }
  }
  return [...choices.values()]
}

export function resolveRelatedCountComponent(
  choice: RelatedCountComponentChoice,
  fixtures: readonly CountFixture[],
): { fixture: CountFixture; newFixtures: CountFixture[] } {
  const local = fixtures
    .filter(fixture => isAvailableCountFixture(fixture)
      && fixture.category === choice.category && fixture.name === choice.name)
    .sort((left, right) => left.order - right.order)[0]
  if (local) return { fixture: local, newFixtures: [] }

  if (!choice.preset) throw new Error('構成要素にする個数の項目が見つかりません。')
  const identity = fixtureIdentity(choice.preset)
  const existing = fixtures
    .filter(fixture => isAvailableCountFixture(fixture)
      && fixtureIdentity(fixture) === identity)
    .sort((left, right) => left.order - right.order)[0]
  if (existing) return { fixture: existing, newFixtures: [] }

  const preset = structuredClone(choice.preset)
  const fixture: CountFixture = {
    ...preset,
    conditions: [...(preset.conditions ?? [])],
    id: crypto.randomUUID(),
    order: fixtures.reduce((order, item) => Math.max(order, item.order + 1), 0),
    style: nextCountStyle(fixtures),
  }
  delete fixture.line
  return { fixture, newFixtures: [fixture] }
}
