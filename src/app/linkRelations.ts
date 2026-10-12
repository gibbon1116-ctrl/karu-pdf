import type { CountFixture } from '../core/countFixtures'
import { fixtureLinkSources } from '../core/fixtureLink'

export interface LinkSourceRelation {
  id: string
  code: string
  name: string
  auto: boolean
  sign: 1 | -1
}

export interface LinkDependentRelation {
  id: string
  code: string
  name: string
}

export interface FixtureLinkRelations {
  sources: Map<string, LinkSourceRelation[]>
  dependents: Map<string, LinkDependentRelation[]>
}

/** Display metadata only. Never read quantities or include crossing barriers. */
export function linkRelations(fixtures: readonly CountFixture[]): FixtureLinkRelations {
  const sources = new Map<string, LinkSourceRelation[]>()
  const dependents = new Map<string, LinkDependentRelation[]>()
  const byId = new Map(fixtures.map(fixture => [fixture.id, fixture]))

  for (const fixture of fixtures) {
    if (!fixture.link) continue

    const originals: LinkSourceRelation[] = []
    const dependentAdded = new Set<string>()
    for (const source of fixtureLinkSources(fixtures, fixture)) {
      const original = byId.get(source.itemId)
      if (!original) continue

      originals.push({
        id: original.id,
        code: original.code,
        name: original.name,
        auto: source.auto === true,
        sign: source.sign === -1 ? -1 : 1,
      })

      // A source may have multiple settings, but has only one dependent item.
      if (!dependentAdded.has(original.id)) {
        dependentAdded.add(original.id)
        const list = dependents.get(original.id) ?? []
        list.push({ id: fixture.id, code: fixture.code, name: fixture.name })
        dependents.set(original.id, list)
      }
    }
    sources.set(fixture.id, originals)
  }

  return { sources, dependents }
}

export function linkSourceText(sources: readonly LinkSourceRelation[]): string {
  if (!sources.length) return ''
  return `← ${sources[0].name}${sources.length > 1 ? ` ほか${sources.length - 1}` : ''}`
}

export function linkSourceLabel(source: LinkSourceRelation): string {
  const identity = [source.code, source.name].filter(Boolean).join(' ')
  return `${source.sign === -1 ? '− ' : ''}${identity}${source.auto ? '（自動）' : ''}`
}

export function linkSourceTitle(sources: readonly LinkSourceRelation[]): string {
  return sources.map(linkSourceLabel).join('\n')
}

export function linkDependentTitle(dependents: readonly LinkDependentRelation[]): string {
  return dependents.map(dependent => dependent.name).join('\n')
}
