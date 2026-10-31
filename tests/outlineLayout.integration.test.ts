import mupdf, { type PDFDocument } from 'mupdf'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyPageLayout, extractPages, type PageLayoutCard } from '../src/core/pageOps'
import { applyOutline, hasOutline, outlineLayoutImpact, prepareOutlineForLayout, readOutline, verifyOutlineAfterLayout } from '../src/core/outline'
import { flattenOutline, type OutlineLayoutPlan } from '../src/core/outlineModel'
import { applyAndSaveAtomically, pdfOperation } from '../src/core/editTransaction'
import * as saving from '../src/core/save'
import * as opening from '../src/core/mupdfDoc'

const documents: PDFDocument[] = []
afterEach(() => { vi.restoreAllMocks(); documents.splice(0).forEach(doc => doc.destroy()) })
function fixture(count = 4): PDFDocument {
  const doc = new mupdf.PDFDocument(); documents.push(doc)
  for (let i = 0; i < count; i++) {
    const p = doc.addPage([0, 0, 200 + i * 10, 400], 0, {}, '')
    try { doc.insertPage(-1, p) } finally { p.destroy() }
  }
  return doc
}
function cards(indices: number[], docId = 'target'): PageLayoutCard[] {
  return indices.map(pageIndex => ({ id: `page-${pageIndex + 1}`, source: { kind: 'page', docId, pageIndex }, rotation: 0 }))
}
function setup(doc: PDFDocument, withChildren = false) {
  return pdfOperation(doc, () => applyOutline(doc, { baseRevision: readOutline(doc).revision, items: [
    { id: 'new:a', title: '架空の親', open: withChildren, target: { kind: 'page', pageIndex: 1, view: { type: 'XYZ', params: [null, 350, 2] } }, children: withChildren ? [{ id: 'new:child', title: '架空の子', open: false, target: { kind: 'page', pageIndex: 2, view: null }, children: [] }] : [] },
    { id: 'new:b', title: '架空の末尾', open: false, target: { kind: 'page', pageIndex: 3, view: null }, children: [] },
  ] })).snapshot
}
function widths(doc: PDFDocument) {
  return Array.from({ length: doc.countPages() }, (_, i) => { const p = doc.loadPage(i); try { const b = p.getBounds(); return b[2] - b[0] } finally { p.destroy() } })
}
function pageTargets(doc: PDFDocument) { return flattenOutline(readOutline(doc).items).map(({ item }) => item.target.kind === 'page' ? item.target.pageIndex : null) }
function rootText(doc: PDFDocument): string {
  const trailer = doc.getTrailer(), root = trailer.get('Root'), resolved = root.resolve()
  try { return resolved.toString() } finally { resolved.destroy(); root.destroy(); trailer.destroy() }
}
function apply(doc: PDFDocument, layout: PageLayoutCard[], plan?: OutlineLayoutPlan, sources = new Map<string, PDFDocument>()) {
  pdfOperation(doc, () => applyPageLayout('target', doc, layout, sources, plan))
}

