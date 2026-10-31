import { describe, expect, it } from 'vitest'
import { bodyPageEntries, bodyPageLines, buildTocOutline, buildTocRows, joinSpacedCharacters, detectPrintedPageNumber, detectTocPageRange, estimatePageOffset, inferTocShapeLevels, isTocLikePage, locateTocEntries, normalizeTocText, parseTocEntries, removeCommonBodyLines, splitTocLabel, tocEntryShapeKeys, tocLabelShape, tocLevelsByIndent, tocNeedsBodySearch, tocSearchKeys, type TocBodyPage, type TocEntry, type TocLine, type TocPageText } from '../src/core/tocImport'
import { flattenOutline, validateOutlineItems } from '../src/core/outlineModel'
import { isDrawingList, locateDrawingNumbers, splitDrawingListTitle, stripScaleSuffix } from '../src/core/tocImport'

const line = (text: string, x = 60, y = 100, right = 550): TocLine => ({ text, rect: [x, y, right, y + 12] })
const page = (lines: TocLine[], pageIndex = 1): TocPageText => ({ pageIndex, width: 600, height: 900, lines })
const rows = (texts: string[], indents: number[] = []) => page(texts.map((text, i) => line(text, indents[i] ?? 60, 100 + i * 22)))
const entriesFor = (texts: string[], indents?: number[]) => parseTocEntries([rows(texts, indents)])
const levelsFor = (entries: TocEntry[]) => { const shapes = inferTocShapeLevels(entries); return entries.map(e => shapes.find(s => s.shape === e.shape)!.level) }
const optionsFor = (entries: TocEntry[]) => ({ offset: 25, pageCount: 100, maxDepth: 8, includeLabel: true, included: new Set(entries.map(e => e.id)) })

describe('drawing lists', () => {
  it.each([
    ['A-01 架空平面図 1:100 1:200', { number: 'A-01', name: '架空平面図' }],
    ['電-3 架空系統図 N.S N.S', { number: '電-3', name: '架空系統図' }],
    ['S001 架空図 NS', { number: 'S001', name: '架空図' }],
    ['ＡＢＣ－１２３４－Ａ－１　架空図　ＮＯＮ ＳＣＡＬＥ', { number: 'ABC-1234-A-1', name: '架空図' }],
    ['かな-12 架空図', { number: 'かな-12', name: '架空図' }],
    ['第1章 総則', null], ['1階平面図', null], ['A-01架空図', null],
    ['ABCD-1 架空図', null], ['A-12345 架空図', null], ['A-1-A-1-B 架空図', null],
  ])('splits a separated drawing number in %s', (title, expected) => expect(splitDrawingListTitle(title)).toEqual(expected))

  it.each([
    ['架空配置図 1:200 1:400', '架空配置図'], ['架空図 N.S N.S', '架空図'],
    ['架空図 S=1:50', '架空図'], ['架空図 A1', '架空図'],
    ['架空図 N.S. NON SCALE ノンスケール 1/200 A3 -', '架空図'],
    ['架空図 Ｓ＝１：１００ Ａ１ －', '架空図'],
    ['1:100', '1:100'], ['N.S N.S', 'N.S N.S'], ['NON SCALE', 'NON SCALE'],
    ['架空図 1:100 の説明', '架空図 1:100 の説明'], ['架空A1', '架空A1'],
  ])('strips only trailing scale and paper tokens in %s', (name, expected) => expect(stripScaleSuffix(name)).toBe(expected))

  it('recognizes the 60 percent threshold and up to three number prefixes', () => {
    const entries = entriesFor(['架空工事', '図面リスト', 'A-01 架空図', 'A-02 架空図', 'S001 架空図'])
    expect(isDrawingList(entries)).toBe(true)
    expect(isDrawingList(entries.slice(0, 4))).toBe(false)
    expect(isDrawingList(entriesFor(['A-1 架空図', 'S-1 架空図', 'E-1 架空図']))).toBe(true)
    expect(isDrawingList(entriesFor(['A-1 架空図', 'S-1 架空図', 'E-1 架空図', 'M-1 架空図']))).toBe(false)
    expect(isDrawingList(entriesFor(['第1章 総則 ………… 1', '1.1 架空 ………… 2']))).toBe(false)
    expect(isDrawingList([])).toBe(false)
  })

  it('excludes only complete table headings and preserves printed TOC entries', () => {
    expect(entriesFor(['図面番号図面名称', '番号 名称 縮尺', '図番 図名 備考 枚数 頁 ページ', 'A-01 架空図 NS']).map(e => e.title)).toEqual(['A-01 架空図 NS'])
    expect(entriesFor(['図面名称の説明', 'A-01 架空図']).map(e => e.title)).toEqual(['図面名称の説明', 'A-01 架空図'])
    expect(entriesFor(['番号 ………… 1', '名称 ………… 2']).map(e => [e.title, e.printedNumber])).toEqual([['番号', 1], ['名称', 2]])
    expect(entriesFor(['ア-01 架空図 NS'])[0]).toMatchObject({ label: null, title: 'ア-01 架空図 NS' })
  })

  it('finds six title blocks including the list itself and split numbers, never inline references', () => {
    const numbers = Array.from({ length: 6 }, (_, i) => `A-0${i}`)
    const drawings = numbers.map(number => ({ number, name: '架空図' }))
    const pages = numbers.map((number, i) => page([
      line('架空工事名', 320, 860, 440),
      ...(i === 5 ? [line('A-', 480, 860, 500), line('05', 505, 860, 530)] : [line(number, 480, 860, 530)]),
      line('・別図架空設備仕様（ A-03 図）による。', 60, 200, 400),
      ...(i === 0 ? numbers.map((n, j) => line(`${n} 架空図 N.S N.S`, 60, 120 + j * 25, 420)) : []),
    ], i + 4))
    expect(buildTocRows(pages[0]).some(row => row.parts.length === 2 && row.text.includes('架空工事名'))).toBe(true)
    expect(locateDrawingNumbers(drawings, pages, 4)).toEqual([4, 5, 6, 7, 8, 9])
    expect(locateDrawingNumbers(drawings, pages, 5)).toEqual([null, 5, 6, 7, 8, 9])
    expect(locateDrawingNumbers([{ number: 'A-03', name: '' }], [pages[0]], 4)).toEqual([null])
  })

  it('normalizes entire blocks and joins up to three horizontally adjacent parts', () => {
    const pages = [page([line('ａ－ ０１　', 480, 870, 550)], 0),
      page([line('A', 480, 870, 490), line('-', 492, 870, 500), line('02', 502, 870, 530)], 1)]
    expect(locateDrawingNumbers([{ number: 'A-01', name: '' }, { number: 'a-02', name: '' }], pages, 0)).toEqual([0, 1])
    expect(locateDrawingNumbers([{ number: 'A-02', name: '' }], [page([line('A-', 480, 840, 500), line('02', 505, 870, 530)], 2)], 0)).toEqual([null])
    expect(locateDrawingNumbers([{ number: 'A-01', name: '' }], [{ ...pages[0], unreliable: true }], 0)).toEqual([null])
  })

  it('maximizes total score with nondecreasing pages, gaps, duplicates and earliest ties', () => {
    const drawings = ['A-01', 'A-02', 'A-99', 'A-03'].map(number => ({ number, name: '' }))
    const pages = [page([line('A-01', 60, 100, 150)], 0),
      page([line('A-02', 480, 860, 550)], 1),
      page([line('A-01', 480, 860, 550)], 2),
      page([line('A-03', 480, 860, 550)], 3), page([line('A-03', 480, 860, 550)], 4)]
    // Choosing the stronger A-01 match greedily would lose A-02 altogether.
    expect(locateDrawingNumbers(drawings, pages, 0)).toEqual([0, 1, null, 3])
    expect(locateDrawingNumbers([{ number: 'A-01', name: '' }], pages, 0)).toEqual([2])
    expect(locateDrawingNumbers([drawings[0], drawings[0]], pages, 0)).toEqual([2, 2])
    expect(locateDrawingNumbers(drawings, [], 0)).toEqual([null, null, null, null])
    expect(locateDrawingNumbers([], pages, 0)).toEqual([])
  })

  it('scores the lower right quadrant and bottom 15 percent independently', () => {
    const drawing = [{ number: 'A-01', name: '' }]
    const candidates = [page([line('A-01', 60, 860, 150)], 0), page([line('A-01', 480, 600, 550)], 1),
      page([line('A-01', 480, 860, 550)], 2)]
    expect(locateDrawingNumbers(drawing, candidates.slice(0, 2), 0)).toEqual([1])
    expect(locateDrawingNumbers(drawing, candidates, 0)).toEqual([2])
  })
})

