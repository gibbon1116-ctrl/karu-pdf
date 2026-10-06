import type { CountFixture } from '../core/countFixtures'

type Group = { category: string; items: CountFixture[] }

export function groupFixtures(fixtures: readonly CountFixture[]): Group[] {
  const groups = new Map<string, CountFixture[]>()
  for (const fixture of [...fixtures].sort((a, b) => a.order - b.order)) {
    const items = groups.get(fixture.category)
    if (items) items.push(fixture)
    else groups.set(fixture.category, [fixture])
  }
  return [...groups].map(([category, items]) => ({ category, items }))
}

export function renumber(groups: ReadonlyArray<{ category: string; items: readonly CountFixture[] }>): CountFixture[] {
  return groups.flatMap(group => group.items.map(item => ({ ...item, category: group.category })))
    .map((item, order) => ({ ...item, order }))
}

export function moveFixture(fixtures: readonly CountFixture[], id: string, to: { beforeId: string } | { afterId: string } | { endOfCategory: string }): CountFixture[] {
  const groups = groupFixtures(fixtures), item = fixtures.find(f => f.id === id)
  const targetId = 'beforeId' in to ? to.beforeId : 'afterId' in to ? to.afterId : undefined
  const target = targetId === undefined ? undefined : fixtures.find(f => f.id === targetId)
  const destination = groups.find(g => g.category === ('endOfCategory' in to ? to.endOfCategory : target?.category))
  if (!item || !destination || targetId === id) return renumber(groups)
  for (const group of groups) group.items = group.items.filter(f => f.id !== id)
  const index = targetId === undefined ? destination.items.length : destination.items.findIndex(f => f.id === targetId) + ('afterId' in to ? 1 : 0)
  destination.items.splice(index, 0, { ...item, category: destination.category })
  return renumber(groups.filter(g => g.items.length))
}

export function moveCategory(fixtures: readonly CountFixture[], category: string, to: { beforeCategory: string } | { end: true }): CountFixture[] {
  const groups = groupFixtures(fixtures), source = groups.findIndex(g => g.category === category)
  if (source < 0 || ('beforeCategory' in to && (to.beforeCategory === category || !groups.some(g => g.category === to.beforeCategory)))) return renumber(groups)
  const [group] = groups.splice(source, 1)
  groups.splice('end' in to ? groups.length : groups.findIndex(g => g.category === to.beforeCategory), 0, group)
  return renumber(groups)
}

export function stepFixture(fixtures: readonly CountFixture[], id: string, direction: -1 | 1): CountFixture[] | null {
  const groups = groupFixtures(fixtures), group = groups.find(g => g.items.some(f => f.id === id))
  if (!group) return null
  const index = group.items.findIndex(f => f.id === id), next = index + direction
  if (next < 0 || next >= group.items.length) return null
  ;[group.items[index], group.items[next]] = [group.items[next], group.items[index]]
  return renumber(groups)
}
