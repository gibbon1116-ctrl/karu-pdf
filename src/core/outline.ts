import mupdf, { type PDFDocument, type PDFObject } from 'mupdf'
import type { PageLayoutCard } from './pageOps'
import { buildOutlineApplyPlan, flattenOutline, normalizeOutlineTitle, outlineEqual, outlineRevision, OUTLINE_MAX_DEPTH, OUTLINE_MAX_ITEMS, removeOutlineItem, updateOutlineItem, validateOutlineItems, type OutlineApplyPlan, type OutlineApplyResult, type OutlineItem, type OutlineLayoutImpact, type OutlineLayoutPlan, type OutlineSnapshot, type OutlineTarget, type OutlineView, type OutlineViewType } from './outlineModel'

const STALE = '目次がほかの操作で変わりました。目次を読み込み直してください。'
const LOST = 'ページ整理で目次の項目が失われるため、中止しました。'
const REPAIR = '目次の内部の参照に不整合があります。反映するときに直します。'
const VIEWS = new Set<OutlineViewType>(['XYZ', 'Fit', 'FitH', 'FitV', 'FitR', 'FitB', 'FitBH', 'FitBV'])
function catalog(document: PDFDocument): PDFObject {
  const trailer = document.getTrailer()
  try { return trailer.get('Root') } finally { trailer.destroy() }
}
export function hasOutline(document: PDFDocument): boolean {
  const root = catalog(document), outlines = root.get('Outlines')
  try { return !outlines.isNull() } finally { outlines.destroy(); root.destroy() }
}