describe('outline and page layout integration', () => {
  it('retains page order/count behavior without creating outlines in a PDF without outlines', () => {
    const doc = fixture(), layout = cards([3, 1, 0, 1])
    expect(outlineLayoutImpact('target', doc, layout)).toMatchObject({ hasOutline: false, removed: [], duplicated: [] })
    apply(doc, layout)
    expect(widths(doc)).toEqual([230, 210, 200, 210]); expect(hasOutline(doc)).toBe(false)
    expect(prepareOutlineForLayout(doc, layout, [0, 1, 2, 3], undefined, 'target')).toBeNull()
  })
  it('follows page references on reorder, without changing item ids', () => {
    const doc = fixture(), before = setup(doc, true)
    apply(doc, cards([3, 2, 0, 1]))
    expect(pageTargets(doc)).toEqual([3, 1, 0])
    expect(flattenOutline(readOutline(doc).items).map(r => r.item.id)).toEqual(flattenOutline(before.items).map(r => r.item.id))
  })
  it('adds blanks and foreign pages without shifting targets or importing foreign outlines', () => {
    const doc = fixture(), source = fixture(); setup(doc); setup(source, true)
    apply(doc, [
      { id: 'blank', source: { kind: 'blank', width: 300, height: 500 }, rotation: 0 },
      ...cards([3], 'source'), ...cards([0, 1, 2, 3]),
    ], undefined, new Map([['source', source]]))
    expect(widths(doc)).toEqual([300, 230, 200, 210, 220, 230])
    expect(pageTargets(doc)).toEqual([3, 5]); expect(readOutline(doc).itemCount).toBe(2)
  })
  it('reports removed items with ancestor paths and rolls back all additions when no plan is provided', () => {
    const doc = fixture(), before = setup(doc, true), layout = cards([0, 3])
    const impact = outlineLayoutImpact('target', doc, layout)
    expect(impact.removed).toEqual([
      { id: before.items[0].id, title: '架空の親', pageIndex: 1, path: [], hasChildren: true },
      { id: before.items[0].children[0].id, title: '架空の子', pageIndex: 2, path: ['架空の親'], hasChildren: false },
    ])
    const rootBefore = rootText(doc), pagesBefore = widths(doc)
    expect(() => apply(doc, [{ id: 'blank', source: { kind: 'blank', width: 300, height: 500 }, rotation: 0 }, ...layout])).toThrow('目次の扱いを選んで')
    expect(readOutline(doc)).toEqual(before); expect(widths(doc)).toEqual(pagesBefore); expect(rootText(doc)).toBe(rootBefore)
  })
  it('removes the selected item while promoting its children', () => {
    const doc = fixture(), before = setup(doc, true)
    apply(doc, cards([0, 2, 3]), { baseRevision: before.revision, remove: [before.items[0].id], retarget: [] })
    const after = readOutline(doc)
    expect(after.items.map(i => i.title)).toEqual(['架空の子', '架空の末尾'])
    expect(pageTargets(doc)).toEqual([1, 2])
  })
  it.each(['existing', 'blank', 'foreign'] as const)('retargets a removed page to an %s card, retaining view coordinates', kind => {
    const doc = fixture(), source = fixture(), before = setup(doc)
    const layout = cards([0, 2, 3])
    if (kind === 'blank') layout.unshift({ id: 'blank', source: { kind: 'blank', width: 333, height: 500 }, rotation: 0 })
    if (kind === 'foreign') { setup(source); layout.unshift(...cards([2], 'source')) }
    apply(doc, layout, { baseRevision: before.revision, remove: [], retarget: [{ id: before.items[0].id, cardIndex: 0 }] }, new Map([['source', source]]))
    expect(pageTargets(doc)).toEqual([0, layout.length - 1])
    expect(readOutline(doc).items[0].target).toMatchObject({ view: { type: 'XYZ', params: [null, 350, 2] } })
    expect(readOutline(doc).itemCount).toBe(2)
  })
  it('accepts a retarget to the later copy of a duplicated page', () => {
    const doc = fixture(), before = setup(doc)
    // Page 2 is deleted; its bookmark goes to the second listing of page 1.
    const layout = cards([0, 2, 0, 3]); layout[2].id = 'copy-of-page-1'
    apply(doc, layout, { baseRevision: before.revision, remove: [], retarget: [{ id: before.items[0].id, cardIndex: 2 }] })
    expect(readOutline(doc).itemCount).toBe(2)
    expect(pageTargets(doc)).toEqual([0, 3])
  })
  it('requires a separate choice for each removed descendant', () => {
    const doc = fixture(), before = setup(doc, true)
    expect(() => apply(doc, cards([0, 3]), { baseRevision: before.revision, remove: [before.items[0].id], retarget: [] })).toThrow('目次の扱いを選んで')
    expect(readOutline(doc)).toEqual(before)
    apply(doc, cards([0, 3]), { baseRevision: before.revision, remove: [before.items[0].id], retarget: [{ id: before.items[0].children[0].id, cardIndex: 0 }] })
    expect(pageTargets(doc)).toEqual([0, 1])
  })
  it('reports duplicate positions and chooses the first page reference after duplication', () => {
    const doc = fixture(), before = setup(doc), layout = cards([1, 0, 1, 2, 3])
    layout[0].id = 'copy-first'
    const impact = outlineLayoutImpact('target', doc, layout)
    expect(impact.duplicated).toEqual([{ id: before.items[0].id, title: '架空の親', pageIndex: 1, newPositions: [0, 2], originalFirst: false }])
    const originalFirst = cards([1, 0, 1, 2, 3])
    expect(outlineLayoutImpact('target', doc, originalFirst).duplicated[0].originalFirst).toBe(true)
    apply(doc, layout); expect(pageTargets(doc)).toEqual([0, 4])
    const reopened = opening.openDocument(saving.saveDocument(doc, 'full').bytes).document.asPDF()!; documents.push(reopened)
    expect(pageTargets(reopened)).toEqual([0, 4])
  })
  it('rejects stale revisions, duplicate choices, unknown items and invalid card indices atomically', () => {
    const doc = fixture(), before = setup(doc), id = before.items[0].id
    const bad: OutlineLayoutPlan[] = [
      { baseRevision: 'old', remove: [id], retarget: [] },
      { baseRevision: before.revision, remove: [id], retarget: [{ id, cardIndex: 0 }] },
      { baseRevision: before.revision, remove: ['obj:99999'], retarget: [{ id, cardIndex: 0 }] },
      { baseRevision: before.revision, remove: [], retarget: [{ id, cardIndex: 99 }] },
    ]
    for (const plan of bad) { expect(() => apply(doc, cards([0, 2, 3]), plan)).toThrow(); expect(readOutline(doc)).toEqual(before) }
  })
  it('blocks deletion in a cyclic outline and rolls back', () => {
    const doc = fixture(), before = setup(doc), ref = doc.newIndirect(Number(before.items[1].id.slice(4))), first = doc.newIndirect(Number(before.items[0].id.slice(4)))
    try { pdfOperation(doc, () => ref.put('Next', first)) } finally { ref.destroy(); first.destroy() }
    const cyclic = readOutline(doc)
    expect(() => apply(doc, cards([0, 2, 3]))).toThrow('目次の構造が読み取れない')
    expect(readOutline(doc)).toEqual(cyclic); expect(doc.countPages()).toBe(4)
  })
  it('detects item loss and incorrect retargeting after layout', () => {
    const doc = fixture(), before = setup(doc)
    expect(() => verifyOutlineAfterLayout(doc, { expectedCount: 3, retarget: [] })).toThrow('項目が失われる')
    expect(() => verifyOutlineAfterLayout(doc, { expectedCount: 2, retarget: [{ id: before.items[0].id, cardIndex: 0 }] })).toThrow('項目が失われる')
  })
  it('saves atomically with outline equality and detects corrupted saved output with rollback', () => {
    const doc = fixture(), before = setup(doc)
    const result = applyAndSaveAtomically(doc, [], {}, 'full')
    try { expect(readOutline(result.opened.document.asPDF()!)).toEqual(before) } finally { result.opened.document.destroy() }
    const unrelated = fixture(), wrongBytes = saving.saveDocument(unrelated, 'full').bytes
    vi.spyOn(saving, 'saveDocument').mockReturnValue({ bytes: wrongBytes, mode: 'full', ms: 0 })
    expect(() => applyAndSaveAtomically(doc, [{ kind: 'setDrawingInfo', pageIndex: 0, info: { number: '架空番号', name: '架空名称' } }], {}, 'full')).toThrow('保存後の目次が保存前と一致しません。')
    expect(readOutline(doc)).toEqual(before)
    const page = doc.findPage(0), drawing = page.get('KaruDrawing')
    try { expect(drawing.isNull()).toBe(true) } finally { drawing.destroy(); page.destroy() }
  })
  it('does not scan outlines on the no-outline save path and extraction does not carry outlines', () => {
    const doc = fixture(), count = vi.spyOn(doc, 'findPage')
    const saved = applyAndSaveAtomically(doc, [], {}, 'full')
    try { expect(count).not.toHaveBeenCalled() } finally { saved.opened.document.destroy() }
    count.mockRestore(); setup(doc)
    const bytes = extractPages('target', doc, cards([1, 3]), new Map()), extracted = opening.openDocument(bytes).document.asPDF()!; documents.push(extracted)
    expect(extracted.countPages()).toBe(2); expect(hasOutline(extracted)).toBe(false)
  })
})
