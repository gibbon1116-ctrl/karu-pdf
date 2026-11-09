import { describe, expect, it } from 'vitest'
import { mergeSupplementCandidates, zeroResultReason, type SymbolSearchDiagnostics } from '../src/core/symbolSearchDiagnostics'

const base: SymbolSearchDiagnostics = { pageIndex: 0, method: 'vector', ms: { total: 0 } }
const empty = { total: 0, visible: 0, rejected: 0 }

describe('検索診断', () => {
  it('表示中の候補があれば原因を出さない', () => {
    expect(zeroResultReason(base, { total: 2, visible: 1, rejected: 1 })).toBeNull()
  })
  it('表示条件で隠れた候補（構造除外以外）を最優先で案内する', () => {
    expect(zeroResultReason({ ...base, structureExcluded: 1 }, { total: 2, visible: 0, rejected: 1 }))
      .toBe('候補はありますが、現在の表示条件では表示されていません（添字・GC回路・拾い済みなどの絞り込みを確かめてください）')
  })
  it('隠れているのが構造除外の候補だけなら、構造除外として案内する', () => {
    expect(zeroResultReason({ ...base, structureExcluded: 1 }, { total: 1, visible: 0, rejected: 1 }))
      .toBe('候補はありましたが、描画構造（塗り・内部の線）の照合で除外されました。「描画構造で除外した候補も表示する」で確認できます')
  })
  it('構造除外の実候補または診断件数から案内する', () => {
    const message = '候補はありましたが、描画構造（塗り・内部の線）の照合で除外されました。「描画構造で除外した候補も表示する」で確認できます'
    expect(zeroResultReason(base, { ...empty, rejected: 1 })).toBe(message)
    expect(zeroResultReason({ ...base, structureExcluded: 1 }, empty)).toBe(message)
  })
  it('画像のみの検索を案内する', () => {
    expect(zeroResultReason({ ...base, method: 'image', geometrySites: 0, widthFilteredSegments: 0 }, empty))
      .toBe('画像で探しましたが、見本と同じ形は見つかりませんでした（このページには線の情報がありません）')
  })
  it('太さが合う線がないときに案内する', () => {
    expect(zeroResultReason({ ...base, geometrySites: 0, widthFilteredSegments: 0 }, empty))
      .toBe('見本の線の太さに合う線がこのページにありません（細い線は探しません）')
  })
  it('その他は幾何形状がなかったと案内し未集計をゼロとみなさない', () => {
    expect(zeroResultReason(base, empty)).toBe('見本と同じ幾何形状の候補が見つかりませんでした')
    expect(zeroResultReason({ ...base, geometrySites: 0, widthFilteredSegments: 10 }, empty)).toBe(zeroResultReason(base, empty))
  })
})

describe('補完候補の中心距離による重複除去', () => {
  it('距離ちょうどまでを除外し少し外は残す', () => {
    const base = [{ center: [0, 0] }], extra = [{ center: [3, 4] }, { center: [3, 4.0001] }, { center: [0, 0] }]
    expect(mergeSupplementCandidates(base, extra, 5)).toEqual({ added: [extra[1]], duplicates: 2 })
    expect(extra).toHaveLength(3)
    expect(base).toEqual([{ center: [0, 0] }])
  })
  it('補完候補同士はこの関数では削除しない', () => {
    const extra = [{ center: [10, 10] }, { center: [10, 10] }]
    expect(mergeSupplementCandidates([], extra, 5)).toEqual({ added: extra, duplicates: 0 })
  })
})