describe('TOC normalization and physical rows', () => {
  it('normalizes width and whitespace', () => expect(normalizeTocText('　１． ２　\n 設定  ')).toBe('1. 2 設定'))
  it('joins separate aligned parts, deduplicates near-identical boxes and leaves adjacent rows apart', () => {
    const parts = [line('1. 1. 1', 80, 100, 140), line('架空の設定 …………', 180, 103, 480), line('1', 540, 101, 550)]
    const actual = buildTocRows(page([...parts, { text: parts[0].text, rect: [81, 101, 141, 113] }, line('次の行', 80, 120, 200)]))
    expect(actual).toHaveLength(2)
    expect(actual[0]).toMatchObject({ x: 80, y: 100, right: 550, height: 15 })
    expect(actual[0].parts).toHaveLength(3)
  })
  it.each(['目次', '目次- 1 -', '- 目次1 -', '- 3 -', '3', 'p.3', 'Ｐ３'])('removes margin marker %s', marker => {
    expect(buildTocRows(page([line(marker, 250, 10), line(marker, 250, 860), line('本文の候補 ……… 5')]))).toHaveLength(1)
  })
  it('retains non-footer titles in margins and ignores unreliable input', () => {
    expect(buildTocRows(page([line('第1章 架空の設定', 60, 15)]))).toHaveLength(1)
    expect(buildTocRows({ ...rows(['架空 ……… 1']), unreliable: true })).toEqual([])
  })
})

describe('TOC detection and parsing', () => {
  it('produces equivalent entries and levels for split blocks (A) and whole lines (B)', () => {
    const a = page([
      line('第 １ 部 架空の世界', 60, 100), line('第 １ 章 架空の設定', 75, 125),
      line('1. 1. 1', 90, 150, 150), line('サンプル …………', 190, 151, 480), line('7', 540, 150, 550),
      line('1. 1. 2', 90, 175, 150), line('別のサンプル …………', 190, 175, 480), line('9', 540, 175, 550),
    ])
    const b = page([line('第1部 架空の世界', 60, 100), line('第1章 架空の設定', 75, 125), line('１．１．１ サンプル ………… 7', 90, 150), line('1.1.2 別のサンプル ………… 9', 90, 175)])
    expect(parseTocEntries([a])).toEqual(parseTocEntries([b]))
    expect(levelsFor(parseTocEntries([a]))).toEqual([1, 2, 3, 3])
  })
  it('requires five candidate rows and 30 percent, and accepts separated right-aligned numbers', () => {
    const toc = rows(Array.from({ length: 5 }, (_, i) => `候補${i} ………… ${i + 1}`))
    expect(isTocLikePage(toc)).toBe(true)
    expect(isTocLikePage(rows(Array.from({ length: 5 }, (_, i) => `候補${i} ${i + 1}`)))).toBe(true)
    expect(isTocLikePage(rows(['候補 ………… 1']))).toBe(false)
    expect(isTocLikePage({ ...toc, lines: [...toc.lines, ...Array.from({ length: 15 }, (_, i) => line(`通常の行${i}`, 60, 250 + i * 20))] })).toBe(false)
    expect(isTocLikePage({ ...toc, lines: toc.lines.map(l => ({ ...l, text: l.text.replace(/…/g, ''), rect: [60, l.rect[1], 300, l.rect[3]] })) })).toBe(false)
  })
  it('detects a consecutive range with one intervening page and stops at two misses or missing indices', () => {
    const toc = rows(Array.from({ length: 5 }, (_, i) => `架空の行 ………… ${i + 1}`)), blank = page([])
    const pages = [blank, toc, blank, toc, blank, blank, toc].map((p, pageIndex) => ({ ...p, pageIndex }))
    expect(detectTocPageRange(pages)).toEqual({ first: 1, last: 3 })
    expect(detectTocPageRange([blank])).toBeNull()
    expect(detectTocPageRange([{ ...toc, pageIndex: 1 }, { ...toc, pageIndex: 3 }])).toEqual({ first: 1, last: 1 })
  })
  it('joins wrapped titles across pages and a label-only line with the next title', () => {
    const result = parseTocEntries([rows(['第1部 架空の長い', '題名の続き']), { ...rows(['さらに続き', '1.1.1', '架空の項目 ………… 4', '次の見出しなし ………… 6']), pageIndex: 2 }])
    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ label: '第1部', title: '架空の長い 題名の続き さらに続き', printed: null, sourcePage: 1 })
    expect(result[1]).toMatchObject({ label: '1.1.1', title: '架空の項目', printedNumber: 4 })
    expect(result[2]).toMatchObject({ label: null, title: '次の見出しなし', printedNumber: 6 })
  })
  it.each(['1階', 'その2', '第2種', 'その3', '(1)'])('does not treat title digits in %s as a page', text => {
    const result = entriesFor([`第1章 架空の${text}`])[0]
    expect(result.printedNumber).toBeNull()
    expect(result.title).toBe(`架空の${text}`)
  })
  it('does not lose circled or Unicode Roman shape through NFKC', () => {
    expect(entriesFor(['① 架空 ………… 1', 'Ⅰ 架空 ………… 2']).map(e => e.shape)).toEqual(['circled', 'roman'])
  })
})

