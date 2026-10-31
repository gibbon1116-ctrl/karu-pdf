import { describe, expect, it, vi } from 'vitest'
import { OutlineDraft } from '../src/app/OutlineDraft'
import { DocumentSession, normalizeSidePanelTab } from '../src/app/documentModel'
import { flattenOutline, remapOutlineIds, type OutlineItem, type OutlineSnapshot, type OutlineTarget } from '../src/core/outlineModel'
import { PdfWorkerPool } from '../src/client/PdfWorkerPool'
import type { WorkerRequest, WorkerResponse } from '../src/worker/protocol'

vi.mock('../src/client/createPdfWorker', () => ({ createPdfWorker: () => new Worker('test-worker') }))

function base(): OutlineSnapshot { return { items: [], revision: 'empty', editable: true, problems: [], itemCount: 0 } }
const none: OutlineTarget = { kind: 'none' }
const all = (draft: OutlineDraft) => flattenOutline([...draft.getItems()]).map(r => r.item)
describe('OutlineDraft', () => {
  it('adds at all positions with defaults and notifies subscribers', () => {
    const draft = new OutlineDraft(base()), notify = vi.fn(), stop = draft.subscribe(notify)
    const a = draft.add({ kind: 'end' }, { target: none })
    const b = draft.add({ kind: 'before', id: a }, { title: '前', target: none })
    const c = draft.add({ kind: 'after', id: a }, { title: '後', target: none })
    const d = draft.add({ kind: 'child', id: a }, { title: '子', target: none })
    expect(all(draft).map(i => i.id)).toEqual([b, a, d, c])
    expect(all(draft)[1]).toMatchObject({ title: '新しい目次', open: false, style: { bold: false, italic: false, color: null } })
    expect(notify).toHaveBeenCalledTimes(4); expect(draft.getSnapshot()).toBe(4)
    stop(); draft.rename(a, '日本語・①'); expect(notify).toHaveBeenCalledTimes(4)
  })
  it('normalizes renames and leaves state and history intact after exceptions', () => {
    const draft = new OutlineDraft(base()), id = draft.add({ kind: 'end' }, { target: none })
    draft.rename(id, ' 日本語\n名称・① ')
    expect(all(draft)[0].title).toBe('日本語 名称・①')
    const before = structuredClone(draft.getItems()), version = draft.getSnapshot()
    expect(() => draft.rename(id, ' \t ')).toThrow()
    expect(() => draft.add({ kind: 'before', id: 'missing' }, { target: none })).toThrow()
    expect(() => draft.move(id, { parentId: id, index: 0 })).toThrow()
    expect(draft.getItems()).toEqual(before); expect(draft.getSnapshot()).toBe(version)
    draft.undo(); expect(all(draft)[0].title).toBe('新しい目次')
  })
  it.each(['external', 'special'] as const)('requires explicit replacement of %s targets', kind => {
    const draft = new OutlineDraft(base()), target: OutlineTarget = kind === 'external' ? { kind, uri: 'https://example.test' } : { kind, action: 'Launch' }
    const id = draft.add({ kind: 'end' }, { target }), version = draft.getSnapshot()
    expect(() => draft.setTarget(id, none)).toThrow('外部リンクや特殊な移動先を持つ目次は、移動先を変更できません。')
    expect(draft.getSnapshot()).toBe(version)
    draft.setTarget(id, { kind: 'page', pageIndex: 0, source: 'dest', view: null }, { replaceLocked: true })
    draft.undo(); expect(all(draft)[0].target).toEqual(target)
  })
  it('keeps no-op commands out of history, including after undo', () => {
    const draft = new OutlineDraft(base()), id = draft.add({ kind: 'end' }, { target: none })
    const version = draft.getSnapshot()
    draft.moveUp(id); draft.moveDown(id); draft.indent(id); draft.outdent(id)
    draft.rename(id, '新しい目次'); draft.setOpen(id, false); draft.setTarget(id, none)
    draft.move(id, { parentId: null, index: 0 }); draft.append([])
    expect(draft.getSnapshot()).toBe(version)
    draft.undo(); expect(draft.isChanged()).toBe(false); expect(draft.canUndo()).toBe(false)
    draft.moveUp(id); expect(draft.canRedo()).toBe(true)
    draft.redo(); expect(draft.getItems()).toHaveLength(1)
  })
  it('moves siblings, indents, outdents and preserves children when removing', () => {
    const draft = new OutlineDraft(base()), a = draft.add({ kind: 'end' }, { target: none }), b = draft.add({ kind: 'end' }, { target: none })
    const c = draft.add({ kind: 'child', id: b }, { target: none })
    draft.moveUp(b); expect(draft.getItems()[0].id).toBe(b)
    draft.moveDown(b); draft.indent(b); expect(draft.getItems()[0].children[0].id).toBe(b)
    draft.outdent(b); expect(draft.getItems()[1].id).toBe(b)
    draft.remove(b, 'keepChildren'); expect(all(draft).map(i => i.id)).toEqual([a, c])
    draft.undo(); draft.remove(b, 'withChildren'); expect(all(draft).map(i => i.id)).toEqual([a])
  })
  it('treats append, replaceAll and discard as single undo steps', () => {
    const draft = new OutlineDraft(base()), source = new OutlineDraft(base())
    source.add({ kind: 'end' }, { target: none }); source.add({ kind: 'end' }, { target: none })
    draft.append([...source.getItems()]); draft.undo(); expect(draft.getItems()).toEqual([])
    draft.redo(); draft.replaceAll([]); draft.undo(); expect(draft.getItems()).toHaveLength(2)
    draft.discard(); expect(draft.isChanged()).toBe(false)
    draft.undo(); expect(draft.getItems()).toHaveLength(2)
  })
  it('remaps ids throughout undo and redo on rebase and uses the saved baseline', () => {
    const draft = new OutlineDraft(base()), a = draft.add({ kind: 'end' }, { target: none }), b = draft.add({ kind: 'child', id: a }, { target: none })
    draft.rename(a, '名称変更'); draft.setOpen(a, true); draft.undo()
    const idMap = { [a]: 'obj:10', [b]: 'obj:11' }
    const saved: OutlineSnapshot = { ...base(), revision: 'saved', items: remapOutlineIds([...draft.getItems()], idMap), itemCount: 2 }
    draft.rebase(saved, idMap)
    expect(draft.getItems()).toEqual(saved.items); expect(draft.isChanged()).toBe(false)
    draft.redo(); expect(all(draft).map(i => i.id)).toEqual(['obj:10', 'obj:11'])
    draft.undo(); draft.undo(); expect(all(draft)[0].title).toBe('新しい目次')
    expect(all(draft).every(i => i.id.startsWith('obj:'))).toBe(true)
    expect(draft.toPlan().baseRevision).toBe('saved')
  })
  it('limits undo history to 100 and allocates ids monotonically across undo', () => {
    const draft = new OutlineDraft(base()), id = draft.add({ kind: 'end' }, { target: none })
    for (let i = 0; i < 105; i++) draft.rename(id, `名称${i}`)
    let n = 0
    while (draft.canUndo()) { draft.undo(); n++ }
    expect(n).toBe(100)
    const id2 = draft.add({ kind: 'end' }, { target: none }); draft.undo()
    expect(draft.add({ kind: 'end' }, { target: none })).not.toBe(id2)
  })
  it('does not retain mutable inputs', () => {
    const draft = new OutlineDraft(base()), source = new OutlineDraft(base())
    source.add({ kind: 'end' }, { target: none })
    const items = structuredClone(source.getItems()) as OutlineItem[]
    draft.append(items); items[0].title = '外から変更'
    expect(draft.getItems()[0].title).toBe('新しい目次')
  })
})

