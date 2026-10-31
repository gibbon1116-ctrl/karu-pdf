import type { AnnotationStore, EditableAnnotation } from '../editor/AnnotationStore'

export function IssueDetails({ annotation, store, readOnly, onClose }: {
  annotation: EditableAnnotation; store: AnnotationStore; readOnly: boolean; onClose(): void
}) {
  const issue = annotation.issue!
  return <div><fieldset className="issue-details" disabled={readOnly}>
    <legend>指摘 {issue.number} の詳細</legend>
    <label>分野<input aria-label="指摘の分野" list="issue-disciplines" maxLength={200} value={issue.discipline ?? ''} placeholder="選択または自由入力"
      onChange={event => store.updateIssueDetails(annotation.id, { discipline: event.currentTarget.value })} /></label>
    <datalist id="issue-disciplines">{['建築', '構造', '電気', '機械', '外構', 'その他'].map(value => <option key={value} value={value} />)}</datalist>
    <label>図面番号<input aria-label="指摘の図面番号" maxLength={200} value={issue.drawingNumber ?? ''}
      onChange={event => store.updateIssueDetails(annotation.id, { drawingNumber: event.currentTarget.value })} /></label>
    <label>回答<textarea aria-label="指摘の回答" rows={3} maxLength={8000} value={issue.answer ?? ''}
      onChange={event => store.updateIssueDetails(annotation.id, { answer: event.currentTarget.value })} /></label>
    <label>修正確認<textarea aria-label="指摘の修正確認" rows={3} maxLength={8000} value={issue.verification ?? ''}
      onChange={event => store.updateIssueDetails(annotation.id, { verification: event.currentTarget.value })} /></label>
    <p>PDF保存で詳細も保存します。</p>
    {(issue.status === 'done' || issue.status === 'revised') && <p>旧版で「対応済」または「修正済」とした指摘です。修正を確認したら「修正確認」にしてください。</p>}
    {issue.sourceDocument && <p>引継ぎ元：{issue.sourceDocument}{issue.sourceNumber ? `（指摘 ${issue.sourceNumber}）` : ''}</p>}
  </fieldset><button type="button" onClick={onClose}>詳細を閉じる</button></div>
}
