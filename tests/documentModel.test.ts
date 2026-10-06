import { describe, expect, it, vi } from 'vitest'
import {
  DocumentSession,
  DocumentTabsModel,
  MAX_INCREMENTAL_GROWTH,
  MAX_OPEN_DOCUMENTS,
  normalizeSidePanelTab,
} from '../src/app/documentModel'
import type { PdfFileHandle } from '../src/editor/fileAccess'

function handle(name: string, sameName?: string): PdfFileHandle {
  return {
    name,
    getFile: vi.fn(),
    createWritable: vi.fn(),
    isSameEntry: vi.fn(async (other) => other.name === (sameName ?? name)),
  } as unknown as PdfFileHandle
}

function session(index: number, fileHandle: PdfFileHandle | null = null) {
  return new DocumentSession({
    docId: `doc-${index}`,
    name: `file-${index}.pdf`,
    byteLength: 100 + index,
    handle: fileHandle,
    pageSizes: [{ width: 100, height: 200 }],
  })
}

describe('DocumentTabsModel', () => {
  it('追加、切り替え、閉じると次のタブの選択を管理する', () => {
    const tabs = new DocumentTabsModel()
    tabs.add(session(1))
    tabs.add(session(2))
    tabs.add(session(3))
    expect(tabs.activeDocId).toBe('doc-3')
    expect(tabs.activate('doc-2')).toBe(true)
    expect(tabs.close('doc-2')?.docId).toBe('doc-2')
    expect(tabs.activeDocId).toBe('doc-3')
    expect(tabs.list().map((item) => item.docId)).toEqual(['doc-1', 'doc-3'])
  })

  it('8つまで追加でき、9つ目を拒否する', () => {
    const tabs = new DocumentTabsModel()
    for (let index = 0; index < MAX_OPEN_DOCUMENTS; index += 1) tabs.add(session(index))
    expect(() => tabs.add(session(9))).toThrow('同時に開けるのは8ファイルまでです')
  })

  it('ハンドルはisSameEntry、ハンドルなしは同名・同容量でも別文書にする', async () => {
    const tabs = new DocumentTabsModel()
    const firstHandle = handle('first.pdf', 'same.pdf')
    tabs.add(new DocumentSession({
      docId: 'handled', name: 'first.pdf', byteLength: 20, handle: firstHandle, pageSizes: [],
    }))
    tabs.add(new DocumentSession({
      docId: 'bytes', name: 'memory.pdf', byteLength: 30, handle: null, pageSizes: [],
    }))
    expect((await tabs.findDuplicate({ handle: handle('same.pdf'), name: 'renamed.pdf', byteLength: 999 }))?.docId).toBe('handled')
    expect(await tabs.findDuplicate({ handle: null, name: 'memory.pdf', byteLength: 30 })).toBeNull()
    expect(await tabs.findDuplicate({ handle: null, name: 'memory.pdf', byteLength: 31 })).toBeNull()
  })
})

describe('DocumentSession の保存量管理', () => {
  it('保存先の名前・サイズ・ハンドルだけを切り替え、文書・編集・履歴・表示を保つ', () => {
    const original = handle('A.pdf'), destination = handle('B.pdf')
    const target = session(1, original)
    const store = target.annotationStore
    const annotation = store.create({ pageIndex: 0, kind: 'square', rect: [10, 20, 50, 60] })
    store.update(annotation.id, { borderWidth: 3 })
    store.undo()
    target.fileOutdated = true
    target.sidePanelTab = 'annotations'
    target.view = { page: 1, zoom: 1.5, scrollLeft: 20, scrollTop: 30 }
    target.viewHistory.remember({ pageIndex: 0, x: 0, y: 0.1, widthRatio: 1, scrolling: false })
    target.recordSave('incremental', 120)
    const view = target.view, pageSizes = target.pageSizes, edits = store.toEdits()
    const saveMode = target.nextSaveMode()

    target.rebindToFile(destination, destination.name!, 130)

    expect({ name: target.name, byteLength: target.byteLength, handle: target.handle })
      .toEqual({ name: 'B.pdf', byteLength: 130, handle: destination })
    expect(target.docId).toBe('doc-1')
    expect(target.annotationStore).toBe(store)
    expect(store.toEdits()).toEqual(edits)
    expect(target.dirty).toBe(true)
    expect(target.fileOutdated).toBe(true)
    expect(target.view).toBe(view)
    expect(target.pageSizes).toBe(pageSizes)
    expect(target.sidePanelTab).toBe('annotations')
    expect(target.viewHistory.canBack).toBe(true)
    expect(target.incrementalSaveCount).toBe(1)
    expect(target.incrementalGrowth).toBe(19)
    expect(target.nextSaveMode()).toBe(saveMode)
    expect(store.canUndo()).toBe(true)
    expect(store.canRedo()).toBe(true)
    store.redo()
    expect(store.get(annotation.id)?.borderWidth).toBe(3)
    store.undo()
    expect(store.toEdits()).toEqual(edits)

    target.rebindToFile(destination, destination.name!, 140)
    expect(target.byteLength).toBe(140)
    expect(target.handle).toBe(destination)
    expect(target.docId).toBe('doc-1')
  })

  it('古いしおりタブの保存値はページへ戻す', () => {
    expect(normalizeSidePanelTab('outline')).toBe('pages')
    expect(normalizeSidePanelTab('search')).toBe('search')
    expect(normalizeSidePanelTab('fixtures')).toBe('fixtures')
    const target = session(1)
    ;(target as unknown as { sidePanelTab: string }).sidePanelTab = 'outline'
    expect(target.sidePanelTab).toBe('pages')
  })

  it('6回の増分保存後は次を全体保存にし、全体保存後に数値を戻す', () => {
    const target = new DocumentSession({
      docId: 'large-save-budget', name: 'large.pdf', byteLength: 10_000_000, handle: null, pageSizes: [],
    })
    for (let index = 1; index <= 5; index += 1) {
      expect(target.nextSaveMode()).toBe('incremental')
      target.recordSave('incremental', 10_000_000 + index * 100)
    }
    expect(target.nextSaveMode()).toBe('incremental')
    target.recordSave('incremental', 10_000_600)
    expect(target.incrementalSaveCount).toBe(6)
    expect(target.nextSaveMode()).toBe('full')

    target.recordSave('full', 200)
    expect(target.incrementalSaveCount).toBe(0)
    expect(target.incrementalGrowth).toBe(0)
    expect(target.nextSaveMode()).toBe('incremental')
  })

  it('増分の増加量が2MBを超えた次を全体保存にする', () => {
    const target = session(1)
    target.recordSave('incremental', 101 + MAX_INCREMENTAL_GROWTH + 1)
    expect(target.nextSaveMode()).toBe('full')
  })
})
