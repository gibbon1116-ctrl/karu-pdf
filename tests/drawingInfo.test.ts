import { DocumentSession } from '../src/app/documentModel'
import type { PdfWorkerPool } from '../src/client/PdfWorkerPool'
import { describe, expect, it, vi } from 'vitest'
import { detectDrawingInfo, reconcileDrawingInfos } from '../src/core/drawingInfo'
import type { ExtractedTextLine } from '../src/core/textExtract'
import { AnnotationStore } from '../src/editor/AnnotationStore'

const row = (text: string, x = 600, y = 900, height = 12): ExtractedTextLine => ({ text, rect: [x, y, x + 200, y + height], line: 1, writingMode: 0, direction: [1, 0] })
const detect = (...lines: ExtractedTextLine[]) => detectDrawingInfo(lines, [0, 0, 1000, 1000])
describe('図面情報の保守的な判定', () => {
  it.each(['E-101', 'E101', 'S-001', 'EM-201', 'E-101-1', 'Ｅ－１０１', 'E — 101'])('番号の表記 %s', value => {
    expect(detect(row(`図面番号 ${value}`)).number).toBe(value.startsWith('Ｅ') || value.includes(' — ') ? 'E-101' : value)
  })
  it.each(['図面\t\r No.', '図面 No.', '図面No.', '図面 No', '図 番', 'DWG. No.', 'DWG.No', 'Drawing No.', 'DrawingNo.'])('空白を正規化した見出し %s', heading => {
    expect(detect(row(`${heading} 001`)).number).toBe('001')
  })
  it('名称見出しのタブ・改行・文字間の空白も正規化する', () => {
    expect(detect(row('図 \t面\r\n 名  称 1階平面図')).name).toBe('1階平面図')
  })
  it.each(['11', '001', '1116', '12345', '1511-1', '電-01', '電気-1', '機-12', '建-001', '構-1', '衛-1', '空-1', '設-1', '電01', 'で-01', 'カ-01', '電-01-1-2', 'E-01-1', 'E-101-1-2'])('見出し付きの番号 %s', value => {
    expect(detect(row(`図面番号 ${value}`)).number).toBe(value)
  })
  it.each(['No.E-101', 'No E-101', '№E-101', '#E-101'])('番号前の記号 %s を除く', value => {
    expect(detect(row(`図面番号 ${value}`)).number).toBe('E-101')
    expect(detect(row('図面番号', 500, 600), row(value, 705, 600)).number).toBe('E-101')
    expect(detect(row(value), row('1階平面図', 600, 930)).number).toBe('E-101')
  })
  it.each(['No.001', 'No001', '№001', '#001'])('数字の接頭記号 %s を除き先頭の0を保つ', value => {
    expect(detect(row(`図面番号 ${value}`)).number).toBe('001')
  })
  it('七ヶ浜町の小さい見出しの右にある大きい番号を読む', () => {
    const label = { ...row('図面\t\r No.'), rect: [1047, 803, 1063, 807] as [number, number, number, number] }
    const number = { ...row('1116'), rect: [1137, 807, 1165, 821] as [number, number, number, number] }
    expect(detectDrawingInfo([label, number], [0, 0, 1190, 842]).number).toBe('1116')
    // No vertical overlap: tolerate the small baseline offset within this field.
    expect(detectDrawingInfo([label, { ...number, rect: [1137, 808, 1165, 822] }], [0, 0, 1190, 842]).number).toBe('1116')
    expect(detectDrawingInfo([label, { ...number, rect: [1137, 820, 1165, 834] }], [0, 0, 1190, 842]).number).toBeUndefined()
    expect(detectDrawingInfo([label, { ...number, rect: [1370, 808, 1398, 822] }], [0, 0, 1500, 842]).number).toBeUndefined()
    const nextField = { ...row('縮尺'), rect: [1090, 803, 1100, 807] as [number, number, number, number] }
    expect(detectDrawingInfo([label, nextField, { ...number, rect: [1137, 808, 1165, 822] }], [0, 0, 1190, 842]).number).toBeUndefined()
    expect(detectDrawingInfo([label, { ...nextField, text: ':' }, number], [0, 0, 1190, 842]).number).toBe('1116')
  })
  it('数字・日本語・多段枝番は見出しの右または直下だけで読む', () => {
    for (const value of ['001', '2500', '8000', '電-01', 'E-101-1-2']) {
      expect(detect(row(value), row('1階平面図', 600, 930)).number).toBeUndefined()
      expect(detect(row('図面番号', 500, 600), row(value, 705, 600)).number).toBe(value)
      expect(detect(row('図面番号', 500, 600), row(value, 500, 625)).number).toBe(value)
      expect(detect(row('図面番号', 500, 600), row(value, 250, 600)).number).toBeUndefined()
      expect(detect(row('図面番号', 500, 600), row(value, 500, 660)).number).toBeUndefined()
      expect(detect(row('図面番号', 500, 600), row('縮尺', 500, 614, 4), row(value, 500, 625)).number).toBeUndefined()
      expect(detect(row('図面番号', 500, 600), row('縮尺', 705, 600), row(value, 910, 600)).number).toBeUndefined()
    }
  })
  it.each(['1', '123456', '電-12345', '電気設-01', 'E-101-1-2-3', '1511-1-2-3', '2500 mm', '2500×8000', 'E-101/E-102', '電-01・電-02', '図面名称 1116'])('部分番号・寸法・複数選択肢 %s を採らない', value => {
    expect(detect(row(`図面番号 ${value}`)).number).toBeUndefined()
  })
  it('日本語の番号を図面名称として採らない', () => {
    expect(detect(row('図面番号 電-01')).name).toBeUndefined()
    expect(detect(row('図面番号', 500, 900), row('電-01', 705, 900)).name).toBeUndefined()
  })
  it('URの縦に並ぶ枝番を1つの番号へ縮めない', () => {
    const label = { ...row('番号'), rect: [653, 536, 664, 563] as [number, number, number, number] }
    const value = { ...row('EF-104-2- B'), rect: [690, 543, 761, 563] as [number, number, number, number] }
    const option = { ...row('A'), rect: [755, 536, 761, 549] as [number, number, number, number] }
    expect(detectDrawingInfo([label, value, option], [0, 0, 842, 595]).number).toBeUndefined()
    expect(detectDrawingInfo([label, value], [0, 0, 842, 595]).number).toBe('EF-104-2-B')
    expect(detectDrawingInfo([label, { ...value, text: 'EF-119-1-A', rect: [677, 538, 751, 558] }, { ...option, text: 'B', rect: [744, 553, 751, 567] }], [0, 0, 842, 595]).number).toBeUndefined()
  })
  it('同じ数字行の重複抽出は別の枝番として除外しない', () => {
    const value = { ...row('001'), rect: [705, 600, 725, 614] as [number, number, number, number] }
    expect(detect(row('図面番号', 500, 600), value, { ...value }).number).toBe('001')
  })
  it('同じ行・右・直下の見出しと名称を読む', () => {
    expect(detect(row('図面番号 E-101'), row('図面名称 1階 電灯設備平面図', 600, 925))).toMatchObject({ number: 'E-101', name: '1階 電灯設備平面図' })
    expect(detect(row('図 番', 500, 600), row('E101', 705, 600), row('図名', 500, 650), row('照明設備平面図', 500, 675))).toMatchObject({ number: 'E101', name: '照明設備平面図' })
  })
  it('見出しなしでも右下・下端と名称語尾を使う', () => {
    expect(detect(row('A-101'), row('1階平面図', 600, 930))).toMatchObject({ number: 'A-101', name: '1階平面図' })
  })
  it('通り芯・機器・弱い候補・見出し自体・注記を採らない', () => {
    expect(detect(row('X1 Y12 E1 A1'), row('図面名称'), row('これは注記。平面図')).number).toBeUndefined()
    expect(detect(row('A-101', 50, 50), row('1階平面図', 50, 80)).name).toBeUndefined()
    expect(detect(row('A-101', 50, 50)).number).toBeUndefined()
    expect(detect(row('図面名称')).name).toBeUndefined()
    expect(detect(row('あ'.repeat(41) + '図')).name).toBeUndefined()
  })
  it('全ページ共通の工事番号を除外する', () => {
    const pages = [101, 102, 103].map(i => detect(row('図面番号 AB-999'), row(`E-${i}`, 600, 940), row("1階設備平面図", 600, 960)))
    expect(reconcileDrawingInfos(pages).map(p => p.number)).toEqual(['E-101', 'E-102', 'E-103'])
  })
  it('多数派の英字と数字桁数に20点を加える', () => {
    const pages = [detect(row('E-101'), row('設備平面図',600,930)), detect(row('E-102'), row('設備平面図',600,930)), detect(row('M-999', 600, 900), row('E-103', 600, 800), row('設備平面図',600,850))]
    expect(reconcileDrawingInfos(pages)[2].number).toBe('E-103')
  })
  it('数字だけの多数派は先頭の0を含む桁数で20点を加える', () => {
    const pages = ['001', '002', '0003'].map(value => detect(row(`図面番号 ${value}`)))
    const reconciled = reconcileDrawingInfos(pages)
    expect(reconciled.map(p => p.number)).toEqual(['001', '002', '0003'])
    expect(reconciled[0].numbers[0].score).toBe(pages[0].numbers[0].score + 20)
    expect(reconciled[0].numbers[0].reasons).toContain('多数派の形式')
    expect(reconciled[2].numbers[0].score).toBe(pages[2].numbers[0].score)
  })
  it('全ページ共通の数字番号も除外し、見出しなしの寸法は多数派で救済しない', () => {
    const pages = [detect(row('図面番号 1116')), detect(row('図面番号 1117')), detect(row('1118'), row('1階平面図', 600, 930))]
    expect(reconcileDrawingInfos(pages).map(p => p.number)).toEqual(['1116', '1117', undefined])
    expect(reconcileDrawingInfos([detect(row('図面番号 001')), detect(row('図面番号 001'))]).map(p => p.number)).toEqual([undefined, undefined])
  })
  it('90度の表示上の右下を使う', () => {
    const lines = [row('E-101', 890, 50), row('1階平面図', 850, 90)]
    expect(detectDrawingInfo(lines, [0, 0, 1000, 1000], 90)).toMatchObject({ number: 'E-101', name: '1階平面図' })
  })
  it('保存待ちの間に自動値が変わってもDirtyにならない', () => {
    const store = new AnnotationStore(); store.loadDrawingInfos([null])
    store.applyAutomaticDrawingInfo(0, { number: 'E-101', name: '初回平面図' })
    store.toEdits(); store.applyAutomaticDrawingInfo(0, { number: 'E-101', name: '再読取平面図' })
    store.markApplied({ created: [] }); expect(store.isDirty()).toBe(false)
    expect(store.toEdits()).toContainEqual({ kind: 'setDrawingInfo', pageIndex: 0, info: { number: 'E-101', name: '再読取平面図', scanned: true } })
  })
  it('自動結果はDirty・Undoを増やさず保存待ちになり、手動値と空欄を守る', () => {
    const store = new AnnotationStore(); store.loadDrawingInfos([null])
    store.applyAutomaticDrawingInfo(0, { number: 'E-101', name: '1階平面図' })
    expect(store.isDirty()).toBe(false); expect(store.canUndo()).toBe(false)
    expect(store.toEdits()).toContainEqual({ kind: 'setDrawingInfo', pageIndex: 0, info: { number: 'E-101', name: '1階平面図', scanned: true } })
    store.setDrawingInfo([0], { ...store.getDrawingInfo(0), name: undefined, nameManual: true })
    expect(store.isDirty()).toBe(true)
    store.applyAutomaticDrawingInfo(0, { number: 'E-102', name: '新名称平面図' })
    expect(store.getDrawingInfo(0)?.name).toBeUndefined()
    store.undo(); expect(store.getDrawingInfo(0)?.name).toBe('新名称平面図'); expect(store.isDirty()).toBe(false)
    store.redo(); expect(store.getDrawingInfo(0)?.nameManual).toBe(true)
  })
})

