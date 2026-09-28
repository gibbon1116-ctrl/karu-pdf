import { describe, expect, it, vi } from 'vitest'
import { DocumentSession, DocumentTabsModel, MAX_OPEN_DOCUMENTS } from '../src/app/documentModel'
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

  it('ハンドルはisSameEntry、ハンドルなしは名前とバイト数で重複判定する', async () => {
    const tabs = new DocumentTabsModel()
    const firstHandle = handle('first.pdf', 'same.pdf')
    tabs.add(new DocumentSession({
      docId: 'handled', name: 'first.pdf', byteLength: 20, handle: firstHandle, pageSizes: [],
    }))
    tabs.add(new DocumentSession({
      docId: 'bytes', name: 'memory.pdf', byteLength: 30, handle: null, pageSizes: [],
    }))
    expect((await tabs.findDuplicate({ handle: handle('same.pdf'), name: 'renamed.pdf', byteLength: 999 }))?.docId).toBe('handled')
    expect((await tabs.findDuplicate({ handle: null, name: 'memory.pdf', byteLength: 30 }))?.docId).toBe('bytes')
    expect(await tabs.findDuplicate({ handle: null, name: 'memory.pdf', byteLength: 31 })).toBeNull()
  })
})
