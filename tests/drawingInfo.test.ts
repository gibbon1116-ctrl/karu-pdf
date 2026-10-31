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
  it('実図面の小さい見出しの右にある大きい番号を読む', () => {
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

describe('上下に広がる名称欄と均等割りの文字 (SPEC-O5b)', () => {
  const box = (text: string, rect: ExtractedTextLine['rect']): ExtractedTextLine => ({ ...row(text), rect })
  const read = (...lines: ExtractedTextLine[]) => detectDrawingInfo(lines, [0, 0, 1191, 842])
  const heading = box('図面名称', [933, 810, 948, 813])
  const project = [box('工事名称', [933, 793, 948, 796]), box('そら色交流棟整備工事', [961, 792, 1049, 798])]
  const adjacent = [box('縮尺', [1108, 805, 1115, 808]), box('設計年月日', [1139, 805, 1158, 808])]
  const stacked = (upper: string, lower: string) => [
    ...project, heading, ...adjacent,
    box(upper, [961, 805, 1075, 810]), box(lower, [961, 814, 1091, 819]),
  ]
  const letters = (text: string, xs: number[]) => [...text].map((char, i) => box(char, [xs[i], 801, xs[i] + 4, 806]))

  it('Aと同じ均等割りの5文字を1語にし、工事名称や右の欄を混ぜない', () => {
    const result = read(
      box('工事名称', [914, 785, 932, 788]), box('そら色交流棟整備工事', [938, 783, 1026, 789]),
      box('図面番号', [1122, 780, 1140, 783]), box('E-02', [1126, 787, 1136, 792]),
      box('図面名称', [914, 802, 932, 805]), ...letters('架空設備表', [938, 947, 956, 965, 975]),
      box('縮尺', [1089, 797, 1097, 800]), box('設計年月日', [1120, 797, 1142, 800]),
    )
    expect(result).toMatchObject({ number: 'E-02', name: '架空設備表' })
    expect(result.names.map(n => n.value)).toEqual(['架空設備表'])
  })
  it.each([
    ['2文字だけ', '架空', [961, 970]],
    ['間隔が不均一', '架空設備表', [961, 970, 979, 995, 1004]],
    ['高さの2.5倍を超える間隔', '架空表', [961, 978, 995]],
  ] as const)('%sの文字は広い間隔で連結しない', (_label, text, xs) => {
    expect(read(heading, ...letters(text, [...xs])).names).toEqual([])
  })
  it('縦の重なりや高さが合わない1文字は連結しない', () => {
    expect(read(heading, box('架', [961, 801, 965, 806]), box('空', [970, 803, 974, 808]), box('表', [979, 805, 983, 810])).name).toBeUndefined()
    expect(read(heading, box('架', [961, 801, 965, 806]), box('空', [970, 801, 974, 809]), box('表', [979, 801, 983, 806])).name).toBeUndefined()
  })
  it('均等割りの見出し・番号にも同じ連結を使う', () => {
    const spaced = (text: string, x: number, y: number) => [...text].map((char, i) => box(char, [x + i * 9, y, x + i * 9 + 4, y + 5]))
    expect(read(...spaced('図面名称', 914, 802), ...spaced('かなA1表', 958, 802)).name).toBe('かなA1表')
    expect(read(box('図面番号', [914, 780, 932, 783]), ...spaced('E101', 958, 780)).number).toBe('E101')
  })
  it('Bと同じ見出しを挟む二段を連結し、40文字を超えても候補を一本にする', () => {
    const upper = '架空通信設備・構内案内網設備　接続系統図'
    const lower = '架空放送設備系統図・操作端子盤リスト・総合監視盤姿図'
    const expected = upper.replace('　', ' ') + ' ' + lower
    expect([...expected].length).toBeGreaterThan(40)
    const result = read(...stacked(upper, lower), box('図面番号', [1141, 788, 1156, 791]), box('E-13', [1144, 796, 1154, 801]))
    expect(result).toMatchObject({ number: 'E-13', name: expected })
    expect(result.names).toHaveLength(1)
    expect(result.names[0].rows?.map(r => r.text)).toEqual([upper.replace('　', ' '), lower])
    expect(result.names[0].reasons).toContain('名称見出しの右・直下')
  })
  it('Cと同じ二段目の全角空白の字下げを除く', () => {
    const upper = '架空音響設備・多目的室・小集会室配線図', lower = 'システム構成図・操作機器姿図'
    const result = read(
      box('工事名称', [931, 795, 946, 798]), box('そら色交流棟整備工事', [958, 793, 1046, 799]),
      box(upper, [958, 807, 1072, 812]), box('図面名称', [931, 812, 946, 815]),
      box('　　　　　　' + lower + '　', [958, 815, 1077, 820]), box('縮尺', [1106, 807, 1113, 810]),
    )
    expect(result.name).toBe(upper + ' ' + lower)
    expect(result.names).toHaveLength(1)
    expect(result.names[0].rows?.map(r => r.text)).toEqual([upper, lower])
  })
  it('上段が工事名称の値だけなら取り込まず、工事欄を上端にする', () => {
    const lines = [...project, heading, box('交流棟設備配置図', [961, 814, 1091, 819])]
    expect(read(...lines).name).toBe('交流棟設備配置図')
    expect(read(...lines, box('工事欄より上の参考図', [961, 786, 1075, 791])).name).toBe('交流棟設備配置図')
    expect(read(...project, heading).name).toBeUndefined()
  })
  it('上下の範囲と少し上の右欄の境界を越えず、番号も名称に混ぜない', () => {
    const expected = '架空設備配置図'
    expect(read(heading, ...adjacent, box(expected, [961, 805, 1075, 810]), box('隣欄参考図', [1118, 814, 1158, 819]), box('E-03', [961, 814, 980, 819])).name).toBe(expected)
    expect(read(heading, box('遠い上段配置図', [961, 795, 1075, 800]), box(expected, [961, 814, 1075, 819])).name).toBe(expected)
    expect(read(heading, box('工事名称', [933, 820, 948, 823]), box(expected, [961, 805, 1075, 810]), box('下の別欄の配置図', [961, 824, 1075, 829])).name).toBe(expected)
  })
  it('二段の上段が3ページ共通の建物名なら、その行だけを除く', () => {
    const titles = ['架空設備配置図', '架空設備配線図', '架空設備系統図']
    const pages = titles.map(title => read(...stacked('そら色交流棟', title)))
    expect(pages.map(p => p.name)).toEqual(titles.map(title => 'そら色交流棟 ' + title))
    const reconciled = reconcileDrawingInfos(pages)
    expect(reconciled.map(p => p.name)).toEqual(titles)
    reconciled.forEach(p => expect(p.reasons).toContain('全ページ共通の行を除外'))
  })
  it('単独の行は40文字まで、二段の名称は80文字までとし、超過時に片段を採らない', () => {
    const upper = '架'.repeat(39) + '図', lower = '空'.repeat(38) + '図'
    expect(read(...stacked(upper, lower)).name).toBe(upper + ' ' + lower)
    const rejected = read(...stacked(upper, '空' + lower))
    expect(rejected.name).toBeUndefined()
    expect(rejected.names).toEqual([])
    expect(read(heading, box(upper, [961, 805, 1075, 810])).name).toBe(upper)
    expect(read(heading, box('架' + upper, [961, 805, 1075, 810])).name).toBeUndefined()
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

describe('架空の表題欄の配置と図面集の補正 (SPEC-O5)', () => {
  const box = (text: string, x: number, y: number, width = 100, height = 12): ExtractedTextLine => ({ ...row(text), rect: [x, y, x + width, y + height] })
  const number = (i = 1) => box(`図面番号 E-10${i}`, 850, 850)
  it.each([
    ['図面名称', 6, 0, 13],
    ['図面名称', 5, 77, 3],
    ['図面名称', 6, -42, 29],
    ['図面名', 6, 62, 5],
  ] as const)('見出し %s・高さ %s・横ずれ %s・下の間隔 %s', (label, h, dx, dy) => {
    expect(detect(box(label, 650, 800, 40, h), box('架空棟2階設備平面図', 650 + dx, 800 + h + dy, 140), number()).name).toBe('架空棟2階設備平面図')
  })
  it('別欄の分割された縮尺と作図を名称にしない', () => {
    const result = detect(box('図面名称', 650, 800, 40, 6), box('縮', 850, 800, 5, 6), box('尺', 857, 800, 5, 6), box('作　図', 880, 940, 40), box('架空棟配置図', 655, 819, 130), number())
    expect(result.name).toBe('架空棟配置図')
    expect(result.names.some(n => ['縮', '尺', '縮尺', '作 図'].includes(n.value))).toBe(false)
  })
  it.each(['縮尺', '縮', '尺', '作図', '製図', '設計', '担当', '照査', '承認', '検図', '審査', '区分', '種別', '図番', '図面番号', '番号', '通し番号', '図面名', '図面名称', '図名', '名称', '工事名', '工事名称', '件名', '日付', '年月日', '作成日', '作成年月', '設計年月', '変更年月', '製作年月日', '用紙', '頁', '版', '改訂', '備考', '事務所', '会社名', 'DRAWING NO.', 'DRAWING TITLE', 'TITLE', 'SCALE', 'DATE', 'DRAWN', 'CHECKED', 'APPROVED', 'DESIGNED', 'あ', '棟', 'A'])('欄見出し・1文字 %s を値にしない', text => {
    const result = detect(box('図面名称', 600, 900, 50), box(text, 700, 900), number())
    expect(result.name).toBeUndefined()
    expect(result.names).toEqual([])
  })
  it.each(['通し番号', '図面NO', '図面No.', 'DWG NO', 'DRAWING NO.'])('番号見出し %s', label => {
    expect(detect(box(label, 600, 800, 100), box('E-015', 720, 800)).number).toBe('E-015')
  })
  it.each(['DRAWING TITLE', 'TITLE', '図面名'])('名称見出し %s', label => {
    expect(detect(box(`${label} 架空棟配置図`, 650, 800)).name).toBe('架空棟配置図')
  })
  it.each(['工事名称', '件名', '工事名'])('%s を名称見出しとして読まない', label => {
    expect(detect(box(`${label} そらいろ庁舎新築工事`, 650, 800)).name).toBeUndefined()
  })
  it('3ページの共通の建物名を除き、工事名称欄を混ぜない', () => {
    const titles = ['配置図', '1階平面図', '展開図その1']
    const pages = titles.map((title, i) => detect(number(i + 1), box('工事名称', 650, 740, 40, 6), box('そらいろ庁舎新築工事', 650, 754, 150), box('図面名称', 650, 800, 40, 6), box('そらいろ庁舎', 635, 818, 100), box(title, 650, 840, 140)))
    expect(pages.map(p => p.name)).toEqual(titles.map(title => `そらいろ庁舎 ${title}`))
    const result = reconcileDrawingInfos(pages)
    expect(result.map(p => p.name)).toEqual(titles)
    result.forEach(p => expect(p.reasons).toContain('全ページ共通の行を除外'))
    expect(pages[0].name).toBe('そらいろ庁舎 配置図')
  })
  it.each([
    { fragments: [['E-', 20], ['015', 20]], expected: 'E-015' },
    { fragments: [['Ｅ', 8], ['－5(E)', 40]], expected: 'E-5(E)' },
    { fragments: [['E', 8], ['-', 5], ['015', 20]], expected: 'E-015' },
  ] as const)('隣接する番号の断片 $expected を連結する', ({ fragments, expected }) => {
    let x = 720
    const lines = fragments.map(([text, width]) => { const value = box(text, x, 800, width); x += width + 2; return value })
    expect(detect(box('図面番号', 600, 800, 70), ...lines).number).toBe(expected)
  })
  it('離れた断片や高さが合わない断片を連結しない', () => {
    expect(detect(box('図面番号', 600, 800, 70), box('E-', 720, 800, 20), box('015', 755, 800, 20)).number).not.toBe('E-015')
    expect(detect(box('図面番号', 600, 800, 70), box('E-', 720, 800, 20), box('015', 742, 820, 20)).number).not.toBe('E-015')
  })
  it('3断片の名称は途中の連結候補を混ぜず、3断片の番号も部分値を採らない', () => {
    expect(detect(box('図面名称', 650, 800, 40, 6), box('架空棟', 650, 820, 36), box('設備', 688, 820, 24), box('平面図', 714, 820, 36)).name).toBe('架空棟設備平面図')
    expect(detect(box('図面番号', 600, 800, 70), box('E-', 720, 800, 20), box('01', 742, 800, 12), box('5', 756, 800, 6)).number).toBe('E-015')
  })
  it('同じ物理行の左右の値は、空白で順に連結する', () => {
    expect(detect(box('図面名称', 650, 800, 40, 6), box('架空棟', 630, 820, 40), box('配置図', 700, 820, 50)).name).toBe('架空棟 配置図')
  })
  it('見出しのない3ページの変化する欄を65点で読み、共通工事名を使わない', () => {
    const titles = ['分電盤リスト（１）', '分電盤リスト（２）', '分電盤リスト（３）']
    const pages = titles.map((title, i) => detect(box('そらいろ庁舎新築工事', 700, 800, 160), box(title, 700, 830, 160), box('E-', 900, 850, 15), box(`01${i + 1}`, 917, 850, 20)))
    expect(pages.map(p => p.name)).toEqual([undefined, undefined, undefined])
    const result = reconcileDrawingInfos(pages)
    expect(result.map(p => p.number)).toEqual(['E-011', 'E-012', 'E-013'])
    expect(result.map(p => p.name)).toEqual(['分電盤リスト(1)', '分電盤リスト(2)', '分電盤リスト(3)'])
    result.forEach(p => expect(p.names.find(n => n.value === p.name)).toMatchObject({ score: 65, reasons: ['各ページで変わる欄'] }))
  })
  it('CADの7重の行は候補・点数・同点保留に影響しない', () => {
    const lines = [number(), box('図面名称', 650, 800, 40, 6), box('架空棟配置図', 650, 820, 120)]
    const duplicated = lines.flatMap(line => Array.from({ length: 7 }, (_, i) => ({ ...line, text: i % 2 ? ` ${line.text} ` : line.text, rect: line.rect.map(v => v + i * .2) as typeof line.rect })))
    expect(detect(...duplicated)).toEqual(detect(...lines))
    const tied = [box('図面名称 架空棟配置図', 600, 800), box('図面名称 架空棟展開図', 600, 830)]
    expect(detect(...tied).name).toBeUndefined()
    expect(detect(...tied.flatMap(line => Array(7).fill(line)))).toEqual(detect(...tied))
  })
  it.each(['架空棟2階平面図(改修後)', '特記仕様書3', '展開図その1', '展開図その１', '分電盤リスト（３）'])('名称の補足付き語尾 %s', title => {
    const result = detect(box('図面名称', 650, 800, 40, 6), box(title, 650, 820, 170))
    expect(result.name).toBe(title.normalize('NFKC'))
    expect(result.names[0].reasons).toContain('図面名称の語尾')
  })
  it('全ページ同じ名称は未設定とし、候補を残す', () => {
    const pages = [1, 2, 3].map(i => detect(number(i), box('図面名称 そらいろ庁舎', 650, 800)))
    const result = reconcileDrawingInfos(pages)
    expect(result.map(p => p.name)).toEqual([undefined, undefined, undefined])
    result.forEach(p => expect(p.names.some(n => n.value === 'そらいろ庁舎')).toBe(true))
    expect(reconcileDrawingInfos(pages.slice(0, 2)).map(p => p.name)).toEqual(['そらいろ庁舎', 'そらいろ庁舎'])
  })
  it('名称の80%と共通行の80%をページ単位で数える', () => {
    const pages = Array.from({ length: 5 }, (_, i) => detect(number(i + 1), box('図面名称', 650, 800, 40, 6), box(i < 4 ? 'そらいろ庁舎' : 'あかね色庁舎', 650, 820, 100), box(`${i + 1}階設備平面図`, 650, 840, 140)))
    const result = reconcileDrawingInfos([...pages, detect()])
    expect(result.map(p => p.name)).toEqual(['1階設備平面図', '2階設備平面図', '3階設備平面図', '4階設備平面図', 'あかね色庁舎 5階設備平面図', undefined])
    const common = Array.from({ length: 5 }, (_, i) => detect(box(`図面名称 ${i < 4 ? 'そらいろ庁舎' : 'あかね色庁舎'}`, 650, 800)))
    expect(reconcileDrawingInfos(common).map(p => p.name)).toEqual([undefined, undefined, undefined, undefined, 'あかね色庁舎'])
  })
  const varyingPages = (withNumber = true, tied = false) => Array.from({ length: 3 }, (_, i) => detect(
    ...(withNumber ? [box(`E-10${i + 1}`, tied ? 800 : 900, 850, 40)] : []),
    box(`${i + 1}階平面図`, tied ? 650 : 600, 820, 80), box(`${i + 1}階展開図`, tied ? 910 : 760, 820, 80)))
  it('変化する欄が複数あれば番号に最も近い欄を選ぶ', () => {
    expect(reconcileDrawingInfos(varyingPages()).map(p => p.name)).toEqual(['1階展開図', '2階展開図', '3階展開図'])
  })
  it('変化する欄が番号と等距離、または番号が無ければ保留する', () => {
    expect(reconcileDrawingInfos(varyingPages(true, true)).map(p => p.name)).toEqual([undefined, undefined, undefined])
    expect(reconcileDrawingInfos(varyingPages(false)).map(p => p.name)).toEqual([undefined, undefined, undefined])
  })
  it('3ページ未満や出現率60%未満の位置は名称の補完に使わない', () => {
    const pages = Array.from({ length: 3 }, (_, i) => detect(box(`${i + 1}階設備平面図`, 700, 820, 160)))
    expect(reconcileDrawingInfos(pages.slice(0, 2)).every(p => !p.name)).toBe(true)
    expect(reconcileDrawingInfos([...pages.slice(0, 2), detect(), detect()]).every(p => !p.name)).toBe(true)
    expect(reconcileDrawingInfos([...pages, detect(), detect()]).map(p => p.name)).toEqual(['1階設備平面図', '2階設備平面図', '3階設備平面図', undefined, undefined])
  })
  it('4pt単位で一致する位置を使い、同一ページの重複を出現ページ数に数えない', () => {
    const pages = Array.from({ length: 3 }, (_, i) => detect(box(`${i + 1}階設備平面図`, 700 + i * .5, 820 + i * .5, 160)))
    expect(reconcileDrawingInfos(pages).map(p => p.name)).toEqual(['1階設備平面図', '2階設備平面図', '3階設備平面図'])
    const duplicated = detect(...Array.from({ length: 7 }, () => box('架空棟配置図', 700, 820, 160)))
    expect(reconcileDrawingInfos([duplicated, detect(), detect()]).every(p => !p.name)).toBe(true)
  })
  it('共通の名称を解除したページも、変化する別の欄から補完できる', () => {
    const pages = Array.from({ length: 3 }, (_, i) => detect(number(i + 1), box('図面名称 そらいろ庁舎', 600, 700), box(`${i + 1}階設備平面図`, 700, 820, 160)))
    expect(reconcileDrawingInfos(pages).map(p => p.name)).toEqual(['1階設備平面図', '2階設備平面図', '3階設備平面図'])
  })
  it.each(['工事名称', '件名', '工事名'])('図名に似た語尾の%sの値を名称にしない', label => {
    expect(detect(number(), box(`${label} 架空棟計画図`, 650, 930)).name).toBeUndefined()
    expect(detect(number(), box(label, 650, 900, 40, 6), box('架空棟計画図', 650, 920, 140)).name).toBeUndefined()
  })
  it('右隣・左隣・下の別欄を越えて名称を読まない', () => {
    const heading = box('図面名称', 650, 800, 40, 6)
    expect(detect(heading, box('縮尺', 760, 800, 30, 6), box('架空棟配置図', 780, 820, 120)).name).toBeUndefined()
    expect(detect(heading, box('工事名', 550, 800, 80, 6), box('架空棟配置図', 600, 820, 120)).name).toBeUndefined()
    expect(detect(heading, box('工事名', 650, 814, 40, 6), box('そらいろ庁舎', 650, 830, 120)).name).toBeUndefined()
  })
  it('titleRowsを80行以下にし、保存値だけの旧形式も受け取る', () => {
    const result = detect(...Array.from({ length: 100 }, (_, i) => box(`注記${i}`, 700, 610 + i * 3, 100, 2)))
    expect(result.titleRows).toHaveLength(80)
    const saved = reconcileDrawingInfos([{ number: 'E-101', name: '保存名称', numbers: [], names: [], reasons: [] }])[0]
    expect(saved.titleRows).toBeUndefined()
    expect(saved.name).toBe('保存名称')
  })
})

describe('名称欄の上端は表題欄の中だけ', () => {
  const at = (text: string, x: number, y: number, width = 60, height = 10): ExtractedTextLine => ({ ...row(text), rect: [x, y, x + width, y + height] })
  it('図面本体の遠く上にある同じ語を欄の上端とみなさず、本体の文字を名称に入れない', () => {
    const result = detect(
      at('種別', 600, 400, 30), at('・架空の材料', 700, 420, 80), at('・架空の目地材', 700, 470, 80),
      at('図面名称', 600, 880, 40), at('縮尺', 800, 880, 20), at('架空改修特記仕様書(6)', 590, 905, 120),
      at('図面番号 E-101', 850, 900, 80),
    )
    expect(result.name).toBe('架空改修特記仕様書(6)')
  })
})
