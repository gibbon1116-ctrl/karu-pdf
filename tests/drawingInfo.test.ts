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

describe('1.11の退行 (SPEC-Q1)', () => {
  const box = (text: string, rect: ExtractedTextLine['rect']): ExtractedTextLine => ({ ...row(text), rect })
  const read = (...lines: ExtractedTextLine[]) => detectDrawingInfo(lines, [0, 0, 1191, 842])
  const stacked = (withDate = true, upper = '架空誘導・呼出・緊急呼出設備　', lower = '１階平面図') => [
    box('工事名称', [942, 785, 955, 789]), box('架空新庁舎建設工事', [962, 787, 1021, 793]),
    box('図面名', [942, 798, 952, 801.5]), box(upper, [969, 797, 1102, 802]), box(lower, [969, 803, 995, 808]),
    box('設計番号', [942, 811, 955, 814]), ...(withDate ? [box('作成日', [1007, 811, 1017, 814])] : []),
    box('縮尺', [1072, 811, 1079, 814]), box('種別', [1126, 786, 1133, 789]),
    box('通し番号', [1126, 804, 1139, 808]), box('086', [1141, 809, 1151, 815]),
  ]

  it('下の作成日で上段を切らず、名称の二段と通し番号を読む', () => {
    const result = read(...stacked())
    expect(result).toMatchObject({ number: '086', name: '架空誘導・呼出・緊急呼出設備 1階平面図' })
    expect(result.names[0].rows).toHaveLength(2)
    expect(result.names[0].rows?.map(r => r.text)).toEqual(['架空誘導・呼出・緊急呼出設備', '1階平面図'])
  })
  it('下の作成日が無い場合も、名称の二段と通し番号を読む', () => {
    const result = read(...stacked(false))
    expect(result).toMatchObject({ number: '086', name: '架空誘導・呼出・緊急呼出設備 1階平面図' })
    expect(result.names[0].rows).toHaveLength(2)
  })
  it('5ページ中2ページだけ同じ上段は、文書単位の補正後も二段のまま残す', () => {
    const uppers = ['架空誘導・呼出・緊急呼出設備', '架空誘導・呼出・緊急呼出設備', '架空照明設備', '架空放送設備', '架空通信設備']
    const pages = uppers.map((upper, i) => read(...stacked(true, upper + '　', `${i + 1}階平面図`)))
    const expected = uppers.map((upper, i) => `${upper} ${i + 1}階平面図`)
    expect(pages.map(p => p.name)).toEqual(expected)
    const reconciled = reconcileDrawingInfos(pages)
    expect(reconciled.map(p => p.name)).toEqual(expected)
    reconciled.forEach(p => expect(p.names[0].rows).toHaveLength(2))
  })
  it('別の断片にあるコロンを名称と候補の物理行の先頭から除く', () => {
    const result = read(
      box('工事名称', [792, 803, 808, 807]), box(':', [834, 803, 835, 807]), box('架空中学校校舎改築工事', [838, 803, 919, 807]),
      box('所在地', [792, 812, 804, 816]), box(':', [834, 811, 835, 816]), box('架空町1-1', [838, 812, 884, 816]),
      box('図面名称', [792, 820, 808, 824]), box(':', [834, 820, 835, 824]), box('平面詳細図4(1階、棟4)', [838, 820, 880, 824]),
      box('縮尺', [920, 803, 928, 807]), box(':', [962, 803, 963, 807]),
      box('日付', [920, 820, 928, 824]), box(':', [962, 820, 963, 824]), box('2013/3/31', [965, 820, 983, 824]),
      box('図面\t\r No.', [1047, 803, 1063, 807]), box(':', [1089, 802, 1090, 807]), box('1116', [1093, 803, 1103, 807]),
    )
    expect(result).toMatchObject({ number: '1116', name: '平面詳細図4(1階、棟4)' })
    expect(result.names.every(n => !/^[:：]/.test(n.value))).toBe(true)
    expect(result.names[0].rows?.map(r => r.text)).toEqual(['平面詳細図4(1階、棟4)'])
  })
  it('見出し・コロン・値の3断片が隣接していても名称を読む', () => {
    const result = read(
      box('図面名称', [792, 820, 808, 824]), box(':', [810, 820, 811, 824]), box('架空配置図', [813, 820, 860, 824]),
    )
    expect(result.name).toBe('架空配置図')
    expect(result.names.every(n => !/^[:：]/.test(n.value))).toBe(true)
  })
  it('見出しの無い管の呼び径を番号にせず、見出し付きのVP100は読む', () => {
    const result = read(
      box('VU250', [1020, 760, 1040, 765]), box('E-41', [1090, 760, 1110, 765]), box('架空配置図', [969, 780, 1020, 785]),
    )
    expect(result.number).toBe('E-41')
    expect(result.numbers.some(n => n.value === 'VU250')).toBe(false)
    expect(read(box('図面番号', [1047, 803, 1063, 807]), box('VP100', [1093, 803, 1113, 807])).number).toBe('VP100')
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

describe('実図面の表題欄の再現', () => {
  const sample = (source: string): ExtractedTextLine[] => source.trim().split(/\s+\/\s+|\r?\n/).filter(line => line.trim()).map((line): ExtractedTextLine => {
    const [, coordinates, text] = line.trim().match(/^([\d,]+)\s+(.+)$/)!
    return { text, rect: coordinates.split(',').map(Number) as ExtractedTextLine['rect'], line: 1, writingMode: 0, direction: [1, 0] }
  })
  const read = (lines: ExtractedTextLine[], bounds: Parameters<typeof detectDrawingInfo>[1] = [0, 0, 1191, 842]) => detectDrawingInfo(lines, bounds, 0, true)
  const f1 = sample(`
726,772,748,777 設計番号 / 789,772,805,777 作成日 / 852,772,877,777 種別/備考 / 981,772,1003,777 工事名称 / 1109,772,1131,777 図面番号
1006,777,1103,784 架空小学校地域拠点施設建設工事 / 752,778,774,783 20250043 / 812,778,829,784 2026.3
726,786,762,792 一級建築士NO. / 790,786,826,792 一級建築士NO. / 981,786,1003,792 図面名称 / 853,786,904,792 一級建築士NO.000001 / 917,786,976,792 建築設備士NO.00E0-0000XX
762,786,778,792 000002 / 826,786,842,792 000003 / 1121,792,1135,799 A040 / 853,793,913,798 構造設計一級建築士NO.0004
1008,794,1050,800 矩計図 その1 / 1081,799,1092,805 1/50 / 1053,800,1078,805 縮尺 A1:
730,802,758,808 架空 一郎 / 794,802,822,808 架空 二郎 / 858,802,892,808 架空 三郎 / 922,802,950,808 架空 四郎
1081,806,1095,811 1/100 / 1053,806,1078,812 A3:
`)
  it('F1: 縮尺の見出しと値を矩計図の名称に混ぜない', () => {
    expect(read(f1).name).toBe('矩計図 その1')
  })
  it('F2: 縮尺欄より上にはみ出す2行の名称を読む', () => {
    const lines = f1.filter(line => !['矩計図 その1', '1/50', '1/100', 'A040'].includes(line.text))
    lines.push(...sample('1121,791,1135,799 A096 / 981,794,1075,800 (会議室、会議収納、配膳室1) / 981,801,1039,808 平面詳細図・展開図'))
    expect(read(lines).name).toBe('(会議室、会議収納、配膳室1) 平面詳細図・展開図')
  })
  it.each(['縮尺 A1:', '縮 尺：1/100', 'SCALE 1:200', 'scale A1:1/50'])('R1: %s が同じ高さの名称欄の右端を閉じる', scale => {
    const lines = sample(`981,786,1003,792 図面名称 / 981,794,1042,800 矩計図 その1 / 1053,794,1078,800 ${scale} / 1081,794,1135,800 別欄の注記`)
    expect(read(lines).name).toBe('矩計図 その1')
  })
  it.each(['A1:', 'A3:', '1/50', '1:200', 'A1:1/50', 'A3:1/100', 'A3 : 1/100', '1/5,40', '1/5、40', 'N.S', 'n. s.', 'NON SCALE', '-'])('R1: 縮尺の値 %s を名称に入れない', scale => {
    const lines = sample(`981,786,1003,792 図面名称 / 981,794,1042,800 矩計図 その1 / 1010,802,1050,808 ${scale}`)
    expect(read(lines).name).toBe('矩計図 その1')
  })
  it.each(['1/60、1/5', '1/5,40', '1/100,200'])('R1: 名称の右隣にある縮尺値 %s を名称に入れない', scale => {
    const lines = sample(`909,800,928,804 図面名称 / 919,808,1049,813 架空棟配置図 / 1053,808,1078,813 ${scale}`)
    expect(read(lines).name).toBe('架空棟配置図')
  })

  const f3 = sample(`
909,783,928,787 工事名称 / 944,787,1044,793 ( 仮称) 架空水道庁舎建設工事 / 869,787,900,792 製作年月日 / 1101,787,1152,792 当初・変更・完成
909,800,928,804 図面名称 / 1050,800,1059,804 縮尺 / 1100,800,1109,804 図番 / 1064,801,1086,806 A1:1/50 / 870,803,901,809 2025年8月 / 1064,808,1089,813 A3:1/100
714,802,856,811 架空市都市局住宅・建築室営繕課
`)
  it.each([
    [1049, 1058, '架空棟配置図'],
    [1050, 1058, undefined],
    [1051, 1058, undefined],
    [919, 1206, '架空棟配置図'],
    [919, 1207, undefined],
  ])('R2: 下の行の右へのはみ出しは開始位置と行の右端で制限する (%s–%s)', (left, right, expected) => {
    const lines = sample(`909,800,928,804 図面名称 / 1050,800,1059,804 図面番号 / ${left},808,${right},813 架空棟配置図`)
    expect(read(lines).name).toBe(expected)
  })
  it.each([
    [804, 808, '架空棟配置図'],
    [813, 817, '架空棟配置図'],
    [809, 812, undefined],
  ])('R2: はみ出す行と上下が重なる見出しだけが行の右端を閉じる (%s–%s)', (top, bottom, expected) => {
    const lines = sample(`909,800,928,804 図面名称 / 1050,800,1059,804 縮尺 / 919,808,1071,813 架空棟配置図 / 1070,${top},1080,${bottom} DATE`)
    expect(read(lines).name).toBe(expected)
  })
  it('R2: 見出し右側の行も欄内から始まれば同じ高さにない見出しの右端を越えられる', () => {
    const lines = sample('909,800,928,804 図面名称 / 1050,790,1059,795 縮尺 / 936,799,1058,805 架空棟配置図')
    const result = read(lines)
    expect(result.name).toBe('架空棟配置図')
    expect(result.names.find(candidate => candidate.value === result.name)?.rows).toEqual([
      { text: '架空棟配置図', rect: [936, 799, 1058, 805] },
    ])
  })
  it('F3: 境目のはみ出しを許し、共通の建物名を除いて残りを末尾へ回す', () => {
    const pages = [
      '1120,804,1133,809 A-38 / 936,799,974,805 架空水道庁舎 / 919,808,956,813 展開図(1) / 959,808,1051,813 風除室、倉庫(1)(2)、更衣室(2)',
      '1120,804,1133,809 A-39 / 936,799,974,805 架空水道庁舎 / 919,808,1058,813 展開図(2)湯沸室(1)、倉庫(3)、男子・女子更衣室',
      '1120,804,1133,809 A-40 / 936,799,974,805 架空水道庁舎 / 919,808,990,813 展開図(3)廊下',
      '1120,804,1133,809 A-41 / 936,799,974,805 架空水道庁舎 / 919,808,990,813 展開図(4)ホール',
      '1120,804,1133,809 A-47 / 936,799,974,805 架空水道庁舎 / 977,799,1043,805 US1~3、シャワールーム(男子) / 919,808,963,813 展開図(10) / 966,808,1055,813 脱衣室1~3、湯沸室(3)、廊下(1)',
    ].map(source => read([...f3, ...sample(source)]))
    const result = reconcileDrawingInfos(pages)
    expect(result.map(page => page.name)).toEqual([
      '展開図(1)風除室、倉庫(1)(2)、更衣室(2)',
      '展開図(2)湯沸室(1)、倉庫(3)、男子・女子更衣室',
      '展開図(3)廊下',
      '展開図(4)ホール',
      '展開図(10)脱衣室1~3、湯沸室(3)、廊下(1) US1~3、シャワールーム(男子)',
    ])
    result.forEach(page => {
      expect(page.reasons).toContain('全ページ共通の行を除外')
      expect(page.names.find(candidate => candidate.value === page.name)?.reasons).toContain('全ページ共通の行を除外')
    })
  })
  it('F3: A-45 の名称に連結した縮尺値を含めず、5ページから共通行を除く', () => {
    const pageSources = [
      '1120,804,1133,809 A-38 / 936,799,974,805 架空水道庁舎 / 919,808,956,813 展開図(1) / 959,808,1051,813 風除室、倉庫(1)(2)、更衣室(2)',
      '1120,804,1133,809 A-39 / 936,799,974,805 架空水道庁舎 / 919,808,1058,813 展開図(2)湯沸室(1)、倉庫(3)、男子・女子更衣室',
      '1120,804,1133,809 A-40 / 936,799,974,805 架空水道庁舎 / 919,808,990,813 展開図(3)廊下',
      '1120,804,1133,809 A-41 / 936,799,974,805 架空水道庁舎 / 919,808,990,813 展開図(4)ホール',
      '1120,804,1133,809 A-45 / 936,799,974,805 架空水道庁舎 / 919,808,1050,813 展開図(8)倉庫(4)、男子・女子更衣室、休養室(4)',
    ]
    const pages = pageSources.map((source, index) => {
      const titleBlock = index === 4
        ? f3.map(line => line.text === 'A3:1/100' ? { ...line, rect: [1053, 808, 1078, 813] as ExtractedTextLine['rect'] } : line)
        : f3
      return read([...titleBlock, ...sample(source)])
    })
    expect(reconcileDrawingInfos(pages).map(page => page.name)).toEqual([
      '展開図(1)風除室、倉庫(1)(2)、更衣室(2)',
      '展開図(2)湯沸室(1)、倉庫(3)、男子・女子更衣室',
      '展開図(3)廊下',
      '展開図(4)ホール',
      '展開図(8)倉庫(4)、男子・女子更衣室、休養室(4)',
    ])
  })
  it('R3: 共通の先頭文字列が複数あれば最長のものを除く', () => {
    const pages = Array.from({ length: 5 }, (_, i) => {
      const rows = sample(i < 4
        ? `936,790,974,796 共通 / 936,798,990,804 共通庁舎 / 919,808,1040,814 ${i + 1}階平面図`
        : '936,798,1040,804 共通庁舎 補足 / 919,808,1040,814 5階平面図')
      return { numbers: [], names: [{ value: rows.map(line => line.text).join(' '), score: 80, reasons: [], rect: [919, 790, 1040, 814] as ExtractedTextLine['rect'], rows }], reasons: [] }
    })
    expect(reconcileDrawingInfos(pages).map(page => page.name)).toEqual(['1階平面図', '2階平面図', '3階平面図', '4階平面図', '5階平面図 補足'])
  })
  it('R3: 1文字だけの共通行は他の行の先頭から除かない', () => {
    const pages = Array.from({ length: 5 }, (_, i) => {
      const rows = sample(`936,798,1040,804 ${i < 4 ? '棟' : '棟内設備'} / 919,808,1040,814 ${i + 1}階平面図`)
      return { numbers: [], names: [{ value: rows.map(line => line.text).join(' '), score: 80, reasons: [], rect: [919, 798, 1040, 814] as ExtractedTextLine['rect'], rows }], reasons: [] }
    })
    expect(reconcileDrawingInfos(pages).map(page => page.name)).toEqual(['1階平面図', '2階平面図', '3階平面図', '4階平面図', '棟内設備 5階平面図'])
  })

  const f4 = sample(`
795,789,814,793 図面名称 / 937,788,946,791 SCALE / 994,788,1001,791 DATE / 1121,789,1140,793 図面番号
951,792,970,796 A1:1/150 / 1010,795,1025,799 2026.01 / 951,798,970,802 A3:1/300
961,806,1110,810 架空県架空市架空町1-1-1 TEL(000)00-0000 FAX(000)00-0000
797,807,930,817 架空・県建築設計共同企業体
961,813,1110,817 知事登録番号(架空)H第00000号 一級建築士大臣登録第000000号 架空太郎
`)
  it('F4: 上端から1ptはみ出す1行目と重ね書きを含む2行目を読む', () => {
    const titles = [
      ['A-71', '1階キープラン', '(金物、サイン、家具)'],
      ['A-72', '2階キープラン', '(金物、サイン、家具)'],
      ['A-36', '矩計図1', '(外壁)'],
      ['A-37', '矩計図2', '(屋根)'],
      ['A-45', '展開図1', '(1階)'],
    ]
    const pages = titles.map(([number, first, second], i) => read([...f4,
      ...sample(`1136,800,1150,807 ${number} / 843,788,880,794 ${first} / 835,796,889,802 ${second}`),
      ...(i === 0 ? sample('835,797,889,802 (金物、サイン、家具)') : []),
    ]))
    expect(reconcileDrawingInfos(pages).map(page => page.name)).toEqual(titles.map(([, first, second]) => `${first} ${second}`))
  })

  const f5 = sample(`
1222,1022,1247,1027 PROJECT / 1448,1022,1489,1027 PROJECT NO. / 1225,1033,1433,1044 架空給食センター電気及び機械設備改修工事
1222,1050,1250,1056 DRAWING / 1448,1050,1467,1056 SCALE / 1289,1060,1376,1072 電気設備 配置図 / 1468,1061,1502,1072 1:200
1222,1078,1253,1084 APPROVED / 1297,1078,1326,1084 CHECKED / 1373,1078,1395,1084 DRAWN / 1448,1078,1465,1084 DATE
1459,1089,1462,1100 ' / 1462,1089,1479,1100 17. / 1486,1089,1497,1100 2.
1448,1107,1496,1112 DRAWING NO. / 1472,1125,1480,1136 E / 1480,1125,1496,1136 -2
`)
  it.each(['DRAWING', 'DRAWING NAME', 'DRAWING TITLE', 'DWG. TITLE', 'DWG TITLE', 'DWG.TITLE', 'SHEET TITLE', 'drawing', 'dwg. title'])('F5 / R4: 英語見出し %s から名称を読む', heading => {
    const lines = f5.map(line => line.text === 'DRAWING' ? { ...line, text: heading } : line)
    expect(read(lines, [0, 0, 1684, 1191]).name).toBe('電気設備 配置図')
  })
  it.each(['DRAWING NO.', 'DRAWN'])('R4: %s を名称の見出しとして使わない', heading => {
    expect(read(sample(`981,786,1003,792 ${heading} / 1008,794,1050,800 電気設備 配置図`)).name).toBeUndefined()
  })
  it('R4: DRAWING NO. は引き続き番号の見出しとして読む', () => {
    expect(read(sample('981,786,1040,792 DRAWING NO. / 1045,786,1070,792 A040')).number).toBe('A040')
  })

  const f6 = sample(`
1130,785,1145,792 電気 / 978,785,1044,792 架空市庁舎新築工事 / 856,786,939,791 一級建築士 (第 号) / 904,786,921,791 000005 / 934,786,961,791 架空 五郎
821,786,848,791 P-2019-012 / 758,787,769,792 2020 / 800,787,806,792 31 / 782,787,784,792 8 / 1097,799,1099,804 -
978,800,1047,806 視覚障がい者音声誘導設備 / 1138,803,1149,810 043 / 1129,803,1137,810 E- / 866,803,948,808 設計一級建築士(第 号)
919,803,930,808 0006 / 942,803,969,808 架空 六郎 / 855,803,866,809 設備 / 638,805,682,810 一級建築士事務所 / 1097,805,1099,811 -
978,806,1066,811 システム概要図・系統図・機器姿図
`)
  it('F6: 見出しのない接した2行を1つの名称にして行の情報も残す', () => {
    const result = read(f6)
    expect(result.name).toBe('視覚障がい者音声誘導設備 システム概要図・系統図・機器姿図')
    expect(result.names.find(candidate => candidate.value === result.name)?.rows?.map(line => line.text)).toEqual(['視覚障がい者音声誘導設備', 'システム概要図・系統図・機器姿図'])
  })
  it('R5: 1行目がなければ名称は1行のままで、8pt離れた工事名を混ぜない', () => {
    const lines = f6.filter(line => line.text !== '視覚障がい者音声誘導設備')
    const result = read(lines)
    expect(result.name).toBe('システム概要図・系統図・機器姿図')
    expect(result.names.find(candidate => candidate.value === result.name)?.rows).toBeUndefined()
  })
  it('R5: 上の工事名との間が8ptのときは合わせない', () => {
    const lines = f6.filter(line => line.text !== '視覚障がい者音声誘導設備').map(line => line.text === 'システム概要図・系統図・機器姿図'
      ? { ...line, rect: [978, 800, 1066, 805] as ExtractedTextLine['rect'] } : line)
    expect(read(lines).name).toBe('システム概要図・系統図・機器姿図')
  })
  it('R5: 上の行にも図名の語尾があっても2行の名称と競合させない', () => {
    const lines = f6.map(line => line.text === '視覚障がい者音声誘導設備' ? { ...line, text: '視覚障がい者音声誘導設備系統図' } : line)
    expect(read(lines).name).toBe('視覚障がい者音声誘導設備系統図 システム概要図・系統図・機器姿図')
  })

  const f7 = sample(`
626,777,645,781 8 予備品 / 669,777,752,781 予備品は製造者の標準品一式とする。
864,791,873,800 架 / 882,791,890,800 空 / 899,791,908,800 市 / 917,791,925,800 電 / 934,791,943,800 気 / 935,791,943,800 気
952,791,960,800 設 / 969,791,978,800 備 / 987,791,995,800 工 / 1004,791,1013,800 事 / 1022,791,1031,800 特 / 1040,791,1048,800 記
1057,791,1066,800 仕 / 1058,791,1066,800 仕 / 1075,791,1083,800 様 / 1092,791,1101,800 書
833,802,876,808 2026年5月 / 1133,804,1138,810 E / 919,809,1121,816 (仮称)架空地区消防組合消防局訓練場整備電気設備工事
820,813,896,819 架空市建設局建築部設備課 / 1141,816,1153,821 01
`)
  const body = Array.from({ length: 30 }, (_, i) => ({ ...row(`本文の注記${i}。`), rect: [100, 100 + i * 10, 300, 104 + i * 10] as ExtractedTextLine['rect'] }))
  it('F7: 見出しも番号もないページで大きく離した表題文字を60点で読む', () => {
    const result = read([...body, ...f7])
    expect(result.name).toBe('架空市電気設備工事特記仕様書')
    expect(result.names.find(candidate => candidate.value === result.name)).toMatchObject({ score: 60, reasons: ['大きな表題文字'] })
  })
  it('R6: 条件を満たす大きな表題文字が2行あれば採用しない', () => {
    const second = [...'消防設備特記仕様書'].map((text, i) => ({ ...row(text), rect: [864 + i * 18, 760, 873 + i * 18, 769] as ExtractedTextLine['rect'] }))
    const result = read([...body, ...f7, ...second])
    expect(result.name).toBeUndefined()
    expect(result.names.some(candidate => candidate.reasons.includes('大きな表題文字'))).toBe(false)
  })
})
