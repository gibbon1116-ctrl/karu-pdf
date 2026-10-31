import type { PDFDocument } from 'mupdf'
import type { RelatedDecision } from './suggest'
import { PROJECT_MODES, WORK_TYPES, type ProjectMode, type WorkType } from './types'

export const RELATED_REVIEW_DECISIONS: readonly RelatedDecision[] = [
  '必要', '不要', '単価包含', '他工事', '後で確認', '構成要素で拾う',
]

export const RELATED_REVIEW_ASSIGNEES = [
  '建築', '電気設備', '機械設備', '別途工事', 'その他',
] as const

export type RelatedReviewAssignee = typeof RELATED_REVIEW_ASSIGNEES[number]

export interface RelatedReviewDecision {
  decision: RelatedDecision
  assignee?: RelatedReviewAssignee
  ruleIds: string[]
  originFixtureIds: string[]
  reason?: string
  rulesVersion: string
  decidedAt: string
}

export interface RelatedReviews {
  version: 1
  projectMode?: ProjectMode
  works: Record<string, WorkType>
  decisions: Record<string, RelatedReviewDecision>
}

function emptyReviews(): RelatedReviews {
  return { version: 1, works: {}, decisions: {} }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined
}

function put<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value, enumerable: true, configurable: true, writable: true,
  })
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isoDateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!match) return false
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && Number(match[4]) <= 23 && Number(match[5]) <= 59
    && Number(match[6]) <= 59
    && (match[8] === undefined || Number(match[8]) <= 23)
    && (match[9] === undefined || Number(match[9]) <= 59)
    && Number.isFinite(Date.parse(value))
}

function normalize(raw: unknown, strict: boolean): RelatedReviews {
  const invalid = (): void => {
    if (strict) throw new Error('関連候補の判断の保存データが不正です。')
  }
  let decoded = raw
  if (typeof decoded === 'string') {
    try { decoded = JSON.parse(decoded) }
    catch { invalid(); return emptyReviews() }
  }
  const envelope = record(decoded)
  if (!envelope || own(envelope, 'version') !== 1) {
    invalid()
    return emptyReviews()
  }

  const result = emptyReviews()
  const mode = own(envelope, 'projectMode')
  if (mode !== undefined) {
    if (PROJECT_MODES.includes(mode as ProjectMode)) result.projectMode = mode as ProjectMode
    else invalid()
  }

  const works = record(own(envelope, 'works'))
  if (!works) invalid()
  if (works) {
    const keys = Object.keys(works).sort()
    if (keys.length > 1000) invalid()
    let count = 0
    for (const key of keys) {
      if (count >= 1000) break
      const value = works[key]
      if (!nonempty(key) || !WORK_TYPES.includes(value as WorkType)) {
        invalid()
        continue
      }
      put(result.works, key, value as WorkType)
      count++
    }
  }

  const strings = (rawArray: unknown, maximum: number, maxLength?: number): string[] | undefined => {
    if (!Array.isArray(rawArray)) { invalid(); return undefined }
    if (rawArray.length > maximum) invalid()
    const values: string[] = []
    const seen = new Set<string>()
    for (const value of rawArray) {
      if (!nonempty(value) || maxLength !== undefined && value.length > maxLength) {
        invalid()
        continue
      }
      if (seen.has(value)) continue
      if (values.length >= maximum) break
      seen.add(value)
      values.push(value)
    }
    return values.sort()
  }

  const decisions = record(own(envelope, 'decisions'))
  if (!decisions) invalid()
  if (decisions) {
    const keys = Object.keys(decisions).sort()
    const normalized = new Map<string, RelatedReviewDecision>()
    for (const key of keys) {
      const source = record(decisions[key])
      if (!nonempty(key) || !source) { invalid(); continue }
      const decision = own(source, 'decision')
      const rulesVersion = own(source, 'rulesVersion')
      const decidedAt = own(source, 'decidedAt')
      if (!RELATED_REVIEW_DECISIONS.includes(decision as RelatedDecision)
        || !nonempty(rulesVersion) || !isoDateTime(decidedAt)) {
        invalid()
        continue
      }
      const ruleIds = strings(own(source, 'ruleIds'), 20, 32)
      const originFixtureIds = strings(own(source, 'originFixtureIds'), 50)
      if (!ruleIds?.length || originFixtureIds === undefined) {
        invalid()
        continue
      }
      const value: RelatedReviewDecision = {
        decision: decision as RelatedDecision,
        ruleIds,
        originFixtureIds,
        rulesVersion,
        decidedAt,
      }
      const reason = own(source, 'reason')
      if (reason !== undefined) {
        if (typeof reason === 'string' && reason.length <= 200) value.reason = reason
        else invalid()
      }
      const assignee = own(source, 'assignee')
      if (decision === '他工事'
        && RELATED_REVIEW_ASSIGNEES.includes(assignee as RelatedReviewAssignee)) {
        value.assignee = assignee as RelatedReviewAssignee
      }
      normalized.set(key, value)
    }

    const needsExpansion = (key: string, value: RelatedReviewDecision): boolean =>
      !key.includes('@')
      && /^(?:item|check|note):/.test(key)
      && value.originFixtureIds.length > 0

    const expanded = new Map<string, RelatedReviewDecision>()
    // 明示的に保存された新しい鍵を先に確保し、古い判断では上書きしない。
    for (const [key, value] of normalized) {
      if (!needsExpansion(key, value)) expanded.set(key, value)
    }
    for (const [key, value] of normalized) {
      if (!needsExpansion(key, value)) continue
      for (const originId of value.originFixtureIds) {
        const expandedKey = `${key}@${originId}`
        if (!expanded.has(expandedKey)) {
          expanded.set(expandedKey, {
            ...value,
            ruleIds: [...value.ruleIds],
            originFixtureIds: [originId],
          })
        }
      }
    }

    // 展開・重複解消の後に上限を適用する。同日時は鍵順で決める。
    const retained = [...expanded].map(([key, value]) => ({
      key, value, time: Date.parse(value.decidedAt),
    })).sort((a, b) =>
      b.time - a.time || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, 5000)
      .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    for (const { key, value } of retained) put(result.decisions, key, value)
  }
  return result
}

export function parseRelatedReviews(raw: unknown): RelatedReviews {
  return normalize(raw, false)
}

export function serializeRelatedReviews(value: RelatedReviews): string {
  return JSON.stringify(normalize(value, true))
}

export function readRelatedReviews(doc: PDFDocument): RelatedReviews {
  const trailer = doc.getTrailer()
  const root = trailer.get('Root')
  try {
    const value = root.get('KaruRelatedReviews')
    try {
      return value.isString() ? parseRelatedReviews(value.asString()) : emptyReviews()
    } finally { value.destroy() }
  } finally { root.destroy(); trailer.destroy() }
}

export function writeRelatedReviews(doc: PDFDocument, reviews: RelatedReviews): void {
  // 検証は Root を変更する前に済ませる。
  const json = serializeRelatedReviews(reviews)
  const valid = parseRelatedReviews(json)
  const trailer = doc.getTrailer()
  const root = trailer.get('Root')
  try {
    if (valid.projectMode === undefined
      && !Object.keys(valid.works).length && !Object.keys(valid.decisions).length) {
      root.delete('KaruRelatedReviews')
      return
    }
    const value = doc.newString(json)
    try { root.put('KaruRelatedReviews', value) }
    finally { value.destroy() }
  } finally { root.destroy(); trailer.destroy() }
}