describe('document outline state', () => {
  it('is lazy, reports applied changes, and invalidates only the draft after layout', () => {
    const session = new DocumentSession({ docId: 'test', name: '架空.pdf', byteLength: 100, handle: null, pageSizes: [{ width: 100, height: 100 }] })
    expect(normalizeSidePanelTab('outline')).toBe('outline'); expect(session.outlineDraft).toBeNull()
    expect(session.hasPendingOutlineDraft()).toBe(false)
    session.outlineDraft = new OutlineDraft(base()); session.outlineDraft.add({ kind: 'end' }, { target: none })
    expect(session.hasPendingOutlineDraft()).toBe(true)
    session.outlineChanged = true; expect(session.dirty).toBe(false); expect(session.dirtyDescription()).toContain('目次')
    session.updateAfterPageLayout(session.pageSizes, false)
    expect(session.outlineDraft).toBeNull(); expect(session.outlineChanged).toBe(true)
  })
})

describe('outline Worker pool routing', () => {
  it('sends all four outline requests to Worker 0 without reloading display Workers and forwards layout plans', async () => {
    const workers: TestWorker[] = []
    class TestWorker {
      calls: WorkerRequest[] = []
      onmessage: ((event: { data: WorkerResponse }) => void) | null = null
      terminate = vi.fn()
      constructor() { workers.push(this); queueMicrotask(() => this.receive({ type: 'ready' })) }
      receive(data: WorkerResponse) { this.onmessage?.({ data }) }
      postMessage(message: WorkerRequest) {
        this.calls.push(message)
        queueMicrotask(() => {
          if (message.type === 'open') this.receive({ type: 'opened', requestId: message.requestId, pageCount: 1, pageSizes: [{ width: 100, height: 100 }], openMs: 0, sizesMs: 0 })
          if (message.type === 'exportBytes') this.receive({ type: 'bytesExported', requestId: message.requestId, bytes: new ArrayBuffer(1) })
          if (message.type === 'getOutline') this.receive({ type: 'outlineRead', requestId: message.requestId, snapshot: base() })
          if (message.type === 'applyOutline') this.receive({ type: 'outlineApplied', requestId: message.requestId, result: { snapshot: base(), idMap: {} }, ms: 1, canUndoOrganize: false })
          if (message.type === 'outlineLayoutImpact') this.receive({ type: 'outlineLayoutImpactResult', requestId: message.requestId, impact: { hasOutline: false, editable: true, problems: [], revision: 'empty', removed: [], duplicated: [] } })
          if (message.type === 'outlinePagePoint') this.receive({ type: 'outlinePagePointResult', requestId: message.requestId, x: message.x, y: message.y })
          if (message.type === 'applyPageLayout') this.receive({ type: 'pageLayoutApplied', requestId: message.requestId, bytes: new ArrayBuffer(1), pageCount: 1, pageSizes: [{ width: 100, height: 100 }], hasBackup: false, timings: { backupMs: 0, assembleMs: 0, exportMs: 0, primaryReloadMs: 0, pageMetadataMs: 0, workerTotalMs: 0 } })
        })
      }
    }
    vi.stubGlobal('Worker', TestWorker)
    const pool = new PdfWorkerPool(3)
    try {
      await pool.open('target', new ArrayBuffer(1)); await pool.ensureRenderDocument('target')
      workers.forEach(worker => { worker.calls = [] })
      expect(await pool.getOutline('target')).toEqual(base())
      expect((await pool.applyOutline('target', { baseRevision: 'empty', items: [] })).canUndoOrganize).toBe(false)
      expect((await pool.outlineLayoutImpact('target', [])).hasOutline).toBe(false)
      expect(await pool.outlinePagePoint('target', 0, null, 50, true)).toEqual({ x: null, y: 50 })
      expect(workers[0].calls.map(c => c.type)).toEqual(['getOutline', 'applyOutline', 'outlineLayoutImpact', 'outlinePagePoint'])
      expect(workers.slice(1).flatMap(w => w.calls)).toEqual([])
      const plan = { baseRevision: 'empty', remove: [], retarget: [] }
      await pool.applyPageLayout('target', [], [], plan)
      expect(workers[0].calls.find(c => c.type === 'applyPageLayout')).toMatchObject({ outlinePlan: plan })
    } finally { pool.destroy(); vi.unstubAllGlobals() }
  })
})
