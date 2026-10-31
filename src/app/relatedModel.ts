import type { FixturePreset } from '../core/countFixtures'
import {
  buildRelatedIndex,
  normalizeItemName,
  type RelatedIndex,
  type ResolveRelatedTarget,
} from '../core/related/suggest'

export interface RelatedModel {
  index: RelatedIndex
  resolveTarget: ResolveRelatedTarget
  refDocuments: Readonly<Record<string, Readonly<Record<string, string>>>>
  countComponentPreset?(candidateKey: string): FixturePreset | undefined
}

let pending: Promise<RelatedModel> | undefined

export function loadRelated(): Promise<RelatedModel> {
  if (!pending) {
    pending = Promise.all([
      import('../core/related/rules'),
      import('../core/catalog'),
    ]).then(([rules, catalog]) => {
      const items = catalog.catalogItems()
      const presets = new Map<string, FixturePreset | undefined>()
      const countComponentPreset = (candidateKey: string): FixturePreset | undefined => {
        if (presets.has(candidateKey)) return presets.get(candidateKey)
        const item = items.find(value => value.key === candidateKey)
        const option = item?.options.find(value =>
          (value.method ?? 'click') === 'click'
          && (value.kind ?? 'count') === 'count')
        const preset = item && option
          ? catalog.catalogPresets(item, { options: [option.key] })[0]
          : undefined
        presets.set(candidateKey, preset)
        return preset
      }
      const resolveTarget: ResolveRelatedTarget = (target, book) =>
        items.filter(item =>
          (item.field === book || (book === '建築' && item.field === '仮設・土工'))
          && item.category === target.category
          && (target.name === undefined
            || normalizeItemName(item.name) === normalizeItemName(target.name)))
      return {
        index: buildRelatedIndex(rules.RELATED_RULES),
        resolveTarget,
        refDocuments: rules.RELATED_REF_DOCUMENTS,
        countComponentPreset,
      }
    }).catch(reason => {
      pending = undefined
      throw reason
    })
  }
  return pending
}