describe('shape and indentation hierarchy', () => {
  it.each([
    [['第1部 架空 ………… 1', '第1章 架空 ………… 1', '(1) 架空 ………… 2', '第2章 架空 ………… 3', '(2) 架空 ………… 4'], [1, 2, 3, 2, 3]],
    [['Chapter 1 Fiction ………… 1', 'Section 1 Topic ………… 2', 'Section 2 Topic ………… 3', 'Chapter 2 Fiction ………… 4'], [1, 2, 2, 1]],
    [['1 架空 ………… 1', '1.1 架空 ………… 2', '1.1.1 架空 ………… 3', '2 架空 ………… 4', '2.1 架空 ………… 5'], [1, 2, 3, 1, 2]],
    [['Ⅰ Fiction ………… 1', 'A. Fiction ………… 2', '(a) Fiction ………… 3', 'B. Fiction ………… 4'], [1, 2, 3, 2]],
  ] as [string[], number[]][])('infers a generic shape stack %j', (texts, expected) => expect(levelsFor(entriesFor(texts))).toEqual(expected))
  it('splits unlabeled entries by indentation and tolerates small coordinate noise', () => {
    const entries = entriesFor(['架空の親 ………… 1', '架空の子 ………… 2', '別の親 ………… 3', '別の子 ………… 4'], [60, 90, 62, 92])
    expect(tocLevelsByIndent(entries)).toEqual([1, 2, 1, 2])
    expect(levelsFor(entries)).toEqual([1, 2, 1, 2])
    expect(tocLevelsByIndent(entries, 1)).toEqual([1, 1, 1, 1])
  })
  it('orders numeric depths even when first seen in reverse order', () => {
    expect(levelsFor(entriesFor(['1.1.1 架空 ………… 1', '1.1 架空 ………… 2', '1 架空 ………… 3']))).toEqual([3, 2, 1])
  })
  it.each([
    ['第2款', 'dai:款'], ['第3話', 'dai:話'], ['第三編', 'dai:編'], ['第2単元', 'dai:単元'],
    ['1. 1. 13', 'num:3:.'], ['2-3', 'num:2:-'], ['2‐3‐1', 'num:3:‐'], ['1,2', 'num:2:,'], ['1・2', 'num:2:・'],
    ['(1)', 'paren:num'], ['(ア)', 'paren:kana'], ['1)', 'paren:num'], ['a)', 'paren:alpha'],
    ['①', 'circled'], ['Ⅰ', 'roman'], ['II.', 'roman'], ['A.', 'alpha:upper'], ['a.', 'alpha:lower'], ['ア', 'kana'],
    ['Chapter 1', 'en:chapter'], ['Section 2', 'en:section'], ['付録1', 'word:付録'], ['別表', 'word:別表'], [null, 'none'],
  ])('classifies %s as %s', (label, shape) => expect(tocLabelShape(label)).toBe(shape))
  it('reports examples and counts with levels capped at eight', () => {
    const entries = entriesFor(['第1款 架空 ………… 1', '第2款 架空 ………… 2', '第3話 架空 ………… 3'])
    expect(inferTocShapeLevels(entries)).toEqual([{ shape: 'dai:款', example: '第1款', count: 2, level: 1 }, { shape: 'dai:話', example: '第3話', count: 1, level: 2 }])
    const many = Array.from({ length: 10 }, (_, i) => ({ ...entries[0], id: `shape-${i}`, shape: `custom-${i}` }))
    expect(inferTocShapeLevels(many).map(s => s.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8, 8])
  })
})

describe('printed page mapping', () => {
  it.each(['- 60 -', '60', 'p.60', 'P60', '60/344', '－ ６０ －'])('reads %s at the margin', text => expect(detectPrintedPageNumber(page([line(text, 250, 865)]))).toBe(60))
  it('prefers bottom, excludes TOC markers, body numbers, undecodable pages and partial text', () => {
    expect(detectPrintedPageNumber(page([line('10', 250, 15), line('- 60 -', 250, 865)]))).toBe(60)
    expect(detectPrintedPageNumber(page([line('目次- 1 -', 250, 865), line('60', 250, 400)]))).toBeNull()
    expect(detectPrintedPageNumber(page([line('第60章', 250, 865)]))).toBeNull()
    expect(detectPrintedPageNumber({ ...page([line('60', 250, 865)]), unreliable: true })).toBeNull()
  })
  it('uses the modal zero-based offset, reports usable sample count and tolerates outliers', () => {
    expect(estimatePageOffset([{ pageIndex: 86, printed: 60 }, { pageIndex: 87, printed: 61 }, { pageIndex: 88, printed: 5 }, { pageIndex: 89, printed: null }])).toEqual({ offset: 26, agreeing: 2, total: 3 })
    expect(estimatePageOffset([{ pageIndex: 1, printed: null }])).toBeNull()
  })
})

