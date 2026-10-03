import type { AnnotationStore, EditableAnnotation } from '../editor/AnnotationStore'

export function IssueDetails({ annotation, store, readOnly, onClose }: {
  annotation: EditableAnnotation; store: AnnotationStore; readOnly: boolean; onClose(): void
}) {
  const issue = annotation.issue!
  return <fieldset className="issue-details" disabled={readOnly}>
    <legend>指摘 {issue.number} の詳細</legend>
    <label>分野<input aria-label="指摘の分野" maxLength={200} defaultValue={issue.discipline ?? ''} placeholder="建築・電気・機械など"
      onChange={event => store.updateIssueDetails(annotation.id, { discipline: event.currentTarget.value })} /></label>
    <label>図面番号<input aria-label="指摘の図面番号" maxLength={200} defaultValue={issue.drawingNumber ?? ''}
      onChange={event => store.updateIssueDetails(annotation.id, { drawingNumber: event.currentTarget.value })} /></label>
    <label>回答<textarea aria-label="指摘の回答" rows={3} maxLength={8000} defaultValue={issue.answer ?? ''}
      onChange={event => store.updateIssueDetails(annotation.id, { answer: event.currentTarget.value })} /></label>
    <label>修正確認<textarea aria-label="指摘の修正確認" rows={3} maxLength={8000} defaultValue={issue.verification ?? ''}
      onChange={event => store.updateIssueDetails(annotation.id, { verification: event.currentTarget.value })} /></label>
    <p>PDF保存で詳細も保存します。</p>
    {issue.status === 'done' && <p>旧版の対応済です。修正の確認後に「確認済」へ変更してください。</p>}
    {issue.sourceDocument && <p>引継ぎ元：{issue.sourceDocument}</p>}
    <button type="button" onClick={onClose}>詳細を閉じる</button>
  </fieldset>
}
