import type { CountFixture } from './countFixtures'
import { normalizeItemName } from './related/suggest'

/** 文書の項目の摘要から、同じ名称の項目を優先して値を集める。重複なし、最大30件。 */
export function documentSummaryValues(
  fixtures: readonly Pick<CountFixture, 'name' | 'summary'>[],
  label: string,
  name?: string,
): string[] {
  const normalizedName = name === undefined ? undefined : normalizeItemName(name)
  const values = new Set<string>()

  const collect = (sameName: boolean) => {
    for (const fixture of fixtures) {
      const matches = normalizedName !== undefined
        && normalizeItemName(fixture.name) === normalizedName
      if (matches !== sameName) continue

      for (const field of fixture.summary ?? []) {
        if (field.label !== label) continue
        const value = field.value.trim()
        if (!value) continue
        values.add(value)
        if (values.size >= 30) return
      }
    }
  }

  if (normalizedName !== undefined) collect(true)
  if (values.size < 30) collect(false)
  return [...values]
}