describe('draft outline construction', () => {
  const make = () => entriesFor(['第1部 架空の親', '第1章 架空の章', '1.1 架空の子 ………… 1', '1.2 架空の別の子 ………… 3', '第2部 架空の範囲外 ………… 999', '第3部 架空の未解決'])
  it('inherits the first included descendant page, excludes unresolved targets and uses default style', () => {
    const entries = make(), result = buildTocOutline(entries, levelsFor(entries), optionsFor(entries))
    expect(result.unresolved).toEqual(['toc-5', 'toc-6'])
    expect(flattenOutline(result.items).map(r => r.item.target)).toEqual([26, 26, 26, 28].map(pageIndex => ({ kind: 'page', pageIndex, source: 'dest', view: null })))
    expect(result.items[0]).toMatchObject({ id: 'new:toc-1', open: true, style: { bold: false, italic: false, color: null } })
    expect(result.items[0].children[0].open).toBe(false)
    expect(validateOutlineItems(result.items, 100)).toEqual([])
  })
  it('resolves a heading from its first descendant even when that child is left out, and respects the next sibling boundary', () => {
    const entries = make(), included = new Set(['toc-1', 'toc-2', 'toc-4', 'toc-6'])
    const result = buildTocOutline(entries, levelsFor(entries), { ...optionsFor(entries), included })
    expect(result.items[0].target).toMatchObject({ pageIndex: 26 })
    expect(result.unresolved).toEqual(['toc-6'])
  })
  it('limits depth, promotes children of excluded shapes and omitted checkboxes', () => {
    const entries = make(), levels = levelsFor(entries)
    const limited = buildTocOutline(entries, levels, { ...optionsFor(entries), maxDepth: 2 })
    // Headings above the depth limit still start where their (omitted) children start.
    expect(flattenOutline(limited.items).map(r => [r.item.title, r.item.target.kind === 'page' ? r.item.target.pageIndex : null])).toEqual([['第1部 架空の親', 26], ['第1章 架空の章', 26]])
    expect(limited.unresolved).not.toContain('toc-1')
    const result = buildTocOutline(entries, levels.map((l, i) => i === 1 ? null : l), optionsFor(entries))
    expect(result.items[0].children.map(item => item.title)).toEqual(['1.1 架空の子', '1.2 架空の別の子'])
    const included = new Set(entries.filter(e => e.id !== 'toc-1').map(e => e.id))
    expect(buildTocOutline(entries, levels, { ...optionsFor(entries), included }).items[0].title).toBe('第1章 架空の章')
  })
  it('supports title overrides, with or without labels, and never mutates inputs', () => {
    const entries = make(), before = structuredClone(entries), titles = new Map([['toc-3', '  修正\n名称  ']])
    const result = buildTocOutline(entries, levelsFor(entries), { ...optionsFor(entries), includeLabel: false, titles })
    expect(flattenOutline(result.items).map(r => r.item.title)).toEqual(['架空の親', '架空の章', '修正 名称', '架空の別の子'])
    expect(entries).toEqual(before)
    expect(() => buildTocOutline(entries, levelsFor(entries), { ...optionsFor(entries), includeLabel: false, titles: new Map([['toc-3', '']]) })).toThrow()
  })
  it('does not attach an excluded root’s children to the preceding included root', () => {
    const entries = entriesFor(['第1章 架空 ………… 1', '1.1 架空 ………… 2', '第2章 架空 ………… 3', '2.1 架空 ………… 4'])
    const result = buildTocOutline(entries, levelsFor(entries), { ...optionsFor(entries), included: new Set(['toc-1', 'toc-2', 'toc-4']) })
    expect(result.items).toHaveLength(2)
    expect(result.items[0].children).toHaveLength(1)
    expect(result.items[1].title).toBe('2.1 架空')
  })
  it('limits explicit-page entries by depth and respects zero-based page boundaries', () => {
    const entries = entriesFor(['第1章 架空 ………… 1', '1.1 架空 ………… 2', '第2章 架空 ………… 3'])
    const result = buildTocOutline(entries, levelsFor(entries), { ...optionsFor(entries), offset: -1, pageCount: 2, maxDepth: 1 })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].target).toMatchObject({ pageIndex: 0 })
    expect(result.unresolved).toEqual(['toc-3'])
  })
  it('parses and infers 1,500 synthetic entries within one second', () => {
    const pages = Array.from({ length: 50 }, (_, p) => ({ ...rows(Array.from({ length: 30 }, (_, i) => `${p + 1}.${i + 1} 架空の候補 ………… ${p * 30 + i + 1}`)), pageIndex: p }))
    const started = performance.now(), entries = parseTocEntries(pages), shapes = inferTocShapeLevels(entries)
    const elapsed = performance.now() - started
    console.info(`TOC 1500 entries: ${elapsed.toFixed(2)} ms`)
    expect(entries).toHaveLength(1500); expect(shapes[0].count).toBe(1500); expect(elapsed).toBeLessThan(1000)
  })
})

describe('ルビと目次の見出し', () => {
  it('小さなかなだけのふりがなの行と、ページ内の「目 次」見出しを項目にしない', () => {
    const lines: TocLine[] = [
      { text: '目 次', rect: [260, 80, 330, 94] },
      { text: '第1章 架空の総則 …………………… 1', rect: [60, 120, 550, 132] },
      { text: 'ちゅう', rect: [90, 136, 110, 141] },
      { text: '1.1 架空の厨房機器 ………………… 3', rect: [70, 142, 550, 154] },
      { text: 'ア 架空の桝及び蓋 ………………… 4', rect: [70, 164, 550, 176] },
    ]
    const entries = parseTocEntries([page(lines)])
    expect(entries.map(e => e.title)).toEqual(['架空の総則', '架空の厨房機器', '架空の桝及び蓋'])
    expect(entries.map(e => e.printedNumber)).toEqual([1, 3, 4])
  })
  it('本文と同じ大きさのかなだけの題名は残す', () => {
    expect(entriesFor(['第1章 はじめに …………… 1', 'まとめ …………… 9']).map(e => e.title)).toEqual(['はじめに', 'まとめ'])
  })
})

