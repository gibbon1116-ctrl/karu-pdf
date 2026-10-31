import mupdf, { type PDFDocument, type PDFObject } from 'mupdf'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as outlineCore from '../src/core/outline'
import * as saving from '../src/core/save'
import type { WorkerRequest, WorkerResponse, OpenResponse, OutlineReadResponse, OutlineAppliedResponse, OutlineLayoutImpactResponse, OutlinePagePointResponse, PageLayoutResponse, ExportBytesResponse } from '../src/worker/protocol'
import { applyOutline, hasOutline, outlinePagePoint, readOutline } from '../src/core/outline'
import { buildOutlineApplyPlan, flattenOutline, indentOutlineItem, moveOutlineItem, updateOutlineItem, type OutlineApplyPlan, type OutlineItem, type OutlinePlanItem, type OutlineViewType } from '../src/core/outlineModel'
import { pdfOperation } from '../src/core/editTransaction'
import { openDocument } from '../src/core/mupdfDoc'
import * as documentOpening from '../src/core/mupdfDoc'
import { saveDocument } from '../src/core/save'
import { protectPdf } from '../src/core/protectedPdf'

const documents: PDFDocument[] = []
afterEach(() => { documents.splice(0).forEach(doc => doc.destroy()) })
function fixture(count = 4): PDFDocument {
  const doc = new mupdf.PDFDocument(); documents.push(doc)
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([10, 20, 410, 620], i === 1 ? 90 : 0, {}, '')
    try { doc.insertPage(-1, page) } finally { page.destroy() }
  }
  return doc
}
function root(doc: PDFDocument): PDFObject { const t = doc.getTrailer(); try { return t.get('Root') } finally { t.destroy() } }
function object<T>(doc: PDFDocument, id: string, fn: (object: PDFObject) => T): T {
  const ref = doc.newIndirect(Number(id.slice(4)))
  try { return fn(ref) } finally { ref.destroy() }
}
function destination(doc: PDFDocument, pageIndex: number, type: OutlineViewType = 'XYZ', params: (number | null)[] = [11, 512, 1.5]): PDFObject {
  const dest = doc.newArray(), page = doc.findPage(pageIndex), name = doc.newName(type)
  try { dest.push(page); dest.push(name); params.forEach(p => dest.push(p)); return dest } catch (e) { dest.destroy(); throw e }
  finally { page.destroy(); name.destroy() }
}
function putString(doc: PDFDocument, obj: PDFObject, key: string, value: string): void {
  const text = doc.newString(value); try { obj.put(key, text) } finally { text.destroy() }
}
function planned(id: string, pageIndex: number | null = 0, children: OutlinePlanItem[] = []): OutlinePlanItem {
  return { id: `new:${id}`, title: `架空の章 ${id}・設備①`, open: children.length > 0, target: pageIndex === null ? { kind: 'none' } : { kind: 'page', pageIndex, view: { type: 'XYZ', params: [11, 512, 1.5] } }, children }
}
function apply(doc: PDFDocument, items: OutlinePlanItem[]) { return pdfOperation(doc, () => applyOutline(doc, { baseRevision: readOutline(doc).revision, items })) }
function reopen(doc: PDFDocument, mode: 'incremental' | 'full', password?: string): PDFDocument {
  const opened = openDocument(saveDocument(doc, mode).bytes, true, password).document.asPDF()!
  documents.push(opened); return opened
}
function targetText(doc: PDFDocument, id: string): string[] {
  return object(doc, id, obj => ['Dest', 'A'].map(key => { const v = obj.get(key); try { return v.toString() } finally { v.destroy() } }))
}

