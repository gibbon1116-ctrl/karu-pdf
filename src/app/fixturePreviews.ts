import type { CountFixture } from '../core/countFixtures'
import {
  computeLinks, fixtureCrossingBarriers, fixtureLinkSources,
} from '../core/fixtureLink'
import { steelSection } from '../core/steelMember'
import { STEEL_REQUIRED_FACTOR } from '../core/breakdown/steelData'
import { collectShapeMetrics } from '../core/shapeMetrics'
import { computeRcMember, type RcResult } from '../core/rcMember'
import type { DocumentSession } from './documentModel'

type AnnotationStore = DocumentSession['annotationStore']

export function createFixturePreviews(store: AnnotationStore) {
  const fixturesWith = (draft: CountFixture) => {
    const current = store.getCountFixtures()
    return current.some(f => f.id === draft.id)
      ? current.map(f => f.id === draft.id ? draft : f) : [...current, draft]
  }

  const previewLink = (draft: CountFixture) => {
    const next = fixturesWith(draft)
    const sourceIndex = store.quantityIndex()
    const metricLinks = next.filter(f => f.link?.kind === 'rc'
      || f.link?.kind === 'shape' || f.link?.kind === 'crossing'
      || f.link?.kind === 'steel')
    const itemIds = new Set<string>()
    const crossingItemIds = new Set<string>()
    for (const fixture of metricLinks) {
      const sources = fixtureLinkSources(next, fixture)
      for (const source of sources) {
        itemIds.add(source.itemId)
        if (fixture.link?.kind === 'crossing') crossingItemIds.add(source.itemId)
      }
      if (fixture.link?.kind === 'crossing') {
        const sourceIds = new Set(sources.map(source => source.itemId))
        for (const barrier of fixtureCrossingBarriers(next, fixture, sourceIds)) {
          itemIds.add(barrier.id)
          crossingItemIds.add(barrier.id)
        }
      }
    }
    const metrics = metricLinks.length
      ? collectShapeMetrics(
        store.quantityAnnotations(), next, itemIds, crossingItemIds,
      )
      : undefined
    return computeLinks(next, id => sourceIndex.entries(id),
      metrics ? id => metrics.get(id) ?? [] : undefined).get(draft.id)
  }

  const previewRc = (draft: CountFixture): RcResult | undefined => {
    if (!draft.rc || draft.link) return undefined
    const metrics = collectShapeMetrics(
      store.quantityAnnotations(), fixturesWith(draft), new Set([draft.id]),
    ).get(draft.id)
    if (!metrics?.length) return undefined
    const result: RcResult = {
      concreteM3: 0, formworkM2: 0, bars: [], lapJoints: 0, gasJoints: [],
    }
    const gasBySize = new Map<string, number>()
    const shapeTexts: string[] = []
    for (const metric of metrics) {
      const part = computeRcMember(draft.rc, metric)
      // 体積の拾いから読んだ寸法の説明は拾いごとに出す（3 件まで、残りは件数）。
      if (part.shapeDimensionText) shapeTexts.push(part.shapeDimensionText)
      result.concreteM3 += part.concreteM3
      result.formworkM2 += part.formworkM2
      result.bars.push(...part.bars)
      result.lapJoints += part.lapJoints
      for (const joint of part.gasJoints) {
        gasBySize.set(joint.size, (gasBySize.get(joint.size) ?? 0) + joint.count)
      }
    }
    result.gasJoints = [...gasBySize].map(([size, count]) => ({ size, count }))
    if (shapeTexts.length) {
      result.shapeDimensionText = shapeTexts.slice(0, 3).join('／')
        + (shapeTexts.length > 3 ? `／ほか${shapeTexts.length - 3}件` : '')
    }
    if (![result.concreteM3, result.formworkM2, result.lapJoints,
      ...result.gasJoints.map(joint => joint.count)].every(Number.isFinite)) {
      return undefined
    }
    return result
  }

  const previewSteel = (draft: CountFixture) => {
    if (!draft.steel || draft.link || draft.rc) return undefined
    const section = steelSection(draft.steel)
    if (!section) return undefined
    const metrics = collectShapeMetrics(
      store.quantityAnnotations(), fixturesWith(draft), new Set([draft.id]),
    ).get(draft.id)?.filter(metric => !metric.crossingOnly)
    if (!metrics?.length) return undefined
    const result = {
      lengthM: 0, massT: 0, requiredT: 0, contourM2: 0, boxM2: 0,
    }
    for (const metric of metrics) {
      if ((metric.method !== 'polyline' && metric.method !== 'click')
        || !Number.isFinite(metric.count) || metric.count < 0
        || !Number.isFinite(metric.lengthM) || metric.lengthM < 0
        || (metric.method === 'click' && draft.steel.lengthMm === undefined)) {
        throw new Error('鉄骨部材の拾い方・長さ・個数が正しくありません。')
      }
      const lengthM = (metric.method === 'click'
        ? draft.steel.lengthMm! / 1000 : metric.lengthM) * metric.count
      result.lengthM += lengthM
      result.massT += lengthM * section.massKgPerM / 1000
      result.contourM2 += lengthM * section.surfaceM2PerM('contour')
      result.boxM2 += lengthM * section.surfaceM2PerM('box')
    }
    result.requiredT = result.massT * STEEL_REQUIRED_FACTOR.section
    if (!Object.values(result).every(Number.isFinite)) {
      throw new Error('鉄骨部材の計算結果が有限の数量を超えています。')
    }
    return result
  }

  return { previewLink, previewRc, previewSteel }
}