describe('1文字ずつ空けた題名', () => {
  it('1文字の漢字・かなが続く部分だけを詰める', () => {
    expect(joinSpacedCharacters('適 用')).toBe('適用')
    expect(joinSpacedCharacters('監 督 員 の権限')).toBe('監督員 の権限')
    expect(joinSpacedCharacters('架空設備 改修配置図')).toBe('架空設備 改修配置図')
    expect(joinSpacedCharacters('厨 房機器')).toBe('厨 房機器')
    expect(joinSpacedCharacters('A 1 架空')).toBe('A 1 架空')
    expect(entriesFor(['1.1.1 適　用 ……………… 1']).map(e => e.title)).toEqual(['適用'])
  })
})

describe('numberless TOC columns and detection', () => {
  it('splits headings inside one block before whitespace normalization and joins justified fragments', () => {
    const source = page([
      line('Ⅰ 架空  棟  1. 直', 124, 100, 225), line('接', 235, 100, 245), line('仮', 265, 100, 275), line('設', 296, 100, 306),
      line('2. 土', 204, 130, 230), line('工', 307, 130, 319),
    ])
    const actual = parseTocEntries([source])
    expect(actual.map(e => [e.label, e.title])).toEqual([['Ⅰ', '架空棟'], ['1.', '直接仮設'], ['2.', '土工']])
    expect(actual[1].indent).toBeGreaterThan(actual[0].indent)
    expect(buildTocRows(source)[1].x).toBeCloseTo(124 + 101 * 'Ⅰ 架空  棟  '.length / 'Ⅰ 架空  棟  1. 直'.length)
  })
  it('splits separate numbered columns across a wide gap, but keeps single-space title digits', () => {
    const actual = buildTocRows(page([line('Ⅰ 架空棟', 60, 100, 140), line('1. 架空の室', 200, 100, 300), line('第 2 種とその 3', 60, 140, 300)]))
    expect(actual.map(row => row.text)).toEqual(['Ⅰ 架空棟', '1. 架空の室', '第 2 種とその 3'])
  })
  it('accepts a label-only column fragment followed by its title without splitting off a printed page', () => {
    const actual = buildTocRows(page([
      line('Ⅰ 左側', 60, 100, 140), line('1.', 200, 100, 212), line('架空', 220, 100, 250),
      line('1. 右端の番号 …………', 60, 140, 480), line('12', 540, 140, 550),
    ]))
    expect(actual.map(row => row.text)).toEqual(['Ⅰ 左側', '1. 架空', '1. 右端の番号 ………… 12'])
  })
  it.each(['１．架空', '(1) 架空', '（1）架空', '① 架空', 'Ⅻ 架空', '第2章 架空', '3-1 架空'])('splits a full-width whitespace boundary before %s', heading => {
    expect(buildTocRows(rows([`Ⅰ 左側　　${heading}`])).map(row => row.text)).toEqual(['Ⅰ 左側', heading])
  })
  it.each(['目　次', 'も く じ', 'CONTENTS', 'Contents'])('detects a numberless page headed %s and its consecutive continuation', heading => {
    const toc = { ...rows(Array.from({ length: 10 }, (_, i) => `${i + 1}. 架空の項目`)), lines: [line(heading, 240, 30), ...rows(Array.from({ length: 10 }, (_, i) => `${i + 1}. 架空の項目`)).lines] }
    expect(detectTocPageRange([page([], 0), toc, { ...toc, pageIndex: 2 }, page([], 3), { ...toc, pageIndex: 4 }])).toEqual({ first: 1, last: 2 })
    expect(detectTocPageRange([rows(Array.from({ length: 10 }, (_, i) => `${i + 1}. 架空の項目`))])).toBeNull()
    expect(parseTocEntries([toc])).toHaveLength(10)
  })
  it('requires five lines including the heading, rejects low headings, and prefers the existing printed detection', () => {
    const short = page([line('目次', 240, 30), line('1. 架空'), line('2. 別項目', 60, 140)])
    expect(detectTocPageRange([short])).toBeNull()
    const numbered = { ...rows(Array.from({ length: 5 }, (_, i) => `架空 ………… ${i + 1}`)), pageIndex: 4 }
    const numberless = page([line('目次', 240, 30), ...rows(Array.from({ length: 10 }, (_, i) => `${i + 1}. 架空`)).lines])
    expect(detectTocPageRange([numberless, numbered])).toEqual({ first: 4, last: 4 })
    expect(detectTocPageRange([{ ...numberless, lines: numberless.lines.map(l => l.text === '目次' ? line('目次', 240, 700) : l) }])).toBeNull()
  })
  it('keeps indented unnumbered form names as individual entries in a numberless TOC', () => {
    const entries = entriesFor(['1. 架空の節', '種目別内訳書', '科目別内訳書', '2. 別の節', '種目別内訳書', '科目別内訳書'], [60, 90, 90, 60, 90, 90])
    expect(entries.map(e => e.title)).toEqual(['架空の節', '種目別内訳書', '科目別内訳書', '別の節', '種目別内訳書', '科目別内訳書'])
    expect(levelsFor(entries)).toEqual([1, 2, 2, 1, 2, 2])
  })
})