describe('PDF outline direct dictionary editing', () => {
  it.each(['full', 'incremental'] as const)('creates Japanese multilevel outlines and survives %s save, reload and further editing', mode => {
    let doc = fixture()
    if (mode === 'incremental') doc = reopen(doc, 'full')
    const result = apply(doc, [planned('1', 0, [planned('2', 1, [planned('3', null)])]), planned('4', 3)])
    expect(Object.keys(result.idMap)).toHaveLength(4)
    expect(hasOutline(doc)).toBe(true)
    const saved = saveDocument(doc, mode)
    expect(saved.mode).toBe(mode)
    const opened = openDocument(saved.bytes).document.asPDF()!; documents.push(opened)
    expect(readOutline(opened)).toEqual(result.snapshot)
    const before = readOutline(opened), next = updateOutlineItem(before.items, before.items[0].id, { title: '再編集 日本語' })
    const result2 = pdfOperation(opened, () => applyOutline(opened, buildOutlineApplyPlan(before, next)))
    expect(readOutline(reopen(opened, mode))).toEqual(result2.snapshot)
  })
  it('preserves C, F, custom keys, every action, XYZ values and both types of named destinations', () => {
    const doc = fixture(), created = apply(doc, Array.from({ length: 10 }, (_, i) => planned(`${i}`, i % 4)))
    const ids = created.snapshot.items.map(i => i.id)
    pdfOperation(doc, () => {
      const catalog = root(doc), dest = destination(doc, 2), dictionary = doc.newDictionary(), name = doc.newName('架空名'), text = doc.newString('架空文字列'), tree = doc.newDictionary(), names = doc.newArray(), nameRoot = doc.newDictionary()
      try {
        dictionary.put('架空名', dest); catalog.put('Dests', dictionary)
        names.push(text); names.push(dest); tree.put('Names', names); nameRoot.put('Dests', tree); catalog.put('Names', nameRoot)
        ids.forEach((id, i) => object(doc, id, obj => {
          obj.put('C', [0.2, 0.4, 0.6]); obj.put('F', 3); putString(doc, obj, 'KaruTest', '架空の独自値')
          if (i === 6) { obj.put('Dest', name); return }
          if (i === 7) { obj.put('Dest', text); return }
          if (i === 8) return
          obj.delete('Dest')
          const action = doc.newDictionary(), s = doc.newName(['URI', 'Launch', 'JavaScript', 'Named', 'GoTo', 'GoTo', ''][i] || 'GoTo')
          try {
            action.put('S', s)
            if (i === 0) putString(doc, action, 'URI', 'https://example.test/架空')
            if (i === 1) putString(doc, action, 'F', 'fictional-file.txt')
            if (i === 2) putString(doc, action, 'JS', 'void(0);')
            if (i === 3) { const n = doc.newName('NextPage'); try { action.put('N', n) } finally { n.destroy() } }
            if (i === 4 || i === 5 || i === 9) action.put('D', dest)
            if (i === 5) { const next = doc.newDictionary(); try { action.put('Next', next) } finally { next.destroy() } }
            obj.put('A', action)
          } finally { s.destroy(); action.destroy() }
        }))
      } finally { catalog.destroy(); dest.destroy(); dictionary.destroy(); name.destroy(); text.destroy(); tree.destroy(); names.destroy(); nameRoot.destroy() }
    })
    const before = readOutline(doc), targets = new Map(ids.map(id => [id, targetText(doc, id)]))
    expect(before.items.slice(0, 6).map(i => i.target.kind)).toEqual(['external', 'special', 'special', 'special', 'page', 'special'])
    expect(before.items[6].target).toMatchObject({ kind: 'page', source: 'named', name: '架空名', pageIndex: 2 })
    expect(before.items[7].target).toMatchObject({ kind: 'page', source: 'named', name: '架空文字列', pageIndex: 2 })
    let items = updateOutlineItem(before.items, ids[0], { title: '外部の名称変更' })
    items = moveOutlineItem(items, ids[3], { parentId: null, index: 1 })
    items = indentOutlineItem(items, ids[2])
    const result = pdfOperation(doc, () => applyOutline(doc, buildOutlineApplyPlan(before, items)))
    for (const { item } of flattenOutline(result.snapshot.items)) {
      expect(item.style).toEqual(before.items[0].style)
      expect(targetText(doc, item.id)).toEqual(targets.get(item.id))
      object(doc, item.id, obj => { const k = obj.get('KaruTest'); try { expect(k.asString()).toBe('架空の独自値') } finally { k.destroy() } })
    }
    expect(readOutline(reopen(doc, 'full'))).toEqual(result.snapshot)
  })
  it('renames without changing any Dest/A bytes or any other dictionary', () => {
    const doc = fixture(), before = apply(doc, [planned('a'), planned('b'), planned('c'), planned('d')]).snapshot
    const target = targetText(doc, before.items[1].id)
    const others = before.items.filter((_, i) => i !== 1).map(i => object(doc, i.id, obj => { const r = obj.resolve(); try { return r.toString() } finally { r.destroy() } }))
    pdfOperation(doc, () => applyOutline(doc, buildOutlineApplyPlan(before, updateOutlineItem(before.items, before.items[1].id, { title: '名称のみ変更' }))))
    expect(targetText(doc, before.items[1].id)).toEqual(target)
    expect(before.items.filter((_, i) => i !== 1).map(i => object(doc, i.id, obj => { const r = obj.resolve(); try { return r.toString() } finally { r.destroy() } }))).toEqual(others)
  })
  it('writes back blank and untrimmed titles of untouched items unchanged', () => {
    const doc = fixture(), before = apply(doc, [planned('a'), planned('b'), planned('c')]).snapshot
    pdfOperation(doc, () => {
      object(doc, before.items[0].id, obj => obj.delete('Title'))
      object(doc, before.items[1].id, obj => putString(doc, obj, 'Title', '  架空の\n図面  '))
    })
    const stored = readOutline(doc)
    expect(stored.items.map(i => i.title)).toEqual(['', '  架空の\n図面  ', before.items[2].title])
    const titles = stored.items.slice(0, 2).map(i => object(doc, i.id, o => { const r = o.resolve(); try { return r.toString() } finally { r.destroy() } }))
    pdfOperation(doc, () => applyOutline(doc, buildOutlineApplyPlan(stored, updateOutlineItem(stored.items, stored.items[2].id, { title: '架空の改名' }))))
    expect(stored.items.slice(0, 2).map(i => object(doc, i.id, o => { const r = o.resolve(); try { return r.toString() } finally { r.destroy() } }))).toEqual(titles)
    expect(readOutline(doc).items.map(i => i.title)).toEqual(['', '  架空の\n図面  ', '架空の改名'])
    const blank = readOutline(doc)
    expect(() => pdfOperation(doc, () => applyOutline(doc, buildOutlineApplyPlan(blank, updateOutlineItem(blank.items, blank.items[1].id, { title: '   ' }))))).toThrow('目次の名称を入力してください。')
  })
  it('reorders without rewriting dictionaries outside the changed range', () => {
    const doc = fixture(), before = apply(doc, Array.from({ length: 6 }, (_, i) => planned(`${i}`))).snapshot
    const untouched = before.items.slice(4).map(i => object(doc, i.id, o => { const r = o.resolve(); try { return r.toString() } finally { r.destroy() } }))
    pdfOperation(doc, () => applyOutline(doc, buildOutlineApplyPlan(before, moveOutlineItem(before.items, before.items[0].id, { parentId: null, index: 1 }))))
    expect(before.items.slice(4).map(i => object(doc, i.id, o => { const r = o.resolve(); try { return r.toString() } finally { r.destroy() } }))).toEqual(untouched)
  })
  it('rejects stale revisions and malformed plans before changing the PDF', () => {
    const doc = fixture(), before = apply(doc, [planned('a')]).snapshot
    const good = buildOutlineApplyPlan(before, before.items)
    const invalid: OutlineApplyPlan[] = [
      { ...good, baseRevision: 'stale' }, { ...good, items: [good.items[0], good.items[0]] },
      { ...good, items: [{ ...good.items[0], id: 'obj:99999' }] },
      { ...good, items: [{ ...good.items[0], title: ' \n ' }] },
      { ...good, items: [{ ...good.items[0], target: { kind: 'page', pageIndex: 99, view: null } }] },
      { ...good, items: [{ ...good.items[0], id: 'new:x', target: { kind: 'keep' } }] },
    ]
    for (const plan of invalid) {
      expect(() => pdfOperation(doc, () => applyOutline(doc, plan))).toThrow()
      expect(readOutline(doc)).toEqual(before)
    }
  })
  it('refuses cyclic and direct-reference outlines; repairs mild linkage inconsistencies', () => {
    const doc = fixture(), before = apply(doc, [planned('a'), planned('b')]).snapshot
    pdfOperation(doc, () => object(doc, before.items[1].id, o => { const ref = doc.newIndirect(Number(before.items[0].id.slice(4))); try { o.put('Next', ref) } finally { ref.destroy() } }))
    const cyclic = readOutline(doc)
    expect(cyclic.editable).toBe(false)
    expect(() => pdfOperation(doc, () => applyOutline(doc, buildOutlineApplyPlan(cyclic, cyclic.items)))).toThrow('循環')
    pdfOperation(doc, () => object(doc, before.items[1].id, o => { o.delete('Next'); o.delete('Prev') }))
    const mild = readOutline(doc)
    expect(mild.editable).toBe(true); expect(mild.problems).toHaveLength(1)
    expect(pdfOperation(doc, () => applyOutline(doc, buildOutlineApplyPlan(mild, mild.items))).snapshot.problems).toEqual([])
    pdfOperation(doc, () => {
      const r = root(doc), outlines = r.get('Outlines'), direct = doc.newDictionary()
      try { outlines.put('First', direct) } finally { direct.destroy(); outlines.destroy(); r.destroy() }
    })
    expect(readOutline(doc).editable).toBe(false)
  })
  it('removes Root.Outlines when empty while preserving catalog preferences', () => {
    const doc = fixture()
    const r = root(doc), mode = doc.newName('UseOutlines')
    try { r.put('PageMode', mode) } finally { mode.destroy(); r.destroy() }
    apply(doc, [planned('a')]); const before = readOutline(doc)
    pdfOperation(doc, () => applyOutline(doc, { baseRevision: before.revision, items: [] }))
    expect(hasOutline(doc)).toBe(false)
    const catalog = root(doc), pageMode = catalog.get('PageMode')
    try { expect(pageMode.asName()).toBe('UseOutlines') } finally { pageMode.destroy(); catalog.destroy() }
  })
  it('respects editing restrictions through pdfOperation', () => {
    const doc = fixture(), r = root(doc), perms = doc.newDictionary(), mdp = doc.newDictionary()
    try { perms.put('DocMDP', mdp); r.put('Perms', perms) } finally { mdp.destroy(); perms.destroy(); r.destroy() }
    expect(() => apply(doc, [planned('a')])).toThrow('閲覧専用')
    expect(hasOutline(doc)).toBe(false)
  })
  it('edits and saves a password-protected PDF using the existing encryption path', () => {
    const doc = fixture(), encrypted = protectPdf(saveDocument(doc, 'full').bytes, 'Fiction123!')
    const opened = openDocument(encrypted, true, 'Fiction123!').document.asPDF()!; documents.push(opened)
    const result = apply(opened, [planned('保護', 0, [planned('子', 1)])])
    expect(readOutline(reopen(opened, 'incremental', 'Fiction123!'))).toEqual(result.snapshot)
  })
  it('reads integer destinations and unresolved references without losing them on rename', () => {
    const doc = fixture(), before = apply(doc, [planned('a'), planned('b'), planned('c')]).snapshot
    pdfOperation(doc, () => {
      object(doc, before.items[0].id, o => { const d = doc.newArray(), fit = doc.newName('Fit'); try { d.push(2); d.push(fit); o.put('Dest', d) } finally { fit.destroy(); d.destroy() } })
      object(doc, before.items[1].id, o => { const d = doc.newArray(), ref = doc.newIndirect(999999); try { d.push(ref); o.put('Dest', d) } finally { ref.destroy(); d.destroy() } })
      object(doc, before.items[2].id, o => { const d = doc.newString('未定義'); try { o.put('Dest', d) } finally { d.destroy() } })
    })
    const snap = readOutline(doc)
    expect(snap.items[0].target).toMatchObject({ kind: 'page', pageIndex: 2 })
    expect(snap.items[1].target).toMatchObject({ kind: 'broken', reason: '移動先のページが見つかりません' })
    expect(snap.items[2].target.kind).toBe('broken')
    const texts = snap.items.map(i => targetText(doc, i.id))
    pdfOperation(doc, () => applyOutline(doc, buildOutlineApplyPlan(snap, updateOutlineItem(snap.items, snap.items[1].id, { title: '未解決を保持' }))))
    expect(snap.items.map(i => targetText(doc, i.id))).toEqual(texts)
  })
  it('only explicitly replaces locked actions with page destinations', () => {
    const doc = fixture(), created = apply(doc, [planned('a')]).snapshot
    pdfOperation(doc, () => object(doc, created.items[0].id, o => {
      const a = doc.newDictionary(), s = doc.newName('URI'); try { a.put('S', s); putString(doc, a, 'URI', 'https://example.test'); o.delete('Dest'); o.put('A', a) } finally { a.destroy(); s.destroy() }
    }))
    const before = readOutline(doc), plan = buildOutlineApplyPlan(before, before.items)
    expect(() => pdfOperation(doc, () => applyOutline(doc, { ...plan, items: [{ ...plan.items[0], target: { kind: 'none' } }] }))).toThrow()
    const result = pdfOperation(doc, () => applyOutline(doc, { ...plan, items: [{ ...plan.items[0], target: { kind: 'page', pageIndex: 3, view: null } }] }))
    expect(result.snapshot.items[0].target).toMatchObject({ kind: 'page', pageIndex: 3, view: { type: 'Fit', params: [] } })
    expect(targetText(doc, created.items[0].id)[1]).toBe('null')
  })
  it('computes visible descendant Counts with nested closed branches', () => {
    const doc = fixture(), branch = planned('b', 1, [planned('c', 2, [planned('d', 3)])])
    branch.open = false
    const result = apply(doc, [planned('a', 0, [branch, planned('e', 0)])])
    const counts = flattenOutline(result.snapshot.items).map(({ item }) => object(doc, item.id, o => { const c = o.get('Count'); try { return c.isNull() ? null : c.asNumber() } finally { c.destroy() } }))
    expect(counts).toEqual([2, -2, 1, null, null])
    const r = root(doc), count = r.get('Outlines', 'Count')
    try { expect(count.asNumber()).toBe(3) } finally { count.destroy(); r.destroy() }
  })
  it('round-trips fractional XYZ numbers using PDF real precision', () => {
    const doc = fixture(), item = planned('fractional')
    item.target = { kind: 'page', pageIndex: 0, view: { type: 'XYZ', params: [12.3, null, 0.7] } }
    const snapshot = apply(doc, [item]).snapshot
    expect(snapshot.items[0].target).toMatchObject({ view: { type: 'XYZ', params: [Math.fround(12.3), null, Math.fround(0.7)] } })
    expect(readOutline(reopen(doc, 'full'))).toEqual(snapshot)
  })
  it('keeps a dormant non-GoTo action when Dest takes precedence, even when retargeted', () => {
    const doc = fixture(), initial = apply(doc, [planned('a')]).snapshot
    pdfOperation(doc, () => object(doc, initial.items[0].id, o => {
      const action = doc.newDictionary(), s = doc.newName('Launch')
      try { action.put('S', s); putString(doc, action, 'F', 'fictional.txt'); o.put('A', action) } finally { s.destroy(); action.destroy() }
    }))
    const before = readOutline(doc), action = targetText(doc, before.items[0].id)[1]
    expect(before.items[0].target.kind).toBe('page')
    const items = updateOutlineItem(before.items, before.items[0].id, { target: { kind: 'page', pageIndex: 3, view: null, source: 'dest' } })
    pdfOperation(doc, () => applyOutline(doc, buildOutlineApplyPlan(before, items)))
    expect(targetText(doc, before.items[0].id)[1]).toBe(action)
  })
  it('stops reading excessive depths and refuses excessive plan depths and counts before mutation', () => {
    const doc = fixture()
    let deep = planned('bottom')
    for (let i = 0; i < 64; i++) deep = planned(`deep${i}`, 0, [deep])
    expect(() => apply(doc, [deep])).toThrow('階層'); expect(hasOutline(doc)).toBe(false)
    expect(() => apply(doc, Array.from({ length: 10001 }, (_, i) => planned(`count${i}`)))).toThrow('多すぎ')
    expect(hasOutline(doc)).toBe(false)
    const first = apply(doc, [planned('first')]).snapshot.items[0].id
    pdfOperation(doc, () => {
      let parent = doc.newIndirect(Number(first.slice(4)))
      try {
        for (let i = 0; i < 65; i++) {
          const dictionary = doc.newDictionary()
          let child: PDFObject
          try { child = doc.addObject(dictionary) } finally { dictionary.destroy() }
          try { parent.put('First', child); parent.put('Last', child); child.put('Parent', parent); putString(doc, child, 'Title', `架空の深い項目${i}`) }
          catch (error) { child.destroy(); throw error }
          parent.destroy(); parent = child
        }
      } finally { parent.destroy() }
    })
    const limited = readOutline(doc)
    expect(limited.editable).toBe(false); expect(limited.itemCount).toBe(64)
    expect(limited.problems.join()).toContain('階層')
  })
  it('reads and applies 600 items at depth 8 within a generous bound', () => {
    const doc = fixture(), items: OutlinePlanItem[] = []
    for (let i = 0; i < 75; i++) {
      let node = planned(`${i}-7`, 3)
      for (let depth = 6; depth >= 0; depth--) node = planned(`${i}-${depth}`, depth % 4, [node])
      items.push(node)
    }
    apply(doc, items)
    const readStart = performance.now(), baseline = readOutline(doc), readMs = performance.now() - readStart
    const next: OutlineItem[] = updateOutlineItem(baseline.items, baseline.items[0].id, { title: '性能測定の名称変更' })
    const applyStart = performance.now()
    const result = pdfOperation(doc, () => applyOutline(doc, buildOutlineApplyPlan(baseline, next)))
    const applyMs = performance.now() - applyStart
    console.info(`outline 600 items, depth 8: read=${readMs.toFixed(2)}ms apply=${applyMs.toFixed(2)}ms`)
    expect(result.snapshot.itemCount).toBe(600); expect(readMs).toBeLessThan(5000); expect(applyMs).toBeLessThan(5000)
  })
  it.each([0, 1])('round-trips PDF/display coordinates including null axes on page %i', pageIndex => {
    const doc = fixture()
    for (const point of [{ x: 25, y: 93 }, { x: null, y: 93 }, { x: 25, y: null }, { x: null, y: null }]) {
      const display = outlinePagePoint(doc, pageIndex, point.x, point.y, false)
      const back = outlinePagePoint(doc, pageIndex, display.x, display.y, true)
      if (point.x === null) expect(back.x).toBeNull(); else expect(back.x).toBeCloseTo(point.x)
      if (point.y === null) expect(back.y).toBeNull(); else expect(back.y).toBeCloseTo(point.y)
    }
  })
})

