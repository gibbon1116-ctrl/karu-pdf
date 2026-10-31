import type { XlsxCell, XlsxSheet, XlsxStyle } from '../core/xlsxWriter'

export interface RelatedReviewRow {
  status:
    | '未判断'
    | '後で確認'
    | '必要'
    | '不要'
    | '単価包含'
    | '他工事'
    | '構成要素で拾う'
    | '確認した'
    | '選択済み'
    | '注意'
  origins: string
  target: string
  kind: '拾い候補' | '確認事項' | '注意'
  question: string
  assignee: string
  reason: string
  ruleIds: string
  refs: string
  decidedAt: string
}

const HEADERS = [
  '状態',
  '起点の項目（略号・名称）',
  '提案品目',
  '種類',
  '確認事項',
  '担当',
  '理由',
  'ルールID',
  '根拠資料（記号：資料名）',
  '判断日時',
]

function cell(value: string, style: XlsxStyle = 'text'): XlsxCell {
  return { value, style }
}

export function relatedReviewStatusOrder(status: RelatedReviewRow['status']): number {
  return status === '未判断' ? 0
    : status === '後で確認' ? 1
      : status === '選択済み' ? 3
        : status === '注意' ? 4 : 2
}

/** 入力を変更せず、同じ状態区分の中では入力順を保持する。 */
export function relatedReviewSheet(rows: RelatedReviewRow[]): XlsxSheet {
  const sorted = rows.map((row, index) => ({ row, index }))
    .sort((a, b) =>
      relatedReviewStatusOrder(a.row.status) - relatedReviewStatusOrder(b.row.status)
      || a.index - b.index)
  const cells: XlsxCell[][] = [
    [cell('関連候補の確認', 'title')],
    [cell('提案は拾い漏れの確認用で、別途計上の根拠ではありません')],
    [],
    HEADERS.map(value => cell(value, 'header')),
    ...sorted.map(({ row }) => [
      row.status,
      row.origins,
      row.target,
      row.kind,
      row.question,
      row.assignee,
      row.reason,
      row.ruleIds,
      row.refs,
      row.decidedAt,
    ].map(value => cell(value, 'borderedText'))),
  ]
  return {
    name: '関連候補の確認',
    cells,
    merges: [
      { firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: 9 },
      { firstRow: 1, firstColumn: 0, lastRow: 1, lastColumn: 9 },
    ],
    columnWidths: [14, 38, 38, 14, 66, 16, 40, 24, 66, 26],
    rowHeights: { 0: 24, 1: 30, 2: 10, 3: 30 },
    freeze: { rows: 4, columns: 2 },
  }
}