describe('body heading lookup', () => {
  it('normalizes width, spacing and punctuation, retains middle dots, and adds sufficiently long suffix variants', () => {
    const entry = entriesFor(['1. 架空'])[0]
    expect(tocSearchKeys({ ...entry, title: '〔種　目・ﾍﾞﾂ〕内訳書。' })).toEqual(['種目・ベツ内訳書', '種目・ベツ内訳'])
    for (const suffix of ['書', '表', '編', '等']) expect(tocSearchKeys({ ...entry, title: `架空${suffix}` })).toEqual([`架空${suffix}`, '架空'])
    expect(tocSearchKeys({ ...entry, title: '（一）' })).toEqual([])
    expect(tocSearchKeys({ ...entry, title: '図表' })).toEqual(['図表'])
  })
  it('uses a strict 30 percent threshold and handles empty selections', () => {
    const entries = entriesFor(Array.from({ length: 10 }, (_, i) => `${i + 1}. 架空`))
    expect(tocNeedsBodySearch([])).toBe(false)
    expect(tocNeedsBodySearch(entries)).toBe(true)
    expect(tocNeedsBodySearch(entries.map((e, i) => ({ ...e, printedNumber: i < 3 ? i : null })))).toBe(false)
    expect(tocNeedsBodySearch(entries.map((e, i) => ({ ...e, printedNumber: i < 2 ? i : null })))).toBe(true)
  })
  it('searches twelve synthetic pages forward through repeated forms, excluding margins and common rows', () => {
    const entries = entriesFor(['1. 架空の第一節', '種目別内訳書', '科目別内訳書', '2. 架空の第二節', '種目別内訳書', '科目別内訳書'], [60, 90, 90, 60, 90, 90])
    const headings = new Map([[3, '架空の第一節'], [4, '（種目別内訳）'], [5, '〔科目別内訳〕'], [8, '架空の第二節'], [9, '（種目別内訳）'], [10, '【科目別内訳】']])
    const source = Array.from({ length: 12 }, (_, p) => page([
      line('種目別内訳書 共通の上端', 60, 10), line('架空の共通様式', 60, 85),
      line(headings.get(p + 2) ?? `架空ページ${p}`, 60, 120), line('注記に種目別内訳を含む', 60, 160),
      line('科目別内訳書 共通の下端', 60, 860),
    ], p + 2))
    const body = removeCommonBodyLines(source.map(p => ({ pageIndex: p.pageIndex, lines: bodyPageLines(p) })))
    expect(body.flatMap(p => p.lines).join('')).not.toMatch(/共通|注記/)
    expect(locateTocEntries(entries, body, 2)).toEqual([3, 4, 5, 8, 9, 10])
    const common = { ...entries[0], title: '架空の共通様式' }
    expect(locateTocEntries([common], body, 2)).toEqual([null])
    expect(bodyPageLines({ ...source[0], unreliable: true })).toEqual([])
  })
  it('counts common lines once per page at the 50 percent boundary', () => {
    expect(removeCommonBodyLines([
      { pageIndex: 0, lines: ['架 空', '架 空', '片方だけ', '片方だけ'] },
      { pageIndex: 1, lines: ['架空'] }, { pageIndex: 2, lines: [] }, { pageIndex: 3, lines: [] },
    ])).toEqual([{ pageIndex: 0, lines: ['片方だけ', '片方だけ'] }, { pageIndex: 1, lines: [] }, { pageIndex: 2, lines: [] }, { pageIndex: 3, lines: [] }])
  })
  it('accepts heading labels, only matches a line prefix, includes the same page and keeps the cursor after misses', () => {
    const entries = entriesFor(['1. 直接仮設', '2. 土工', '3. 未掲載', '4. 囲障', '5. 架空・設備'])
    const body = [
      { pageIndex: 1, lines: ['説明の途中に直接仮設', '１．直接仮設'] },
      { pageIndex: 2, lines: ['① 土 工', 'Ⅱ 囲 障', '（架空設備）'] },
      { pageIndex: 3, lines: ['（架空・設備）'] },
    ]
    expect(locateTocEntries(entries, body.slice().reverse(), 1)).toEqual([1, 2, null, 2, 3])
    expect(locateTocEntries(entries.slice(0, 1), body, 2)).toEqual([null])
    expect(locateTocEntries([{ ...entries[0], title: '一' }], body, 1)).toEqual([null])
  })
  it.each(['【１】直接仮設', '〔第２章〕直接仮設', '(1)直接仮設', '3-1.直接仮設', 'II 直接仮設', '①直接仮設'])('strips the body heading marker in %s', text => {
    expect(locateTocEntries(entriesFor(['1. 直接仮設']), [{ pageIndex: 4, lines: [text] }], 2)).toEqual([4])
  })
  it('uses explicit PDF pages and resolves a missing parent from its first child, included or not', () => {
    const entries = entriesFor(['第1章 架空 ………… 1', '(1) 架空の子 ………… 2', '(2) 別の子 ………… 3', '第2章 終端 ………… 4'])
    const options = optionsFor(entries), levels = [1, 2, 2, 1]
    const original = buildTocOutline(entries, levels, options)
    expect(flattenOutline(original.items).map(({ item }) => item.target?.kind === 'page' ? item.target.pageIndex : null)).toEqual([26, 27, 28, 29])
    const resolved = buildTocOutline(entries, levels, { ...options, pages: [null, 5, 7, null] })
    expect(flattenOutline(resolved.items).map(({ item }) => item.target?.kind === 'page' ? item.target.pageIndex : null)).toEqual([5, 5, 7])
    expect(resolved.unresolved).toEqual([entries[3].id])
    expect(buildTocOutline(entries, levels, { ...options, pages: [null, 5, 7, null], included: new Set([entries[0].id, entries[2].id]) }).items[0].target).toMatchObject({ pageIndex: 5 })
  })
})