describe('数量タブから始める文書単位の読取', () => {
  const session = (count = 2) => new DocumentSession({ docId: 'test', name: 'test.pdf', byteLength: 100, handle: null, pageSizes: Array.from({ length: count }, () => ({ width: 1000, height: 1000, rotation: 0 })) })
  const result = (i: number) => ({ type: 'drawingPageResult' as const, requestId: i, detection: detect(row('図面番号 E-' + (101 + i)), row('図面名称 設備平面図', 600, 930)), elapsedMs: 1 })
  it('未読み取りだけ読み、保存済み文書は読まない', async () => {
    const s = session(), drawingPage = vi.fn(async (_docId: string, i: number) => result(i)), pool = { drawingPage } as unknown as PdfWorkerPool
    s.annotationStore.loadDrawingInfos([{ number: 'E-101', scanned: true }, null])
    await s.scanDrawingInfos(pool); expect(drawingPage.mock.calls.map(c => c[1])).toEqual([1]); expect(s.dirty).toBe(false)
    await s.scanDrawingInfos(pool); expect(drawingPage).toHaveBeenCalledTimes(1)
  })
  it('閉じた文書の結果を捨て、次のページを依頼しない', async () => {
    const s = session(); let resolve!: (value: ReturnType<typeof result>) => void
    const drawingPage = vi.fn(() => new Promise<ReturnType<typeof result>>(r => { resolve = r })), pool = { drawingPage } as unknown as PdfWorkerPool
    const task = s.scanDrawingInfos(pool); expect(s.scanDrawingInfos(pool)).toBe(task)
    s.cancelDrawingScan(); resolve(result(0)); await task
    expect(drawingPage).toHaveBeenCalledTimes(1); expect(s.annotationStore.getDrawingInfo(0)).toBeNull()
  })
  it('取得失敗は読み取り済みにせず、再度タブを開けば再試行できる', async () => {
    const s = session(1), drawingPage = vi.fn().mockRejectedValueOnce(new Error('失敗')).mockResolvedValue(result(0)), pool = { drawingPage } as unknown as PdfWorkerPool
    await s.scanDrawingInfos(pool); expect(s.annotationStore.getDrawingInfo(0)?.scanned).not.toBe(true); expect(s.drawingScanStatus).toContain('取得失敗 1')
    await s.scanDrawingInfos(pool); expect(s.annotationStore.getDrawingInfo(0)?.scanned).toBe(true); expect(s.dirty).toBe(false)
  })
  it('読み取りの待機中に手動変更しても、その欄を上書きしない', async () => {
    const s = session(1); let resolve!: (value: ReturnType<typeof result>) => void
    const pool = { drawingPage: () => new Promise<ReturnType<typeof result>>(r => { resolve = r }) } as unknown as PdfWorkerPool
    const task = s.scanDrawingInfos(pool)
    s.annotationStore.setDrawingInfo([0], { name: '手動値', nameManual: true }); resolve(result(0)); await task
    expect(s.annotationStore.getDrawingInfo(0)).toMatchObject({ name: '手動値', nameManual: true, number: 'E-101', scanned: true })
    expect(s.dirty).toBe(true); s.annotationStore.undo(); expect(s.dirty).toBe(false)
  })
})
