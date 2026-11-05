import type { CountFixture } from '../core/countFixtures'

export function commonOpacity(fixtures: readonly CountFixture[]): number | null {
  const opacity = fixtures[0]?.style.opacity
  return opacity !== undefined && fixtures.every(fixture => fixture.style.opacity === opacity) ? opacity : null
}

export function withOpacity(fixtures: readonly CountFixture[], opacity: number): { next: CountFixture[]; changedIds: string[] } {
  const changedIds: string[] = []
  const next = fixtures.map(fixture => {
    if (fixture.style.opacity === opacity) return fixture
    changedIds.push(fixture.id)
    return { ...fixture, style: { ...fixture.style, opacity } }
  })
  return { next, changedIds }
}