describe('SPEC-O6b numberless TOC precision (fictional data only)', () => {
  it('excludes the title above the TOC, both margins and a right-aligned publisher, retaining the second column', () => {
    const toc = page([
      line('架空書式集（改定版）', 60, 12), line('架空標準書式（例示編）', 60, 80), line('目次', 240, 105),
      line('1. 架空第一節', 60, 150, 150), line('2. 架空第二節', 210, 150, 310),
      line('3. 架空第三節', 60, 180), line('4. 架空第四節', 60, 210),
      line('架空局発行部', 410, 800), line('架空の下端欄外', 60, 860),
    ])
    expect(detectTocPageRange([toc])).toEqual({ first: 1, last: 1 })
    expect(parseTocEntries([toc]).map(e => e.title)).toEqual(['架空第一節', '架空第二節', '架空第三節', '架空第四節'])
    const onlyNoiseAndTwoEntries = { ...toc, lines: toc.lines.filter(l => !/[34]\. 架空/.test(l.text)) }
    expect(detectTocPageRange([onlyNoiseAndTwoEntries])).toBeNull()
    expect(detectTocPageRange([toc, { ...onlyNoiseAndTwoEntries, pageIndex: 2 }])).toEqual({ first: 1, last: 1 })
  })

  it('applies the new exclusions only to numberless TOCs, even with printed titles in the margins', () => {
    const toc = page([
      line('第1章 架空上端 ………… 1', 60, 15), line('目次', 240, 80),
      line('第2章 架空本文 ………… 2', 60, 130), line('第3章 架空右端 ………… 3', 400, 180),
      line('第4章 架空下端 ………… 4', 60, 860), line('第5章 架空終端 ………… 5', 60, 240),
    ])
    expect(isTocLikePage(toc)).toBe(true)
    expect(parseTocEntries([toc]).map(e => e.printedNumber)).toEqual([1, 2, 3, 5, 4])
  })

  it('joins widely spaced title fragments and splits only a right side with a label and title', () => {
    const toc = page([
      line('11. 架', 210, 100, 240), line('空', 285, 100, 297), line('品', 340, 100, 352),
      line('12. タ', 210, 140, 240), line('イ', 285, 140, 297), line('ル', 340, 140, 352),
      line('13. 左の題名', 60, 180, 150), line('ア. 架空の項目', 210, 180, 310),
      line('1. 1. 1', 60, 220, 110), line('架空の題名', 210, 220, 300),
      line('14. 題名', 60, 260, 130), line('イ', 210, 260, 222),
    ])
    const entries = parseTocEntries([toc])
    expect(entries.map(e => [e.label, e.title])).toEqual([
      ['11.', '架空品'], ['12.', 'タイル'], ['13.', '左の題名'], ['ア.', '架空の項目'], ['1.1.1', '架空の題名'], ['14.', '題名イ'],
    ])
    expect(entries.every(e => e.title.length > 0)).toBe(true)
    expect(buildTocRows(rows(['11. 架  空  品', '12. タ  イ  ル'])).map(r => r.text)).toEqual(['11. 架  空  品'.replace(/\s+/g, ' '), '12. タ イ ル'])
    expect(buildTocRows(page([line('1. 左の題名', 60, 100, 140), line('A', 210, 100, 222)]))).toHaveLength(1)
  })

  it.each(['ア.架空', 'ア．架空', 'ア、架空', 'ア)架空', 'ア）架空', 'ア 架空'])('recognizes the kana marker in %s', text => {
    expect(splitTocLabel(text)).toMatchObject({ title: '架空' })
    expect(splitTocLabel(text).label).not.toBeNull()
  })
  it.each(['イ', 'イ ル', 'イ・架空'])('keeps %s as a title rather than a kana marker', text => {
    expect(splitTocLabel(text)).toEqual({ label: null, title: text })
  })

  it('selects standalone form headings in two sections and children in their own form rather than an earlier form', () => {
    const section = (n: number) => [`第${n}節 架空第${n}節`, '架空別内訳書', '科空別内訳書', '中空別内訳書', '細空別内訳書', 'Ⅰ 架空の棟', '1. 仮設設備', '10. 石', '12. 木']
    const entries = entriesFor([...section(1), ...section(2)], Array(2).fill([60, 90, 90, 90, 90, 120, 150, 150, 150]).flat())
    const source: TocPageText[] = [page([
      line('(1) 架空別内訳書', 60, 110), line('(2) 科空別内訳書', 60, 140),
      line('(3) 中空別内訳書', 60, 170), line('(4) 細空別内訳書', 60, 200),
    ], 2)]
    for (let n = 1; n <= 2; n++) {
      const start = n === 1 ? 3 : 13
      source.push(page([line(`第${n}節 架空第${n}節`, 60, 100)], start))
      for (const [i, name] of ['架空', '科空', '中空', '細空'].entries()) {
        source.push(page([line(`（${name}別内訳）`, 60, 100), ...(i >= 2 ? [
          line('Ⅰ 架空の棟', 60, 130), line('1 ．仮設設備', 60, 160), line('10 ．石', 60, 190), line('12 ．木', 60, 220),
        ] : [])], start + i + 1))
      }
    }
    const found = locateTocEntries(entries, removeCommonBodyLines(source.map(bodyPageEntries)), 2)
    expect(found).toEqual([3, 4, 5, 6, 7, 7, 7, 7, 7, 13, 14, 15, 16, 17, 17, 17, 17, 17])
    expect(buildTocOutline(entries, [1, 2, 2, 2, 2, 3, 4, 4, 4, 1, 2, 2, 2, 2, 3, 4, 4, 4], {
      ...optionsFor(entries), pages: found,
    }).unresolved).toEqual([])
  })

  it('matches a one-character title only as a complete heading after removing its marker', () => {
    const entries = entriesFor(['10. 石', '12. 木'])
    expect(tocSearchKeys(entries[0])).toEqual(['石'])
    expect(locateTocEntries(entries, [
      { pageIndex: 2, lines: ['10 ．石綿', '石に関する説明', '説明の途中の石'] },
      { pageIndex: 3, lines: ['10 ．石'] }, { pageIndex: 4, lines: ['12 ．木'] },
    ], 2)).toEqual([3, 4])
    expect(locateTocEntries(entries.slice(0, 1), [{ pageIndex: 2, lines: ['10 ．石綿'] }], 2)).toEqual([null])
  })

  it('extracts positions relative to the body and preserves alignment after removing common lines', () => {
    const first = bodyPageEntries(page([
      line('欄外', 60, 20), line('共通の行', 60, 90), line('固有の見出し', 60, 180), line('下端', 60, 860),
    ], 2))
    expect(first.lines).toEqual(['共通の行', '固有の見出し'])
    expect(first.positions?.[0]).toBeCloseTo((.1 - .05) / .9)
    expect(first.positions?.[1]).toBeCloseTo((.2 - .05) / .9)
    const cleaned = removeCommonBodyLines([first, { pageIndex: 3, lines: ['共通の行'], positions: [.1] }, { pageIndex: 4, lines: [], positions: [] }])
    expect(cleaned[0]).toEqual({ pageIndex: 2, lines: ['固有の見出し'], positions: [first.positions![1]] })
    expect(bodyPageEntries({ ...page([]), unreliable: true })).toEqual({ pageIndex: 1, lines: [], positions: [] })
  })

  it('scores position, standalone length, enclosing brackets and matching marker independently, using the best line per page', () => {
    const entry = entriesFor(['1. 架空見出し'])
    const cases: TocBodyPage[][] = [
      [{ pageIndex: 1, lines: ['架空見出し'], positions: [.21] }, { pageIndex: 2, lines: ['架空見出し'], positions: [.2] }],
      [{ pageIndex: 1, lines: ['架空見出しに続く長い説明'] }, { pageIndex: 2, lines: ['架空見出し'] }],
      [{ pageIndex: 1, lines: ['架空見出し'] }, { pageIndex: 2, lines: ['（架空見出し）'] }],
      [{ pageIndex: 1, lines: ['2 ．架空見出し'] }, { pageIndex: 2, lines: ['1 ．架空見出し'] }],
      [{ pageIndex: 1, lines: ['架空見出し', '架空見出し', '架空見出し'] }, { pageIndex: 2, lines: ['（架空見出し）', '架空見出しに続く長い説明'] }],
    ]
    for (const body of cases) expect(locateTocEntries(entry, body, 1)).toEqual([2])
  })

  it('maximizes total score rather than choosing each local maximum or the first hit', () => {
    const entries = entriesFor(['架空甲', '架空乙'])
    expect(locateTocEntries(entries, [
      { pageIndex: 1, lines: ['架空甲'] }, { pageIndex: 2, lines: ['（架空乙）'], positions: [.1] },
      { pageIndex: 3, lines: ['（架空甲）'], positions: [.1] }, { pageIndex: 4, lines: ['架空乙を含む説明'] },
    ], 1)).toEqual([1, 2])
    expect(locateTocEntries(entries, [
      { pageIndex: 1, lines: ['架空甲を含む説明'] }, { pageIndex: 2, lines: ['架空乙を含む説明'] },
      { pageIndex: 3, lines: ['（架空甲）'], positions: [.1] }, { pageIndex: 4, lines: ['（架空乙）'], positions: [.1] },
    ], 1)).toEqual([3, 4])
  })

  it('breaks ties by found count, then earliest pages including unresolved choices', () => {
    const entries = entriesFor(['架空甲', '架空乙'])
    expect(locateTocEntries(entries, [
      { pageIndex: 1, lines: ['架空甲'] }, { pageIndex: 2, lines: ['架空乙'] },
      { pageIndex: 3, lines: ['架空甲'], positions: [.1] },
    ], 1)).toEqual([1, 2])
    expect(locateTocEntries(entries, [{ pageIndex: 2, lines: ['架空乙'] }, { pageIndex: 3, lines: ['架空甲'] }], 1)).toEqual([3, null])
    expect(locateTocEntries(entries, [
      { pageIndex: 1, lines: ['架空甲', '架空乙'] }, { pageIndex: 2, lines: ['架空甲', '架空乙'] },
    ], 1)).toEqual([1, 1])
    expect(locateTocEntries(entries, [], 1)).toEqual([null, null])
    expect(locateTocEntries([], [], 1)).toEqual([])
  })

  it('leaves a late parent unresolved and lets the outline use its first child', () => {
    const entries = entriesFor(['1. 架空親', '1.1 架空子'])
    const found = locateTocEntries(entries, [
      { pageIndex: 2, lines: ['（架空子）'], positions: [.1] }, { pageIndex: 3, lines: ['架空親'] },
    ], 1)
    expect(found).toEqual([null, 2])
    expect(flattenOutline(buildTocOutline(entries, [1, 2], { ...optionsFor(entries), pages: found }).items)
      .map(({ item }) => item.target?.kind === 'page' ? item.target.pageIndex : null)).toEqual([2, 2])
  })

  it('locates 1,200 entries across 400 pages with five candidate pages each in under one second', () => {
    // Avoid parsing a physically impossible 1,200-row TOC page in this lookup-only benchmark.
    const template = entriesFor(['架空項目'])[0]
    const entries = Array.from({ length: 1200 }, (_, i) => ({ ...template, id: `synthetic-${i}`, title: `架空項目${String(i).padStart(4, '0')}` }))
    const pages: TocBodyPage[] = Array.from({ length: 400 }, (_, i) => ({ pageIndex: i + 2, lines: [], positions: [] }))
    entries.forEach((entry, i) => {
      for (let offset = -2; offset <= 2; offset++) {
        const p = (Math.floor(i / 3) + offset + 400) % 400
        pages[p].lines.push(offset === 0 ? `（${entry.title}）` : `${entry.title}についての長い説明です`)
        pages[p].positions!.push(offset === 0 ? .1 : .5)
      }
    })
    const start = performance.now()
    const found = locateTocEntries(entries, pages, 2)
    const elapsed = performance.now() - start
    console.info(`SPEC-O6b: 1200 entries / 400 pages / 6000 candidates: ${elapsed.toFixed(1)} ms`)
    expect(found).toEqual(entries.map((_, i) => Math.floor(i / 3) + 2))
    expect(elapsed).toBeLessThan(1000)
  })
})