export function readOutline(document: PDFDocument): OutlineSnapshot {
  const root = catalog(document), outlines = root.get('Outlines')
  let names: Record<string, PDFObject> | undefined
  try {
    if (outlines.isNull()) return { revision: outlineRevision('empty'), items: [], editable: true, problems: [], itemCount: 0 }
    const problems = new Set<string>(), seen = new Set<number>()
    let editable = true, count = 0, pages: Map<number, number> | undefined
    const fail = (reason: string) => { editable = false; problems.add(reason) }
    const pageCount = document.countPages()
    const pageMap = () => {
      if (!pages) {
        pages = new Map()
        for (let i = 0; i < pageCount; i++) {
          const page = document.findPage(i)
          try { if (!pages.has(page.asIndirect())) pages.set(page.asIndirect(), i) } finally { page.destroy() }
        }
      }
      return pages
    }
    const broken = (reason = '移動先のページが見つかりません'): OutlineTarget => ({ kind: 'broken', reason })
    const resolve = (dest: PDFObject, source: 'dest' | 'goto', allowName = true): OutlineTarget => {
      if (allowName && (dest.isName() || dest.isString())) {
        const name = dest.isName() ? dest.asName() : dest.asString()
        let value: PDFObject | undefined
        try {
          if (dest.isName()) value = root.get('Dests', name)
          else {
            if (!names) {
              const tree = root.get('Names', 'Dests')
              try { names = tree.isNull() ? {} : document.loadNameTree('Dests') } finally { tree.destroy() }
            }
            value = names[name]
          }
          if (!value || value.isNull()) return broken('名前付きの移動先が見つかりません')
          let result: OutlineTarget
          if (value.isDictionary()) {
            const d = value.get('D')
            try { result = resolve(d, source, false) } finally { d.destroy() }
          } else result = resolve(value, source, false)
          return result.kind === 'page' ? { ...result, source: 'named', name } : result
        } finally { if (dest.isName()) value?.destroy() }
      }
      if (!dest.isArray()) return broken('移動先を読み取れません')
      const page = dest.get(0), type = dest.get(1)
      try {
        const index = page.isIndirect() ? pageMap().get(page.asIndirect()) : page.isInteger() ? page.asNumber() : undefined
        if (index === undefined || index < 0 || index >= pageCount) return broken()
        let view: OutlineView | null = null
        if (type.isName() && VIEWS.has(type.asName() as OutlineViewType)) {
          const params: (number | null)[] = []
          let valid = true
          for (let i = 2; i < dest.length; i++) {
            const param = dest.get(i)
            try { if (!param.isNumber() && !param.isNull()) valid = false; params.push(param.isNumber() ? param.asNumber() : null) } finally { param.destroy() }
          }
          if (valid) view = { type: type.asName() as OutlineViewType, params }
        }
        return { kind: 'page', pageIndex: index, view, source }
      } finally { page.destroy(); type.destroy() }
    }
    const target = (object: PDFObject): OutlineTarget => {
      const dest = object.get('Dest'), action = object.get('A')
      try {
        if (!dest.isNull()) return resolve(dest, 'dest')
        if (action.isNull()) return { kind: 'none' }
        const s = action.get('S'), next = action.get('Next')
        try {
          const name = s.isName() ? s.asName() : '不明'
          if (name === 'GoTo' && next.isNull()) {
            const d = action.get('D')
            try {
              const resolved = resolve(d, 'goto')
              return resolved.kind === 'page' ? { ...resolved, source: 'goto' } : { kind: 'special', action: name }
            } finally { d.destroy() }
          }
          if (name === 'URI') {
            const uri = action.get('URI')
            try { return { kind: 'external', uri: uri.isString() ? uri.asString() : '' } } finally { uri.destroy() }
          }
          return { kind: 'special', action: name }
        } finally { s.destroy(); next.destroy() }
      } finally { dest.destroy(); action.destroy() }
    }
    const sameRef = (a: PDFObject, b: PDFObject) => a.isIndirect() && b.isIndirect() && a.asIndirect() === b.asIndirect()
    const visit = (parent: PDFObject, depth: number): OutlineItem[] => {
      const items: OutlineItem[] = []
      let current = parent.get('First'), previous = 0
      try {
        while (!current.isNull()) {
          if (depth > OUTLINE_MAX_DEPTH) { fail('目次の階層が深すぎます。'); break }
          if (!current.isIndirect() || !current.isDictionary()) { fail('目次の項目が間接参照の辞書ではありません。'); break }
          const number = current.asIndirect()
          if (seen.has(number)) { fail('目次に循環または重複した参照があります。'); break }
          if (count >= OUTLINE_MAX_ITEMS) { fail('目次の項目が多すぎます。'); break }
          seen.add(number); count++
          // Build once, and only after an actual item has been encountered.
          pageMap()
          const p = current.get('Parent'), prev = current.get('Prev'), title = current.get('Title'), c = current.get('Count'), f = current.get('F'), color = current.get('C')
          try {
            if (!sameRef(p, parent) || (previous ? !prev.isIndirect() || prev.asIndirect() !== previous : !prev.isNull())) problems.add(REPAIR)
            let rgb: [number, number, number] | null = null
            if (color.isArray() && color.length === 3) {
              const values: number[] = []
              for (let i = 0; i < 3; i++) { const value = color.get(i); try { if (value.isNumber()) values.push(value.asNumber()) } finally { value.destroy() } }
              if (values.length === 3) rgb = values as [number, number, number]
            }
            const flags = f.isNumber() ? f.asNumber() : 0
            items.push({ id: `obj:${number}`, title: title.isString() ? title.asString() : '', open: c.isNumber() && c.asNumber() > 0, target: target(current), style: { bold: !!(flags & 2), italic: !!(flags & 1), color: rgb }, children: visit(current, depth + 1) })
          } finally { p.destroy(); prev.destroy(); title.destroy(); c.destroy(); f.destroy(); color.destroy() }
          previous = number
          const next = current.get('Next')
          current.destroy(); current = next
        }
        const last = parent.get('Last')
        try { if (previous ? !last.isIndirect() || last.asIndirect() !== previous : !last.isNull()) problems.add(REPAIR) } finally { last.destroy() }
      } finally { current.destroy() }
      return items
    }
    const items = visit(outlines, 1)
    const parts = flattenOutline(items).map(({ item, parentId }) => [item.id, parentId, item.title, item.open, item.target, item.style])
    return { revision: outlineRevision(JSON.stringify([pageCount, parts])), items, editable, problems: [...problems], itemCount: count }
  } finally { if (names) Object.values(names).forEach(value => value.destroy()); outlines.destroy(); root.destroy() }
}