describe('outline Worker requests', () => {
  it('uses the real queue for lazy reads, edits, verification, rollback, layout plans and close cancellation', async () => {
    let sequence = 0
    const pending = new Map<number, { resolve: (response: WorkerResponse) => void; reject: (error: Error) => void }>()
    const scope = {
      location: new URL('https://example.test/pdf.worker.js'), fetch: vi.fn(), addEventListener: vi.fn(),
      onmessage: null as ((event: MessageEvent<WorkerRequest>) => void) | null,
      postMessage: (message: WorkerResponse) => {
        if (!('requestId' in message) || message.requestId === undefined) return
        const waiter = pending.get(message.requestId)
        pending.delete(message.requestId)
        if (message.type === 'error') waiter?.reject(new Error(message.message))
        else waiter?.resolve(message)
      },
    }
    class TestChannel {
      port1 = { onmessage: null as (() => void) | null }
      port2 = { postMessage: () => { queueMicrotask(() => this.port1.onmessage?.()) } }
    }
    const send = <T extends WorkerResponse>(request: Record<string, unknown>): Promise<T> => {
      const requestId = ++sequence
      const promise = new Promise<WorkerResponse>((resolve, reject) => pending.set(requestId, { resolve, reject }))
      scope.onmessage!({ data: { ...request, requestId } } as MessageEvent<WorkerRequest>)
      return promise as Promise<T>
    }
    vi.stubGlobal('self', scope); vi.stubGlobal('MessageChannel', TestChannel)
    const realRead = outlineCore.readOutline
    const readSpy = vi.spyOn(outlineCore, 'readOutline')
    const realOpen = documentOpening.openDocument, repaired: boolean[] = []
    vi.spyOn(documentOpening, 'openDocument').mockImplementation((...args) => {
      const opened = realOpen(...args); repaired.push(opened.document.asPDF()!.wasRepaired()); return opened
    })
    try {
      await import('../src/worker/pdf.worker')
      const bytes = saveDocument(fixture(), 'full').bytes
      const opened = await send<OpenResponse>({ type: 'open', docId: 'worker', bytes: bytes.buffer })
      expect(opened.pageCount).toBe(4); expect(readSpy).not.toHaveBeenCalled()
      const empty = await send<OutlineReadResponse>({ type: 'getOutline', docId: 'worker' })
      const first = await send<OutlineAppliedResponse>({ type: 'applyOutline', docId: 'worker', plan: { baseRevision: empty.snapshot.revision, items: [planned('worker', 1)] } })
      expect(first.result.snapshot.itemCount).toBe(1); expect(first.canUndoOrganize).toBe(false)
      let baseline = first.result.snapshot
      for (let i = 0; i < 2; i++) {
        const result = await send<OutlineAppliedResponse>({ type: 'applyOutline', docId: 'worker', plan: buildOutlineApplyPlan(baseline, updateOutlineItem(baseline.items, baseline.items[0].id, { title: `Worker再編集${i}` })) })
        baseline = result.result.snapshot
      }
      const exported = await send<ExportBytesResponse>({ type: 'exportBytes', docId: 'worker' })
      const checked = openDocument(new Uint8Array(exported.bytes)).document.asPDF()!; documents.push(checked)
      expect(readOutline(checked)).toEqual(baseline)
      const impact = await send<OutlineLayoutImpactResponse>({ type: 'outlineLayoutImpact', docId: 'worker', cards: [{ id: 'page-1', source: { kind: 'page', docId: 'worker', pageIndex: 0 }, rotation: 0 }] })
      expect(impact.impact.removed).toHaveLength(1)
      const point = await send<OutlinePagePointResponse>({ type: 'outlinePagePoint', docId: 'worker', pageIndex: 0, x: 10, y: 20, toPdf: false })
      expect(point.x).toBe(0); expect(point.y).toBe(600)
      const saved = saving.saveDocument(fixture(), 'full')
      const saveSpy = vi.spyOn(saving, 'saveDocument').mockReturnValueOnce(saved)
      await expect(send({ type: 'applyOutline', docId: 'worker', plan: buildOutlineApplyPlan(baseline, updateOutlineItem(baseline.items, baseline.items[0].id, { title: '検証失敗で戻す' })) })).rejects.toThrow('目次を反映した結果を確認できませんでした。')
      saveSpy.mockRestore()
      expect((await send<OutlineReadResponse>({ type: 'getOutline', docId: 'worker' })).snapshot).toEqual(baseline)
      // Fail verification after a real incremental write, then retry on the same
      // Worker. Undo must restore a baseline that is also safe to save again.
      readSpy.mockImplementationOnce(doc => ({ ...realRead(doc), revision: 'simulated-mismatch' }))
      await expect(send({ type: 'applyOutline', docId: 'worker', plan: buildOutlineApplyPlan(baseline, updateOutlineItem(baseline.items, baseline.items[0].id, { title: '実保存の検証失敗' })) })).rejects.toThrow('目次を反映した結果を確認できませんでした。')
      expect((await send<OutlineReadResponse>({ type: 'getOutline', docId: 'worker' })).snapshot).toEqual(baseline)
      baseline = (await send<OutlineAppliedResponse>({ type: 'applyOutline', docId: 'worker', plan: buildOutlineApplyPlan(baseline, updateOutlineItem(baseline.items, baseline.items[0].id, { title: '検証失敗後の再試行' })) })).result.snapshot
      const layout = [0, 2, 3].map(pageIndex => ({ id: `page-${pageIndex + 1}`, source: { kind: 'page', docId: 'worker', pageIndex }, rotation: 0 }))
      await send<PageLayoutResponse>({ type: 'applyPageLayout', docId: 'worker', cards: layout, sources: [], outlinePlan: { baseRevision: baseline.revision, remove: [], retarget: [{ id: baseline.items[0].id, cardIndex: 0 }] } })
      baseline = (await send<OutlineReadResponse>({ type: 'getOutline', docId: 'worker' })).snapshot
      expect(baseline.items[0].target).toMatchObject({ kind: 'page', pageIndex: 0 })
      await send<OutlineAppliedResponse>({ type: 'applyOutline', docId: 'worker', plan: buildOutlineApplyPlan(baseline, updateOutlineItem(baseline.items, baseline.items[0].id, { title: 'バックアップ後の変更' })) })
      await expect(send({ type: 'undoPageLayout', docId: 'worker' })).rejects.toThrow()
      const queued = send({ type: 'getOutline', docId: 'worker' })
      const rejection = expect(queued).rejects.toThrow()
      scope.onmessage!({ data: { type: 'close', docId: 'worker' } } as MessageEvent<WorkerRequest>)
      await rejection
      expect(repaired).not.toContain(true)
    } finally {
      scope.onmessage?.({ data: { type: 'dispose' } } as unknown as MessageEvent<WorkerRequest>)
      vi.restoreAllMocks(); vi.unstubAllGlobals()
    }
  })
})
