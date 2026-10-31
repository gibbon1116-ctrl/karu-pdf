import type { DrawingInfo } from '../core/drawingInfo'
import { normalizeOutlineTitle, type OutlineItem } from '../core/outlineModel'

export interface DrawingOutlineCandidate { pageIndex: number; number: string; name: string; title: string; include: boolean; group: string | null }
export interface DrawingOutlineGroup { key: string; title: string; guessed: boolean }
const groupNames: Record<string, string> = { E: '電気設備図', M: '機械設備図', A: '意匠図', S: '構造図', P: '衛生設備図' }
const clean = (value: string) => value.replace(/\s+/g, ' ').trim()

export function drawingNumberPrefix(number: string): string | null {
  const value = number.trim(), prefix = /^[A-Za-z]+/.exec(value)?.[0]
  return prefix && /[0-9]/.test(value) ? prefix.toUpperCase() : null
}
export function drawingOutlineCandidates(infos: readonly (DrawingInfo | null)[]): DrawingOutlineCandidate[] {
  return infos.flatMap((info, pageIndex) => {
    const number = clean(info?.number ?? ''), name = clean(info?.name ?? '')
    return number || name ? [{ pageIndex, number, name, title: clean(`${number} ${name}`), include: true, group: drawingNumberPrefix(number) }] : []
  })
}
export function drawingOutlineGroups(candidates: readonly DrawingOutlineCandidate[]): { groups: DrawingOutlineGroup[]; reason: string | null } {
  const included = candidates.filter(candidate => candidate.include)
  if (!included.length) return { groups: [], reason: '含めるページを選んでください' }
  const prefixes = included.map(candidate => drawingNumberPrefix(candidate.number))
  if (prefixes.some(prefix => prefix === null)) return { groups: [], reason: '図面番号に英字の頭と数字がないページがあるため、まとめられません' }
  const keys = [...new Set(prefixes as string[])]
  if (keys.length < 2) return { groups: [], reason: '図面番号の英字の頭が1種類だけのため、まとめられません' }
  return { groups: keys.map(key => ({ key, title: groupNames[key] ?? key, guessed: Object.hasOwn(groupNames, key) })), reason: null }
}
export function buildDrawingOutline(candidates: readonly DrawingOutlineCandidate[], groups: readonly DrawingOutlineGroup[] | null): OutlineItem[] {
  let serial = 0
  const item = (title: string, pageIndex: number, open = false): OutlineItem => ({
    id: `new:drawing-${++serial}`, title: normalizeOutlineTitle(title), open,
    target: { kind: 'page', pageIndex, view: null, source: 'dest' },
    style: { bold: false, italic: false, color: null }, children: [],
  })
  const included = candidates.filter(candidate => candidate.include)
  if (!groups?.length) return included.map(candidate => item(candidate.title, candidate.pageIndex))
  const result: OutlineItem[] = [], parents = new Map<string, OutlineItem>()
  for (const candidate of included) {
    const key = drawingNumberPrefix(candidate.number), group = groups.find(group => group.key === key)
    if (!key || !group) throw new Error('図面番号のまとめ方が候補と一致しません。まとめ方を選び直してください。')
    let parent = parents.get(key)
    if (!parent) { parent = item(group.title, candidate.pageIndex, true); parents.set(key, parent); result.push(parent) }
    parent.children.push(item(candidate.title, candidate.pageIndex))
  }
  return result
}