function setRef(object: PDFObject, key: string, value: PDFObject | undefined): void {
  const old = object.get(key)
  try {
    if (!value) { if (!old.isNull()) object.delete(key) }
    else if (!old.isIndirect() || old.asIndirect() !== value.asIndirect()) object.put(key, value)
  } finally { old.destroy() }
}
function setCount(object: PDFObject, value: number | undefined): void {
  const old = object.get('Count')
  try {
    if (value === undefined) { if (!old.isNull()) object.delete('Count') }
    else if (!old.isNumber() || old.asNumber() !== value) object.put('Count', value)
  } finally { old.destroy() }
}
function newDictionaryRef(document: PDFDocument): PDFObject {
  const dictionary = document.newDictionary()
  try { return document.addObject(dictionary) } finally { dictionary.destroy() }
}
export function applyOutline(document: PDFDocument, plan: OutlineApplyPlan): OutlineApplyResult {
  const before = readOutline(document)
  if (plan.baseRevision !== before.revision) throw new Error(STALE)
  if (!before.editable) throw new Error(before.problems[0])
  const original = new Map(flattenOutline(before.items).map(({ item }) => [item.id, item]))
  let itemCount = 0
  const ids = new Set<string>(), keptTitles = new Set<string>()
  const convert = (list: OutlineApplyPlan['items'], depth: number): OutlineItem[] => {
    if (list.length && depth > OUTLINE_MAX_DEPTH) throw new Error('目次の階層が深すぎます。')
    return list.map(item => {
      if (++itemCount > OUTLINE_MAX_ITEMS) throw new Error('目次の項目が多すぎます。')
      if (ids.has(item.id)) throw new Error('目次のIDが重複しています。')
      ids.add(item.id)
      const old = original.get(item.id)
      if (!old && !/^new:.+/.test(item.id)) throw new Error('目次の項目が見つかりません。')
      if (!old && item.target.kind === 'keep') throw new Error('新しい目次の移動先を指定してください。')
      if (old && (old.target.kind === 'external' || old.target.kind === 'special') && item.target.kind === 'none') throw new Error('外部リンクや特殊な移動先は明示して置き換えてください。')
      if (!['keep', 'page', 'none'].includes(item.target.kind)) throw new Error('目次の移動先が正しくありません。')
      if (item.target.kind === 'page' && item.target.view && (!VIEWS.has(item.target.view.type) || item.target.view.params.some(p => p !== null && !Number.isFinite(p)))) throw new Error('目次の表示位置が正しくありません。')
      const target: OutlineTarget = item.target.kind === 'keep' ? old!.target : item.target.kind === 'page' ? { ...item.target, source: 'dest' } : { kind: 'none' }
      // An untouched title is written back as stored: blank or untrimmed titles in
      // existing PDFs must neither block the apply nor be rewritten.
      const keepTitle = !!old && item.title === old.title
      if (keepTitle) keptTitles.add(item.id)
      return { id: item.id, title: keepTitle ? old!.title : normalizeOutlineTitle(item.title), open: item.open, target, style: old?.style ?? { bold: false, italic: false, color: null }, children: convert(item.children, depth + 1) }
    })
  }
  const desired = convert(plan.items, 1)
  const edits = new Map<string, OutlineApplyPlan['items'][number]['target']>()
  const indexEdits = (items: OutlineApplyPlan['items']) => { for (const item of items) { edits.set(item.id, item.target); indexEdits(item.children) } }
  indexEdits(plan.items)
  const errors = validateOutlineItems(desired, document.countPages(), keptTitles)
  if (errors.length) throw new Error(errors[0])
  const objects = new Map<string, PDFObject>(), idMap: Record<string, string> = {}
  const root = catalog(document)
  let outlines = root.get('Outlines')
  try {
    if (!desired.length) {
      if (!outlines.isNull()) root.delete('Outlines')
    } else {
      if (outlines.isNull()) {
        outlines.destroy(); outlines = newDictionaryRef(document)
        const type = document.newName('Outlines')
        try { outlines.put('Type', type) } finally { type.destroy() }
        root.put('Outlines', outlines)
      }
      for (const { item } of flattenOutline(desired)) {
        const object = original.has(item.id) ? document.newIndirect(Number(item.id.slice(4))) : newDictionaryRef(document)
        objects.set(item.id, object)
        if (!original.has(item.id)) idMap[item.id] = `obj:${object.asIndirect()}`
      }
      const write = (items: OutlineItem[], plans: OutlineApplyPlan['items'], parent: PDFObject): number => {
        setRef(parent, 'First', objects.get(items[0]?.id)); setRef(parent, 'Last', objects.get(items[items.length - 1]?.id))
        let visible = 0
        items.forEach((item, i) => {
          const object = objects.get(item.id)!, target = plans[i].target, oldTitle = object.get('Title')
          try {
            if (!keptTitles.has(item.id) && (!oldTitle.isString() || oldTitle.asString() !== item.title)) {
              const title = document.newString(item.title)
              try { object.put('Title', title) } finally { title.destroy() }
            }
          } finally { oldTitle.destroy() }
          if (target.kind !== 'keep') {
            if (target.kind === 'page') {
              const dest = document.newArray(), page = document.findPage(target.pageIndex), type = document.newName(target.view?.type ?? 'Fit')
              try {
                dest.push(page); dest.push(type)
                for (const value of target.view?.params ?? []) dest.push(value)
                object.put('Dest', dest)
              } finally { dest.destroy(); page.destroy(); type.destroy() }
            } else object.delete('Dest')
            const action = object.get('A'), s = object.get('A', 'S')
            try {
              const originalTarget = original.get(item.id)?.target
              const replacingAction = target.kind === 'page' && (originalTarget?.kind === 'external' || originalTarget?.kind === 'special')
              if (replacingAction || (s.isName() && s.asName() === 'GoTo')) { if (!action.isNull()) object.delete('A') }
            } finally { s.destroy(); action.destroy() }
          }
          setRef(object, 'Parent', parent); setRef(object, 'Prev', objects.get(items[i - 1]?.id)); setRef(object, 'Next', objects.get(items[i + 1]?.id))
          const childrenVisible = write(item.children, plans[i].children, object)
          setCount(object, item.children.length ? (item.open ? childrenVisible : -childrenVisible) : undefined)
          visible += 1 + (item.open ? childrenVisible : 0)
        })
        return visible
      }
      setCount(outlines, write(desired, plan.items, outlines))
    }
    const snapshot = readOutline(document)
    const verify = (expected: OutlineItem[], actual: OutlineItem[]): boolean => expected.length === actual.length && expected.every((item, i) => {
      const got = actual[i], edit = edits.get(item.id)
      const view = item.target.kind === 'page' ? item.target.view : null
      // MuPDF stores non-integer PDF numbers as single-precision reals.
      const pdfView = view ? { ...view, params: view.params.map(value => value === null || value === (value | 0) ? value : Math.fround(value)) } : { type: 'Fit', params: [] }
      const wanted = item.target.kind === 'page' && edit?.kind === 'page' ? { ...item.target, view: pdfView } : item.target
      return got.id === (idMap[item.id] ?? item.id) && got.title === item.title && (!item.children.length || got.open === item.open) && outlineEqual(got.target, wanted) && verify(item.children, got.children)
    })
    if (!snapshot.editable || !verify(desired, snapshot.items)) throw new Error('目次を正しく反映できませんでした。')
    return { snapshot, idMap }
  } finally { objects.forEach(object => object.destroy()); outlines.destroy(); root.destroy() }
}
function impactFromSnapshot(targetDocId: string, snapshot: OutlineSnapshot, cards: readonly PageLayoutCard[]): OutlineLayoutImpact {
  const positions = new Map<number, number[]>()
  cards.forEach((card, i) => {
    if (card.source.kind === 'page' && card.source.docId === targetDocId) {
      const list = positions.get(card.source.pageIndex) ?? []; list.push(i); positions.set(card.source.pageIndex, list)
    }
  })
  const impact: OutlineLayoutImpact = { hasOutline: true, editable: snapshot.editable, problems: snapshot.problems, revision: snapshot.revision, removed: [], duplicated: [] }
  const visit = (items: OutlineItem[], path: string[]) => {
    for (const item of items) {
      if (item.target.kind === 'page') {
        const pageIndex = item.target.pageIndex, list = positions.get(pageIndex) ?? []
        if (!list.length) impact.removed.push({ id: item.id, title: item.title, pageIndex, path, hasChildren: item.children.length > 0 })
        if (list.length > 1) impact.duplicated.push({ id: item.id, title: item.title, pageIndex, newPositions: list, originalFirst: cards[list[0]].id === `page-${pageIndex + 1}` })
      }
      visit(item.children, [...path, item.title])
    }
  }
  visit(snapshot.items, [])
  return impact
}
export function outlineLayoutImpact(targetDocId: string, document: PDFDocument, cards: readonly PageLayoutCard[]): OutlineLayoutImpact {
  if (!hasOutline(document)) return { hasOutline: false, editable: true, problems: [], revision: outlineRevision('empty'), removed: [], duplicated: [] }
  return impactFromSnapshot(targetDocId, readOutline(document), cards)
}
export function prepareOutlineForLayout(document: PDFDocument, cards: readonly PageLayoutCard[], order: readonly number[], plan: OutlineLayoutPlan | undefined, targetDocId: string): { expectedCount: number; retarget: Array<{ id: string; cardIndex: number }> } | null {
  if (!hasOutline(document)) return null
  const snapshot = readOutline(document), impact = impactFromSnapshot(targetDocId, snapshot, cards)
  if (impact.removed.length && !snapshot.editable) throw new Error('目次の構造が読み取れないため、目次の指すページを削除できません。')
  if (plan && plan.baseRevision !== snapshot.revision) throw new Error(STALE)
  if (impact.removed.some(item => !plan?.remove.includes(item.id) && !plan?.retarget.some(r => r.id === item.id))) throw new Error('削除されるページを指す目次があります。目次の扱いを選んでからページ整理を適用してください。')
  let items = snapshot.items
  if (plan) {
    const known = new Set(flattenOutline(items).map(({ item }) => item.id)), used = new Set<string>()
    for (const id of [...plan.remove, ...plan.retarget.map(r => r.id)]) {
      if (!known.has(id) || used.has(id)) throw new Error('目次の整理の指定が正しくありません。')
      used.add(id)
    }
    for (const r of plan.retarget) if (!Number.isInteger(r.cardIndex) || r.cardIndex < 0 || r.cardIndex >= cards.length || !Number.isInteger(order[r.cardIndex])) throw new Error('目次の移動先のページが範囲外です。')
    for (const id of plan.remove) items = removeOutlineItem(items, id, 'keepChildren')
    for (const r of plan.retarget) {
      const old = flattenOutline(items).find(({ item }) => item.id === r.id)!.item.target
      items = updateOutlineItem(items, r.id, { target: { kind: 'page', pageIndex: order[r.cardIndex], view: old.kind === 'page' ? old.view : null, source: 'dest' } })
    }
    items = applyOutline(document, buildOutlineApplyPlan(snapshot, items)).snapshot.items
  }
  return { expectedCount: flattenOutline(items).length, retarget: plan?.retarget.map(r => ({ ...r })) ?? [] }
}
export function verifyOutlineAfterLayout(document: PDFDocument, prepared: ReturnType<typeof prepareOutlineForLayout>): void {
  if (!prepared) return
  const snapshot = readOutline(document), items = new Map(flattenOutline(snapshot.items).map(({ item }) => [item.id, item]))
  // A duplicated page is one object listed twice, so compare page objects, not indices.
  const pageNumber = (index: number) => { const page = document.findPage(index); try { return page.asIndirect() } finally { page.destroy() } }
  if (snapshot.itemCount !== prepared.expectedCount || prepared.retarget.some(r => { const t = items.get(r.id)?.target; return t?.kind !== 'page' || pageNumber(t.pageIndex) !== pageNumber(r.cardIndex) })) throw new Error(LOST)
}
export function outlinePagePoint(document: PDFDocument, pageIndex: number, x: number | null, y: number | null, toPdf: boolean): { x: number | null; y: number | null } {
  if (x === null && y === null) return { x: null, y: null }
  const page = document.loadPage(pageIndex)
  try {
    const transform = page.getTransform(), m = toPdf ? mupdf.Matrix.invert(transform) : transform
    const swapped = Math.abs(m[0]) < Math.abs(m[1])
    return { x: (swapped ? y : x) === null ? null : (x ?? 0) * m[0] + (y ?? 0) * m[2] + m[4], y: (swapped ? x : y) === null ? null : (x ?? 0) * m[1] + (y ?? 0) * m[3] + m[5] }
  } finally { page.destroy() }
}