describe('本文の欄外の範囲', () => {
  it('上端 4% の共通の題名は除き、7.5% から始まる書式名は残す', () => {
    const body = bodyPageEntries(page([
      line('架空の標準書式（架空編）', 300, 30), line('（架空別内訳）', 60, 67), line('1．架空の項目', 60, 200),
    ]))
    expect(body.lines).toEqual(['（架空別内訳）', '1．架空の項目'])
  })
})

describe('同じ番号の形でも字下げで段を分ける', () => {
  it('左端の「1.」と、2 列目の「1.」を別の段にする', () => {
    const entries = parseTocEntries([page([
      line('目 次', 260, 60), line('1. 架空の構成', 30, 120, 200), line('2. 架空の内容', 30, 140, 200),
      line('Ⅰ 架空棟', 120, 160, 190), line('1. 架空工', 230, 160, 340), line('2. 架空業', 230, 180, 340),
    ])])
    const shapes = inferTocShapeLevels(entries), keys = tocEntryShapeKeys(entries)
    const level = (title: string) => shapes.find(s => s.shape === keys[entries.findIndex(e => e.title === title)])!.level!
    expect(level('架空の構成')).toBeLessThan(level('架空棟'))
    expect(level('架空棟')).toBeLessThan(level('架空工'))
    expect(level('架空の構成')).toBe(level('架空の内容'))
  })
})
