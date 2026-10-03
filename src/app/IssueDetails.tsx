import type { AnnotationStore, EditableAnnotation } from '../editor/AnnotationStore'

export function IssueDetails({ annotation, store, readOnly, onClose, relatedIssues, onNavigate }: {
  annotation: EditableAnnotation; store: AnnotationStore; readOnly: boolean; onClose(): void; relatedIssues: readonly EditableAnnotation[]; onNavigate(a: EditableAnnotation): void
}) {
  const issue = annotation.issue!
  return <div><fieldset className="issue-details" disabled={readOnly}>
    <legend>{issue.recordKind === 'change' ? '変更' : '指摘'} {issue.number} の詳細</legend>
    {issue.recordKind === 'change' && <>
      <label>変更理由<textarea aria-label="変更理由" rows={3} maxLength={8000} value={issue.changeReason ?? ''}
        onChange={event => store.updateIssueDetails(annotation.id, { changeReason: event.currentTarget.value })} /></label>
      <label>関連指摘ID<input aria-label="関連指摘ID" maxLength={200} value={issue.relatedIssueId ?? ''}
        onChange={event => store.updateIssueDetails(annotation.id, { relatedIssueId: event.currentTarget.value })} /></label>
      <label>関連指摘を選ぶ<select aria-label="関連指摘を選ぶ" value={issue.relatedIssueId ?? ''} onChange={event => store.updateIssueDetails(annotation.id, { relatedIssueId: event.currentTarget.value })}>
        <option value="">指定なし</option>{relatedIssues.filter(a=>a.issue?.id && a.issue.recordKind !== 'change').slice(0,200).map(a=><option key={a.id} value={a.issue!.id}>指摘 {a.issue!.number}: {a.text.slice(0,40)}</option>)}
      </select></label>
      {!!issue.relatedIssueId && <button type="button" onClick={()=>{ const a=relatedIssues.find(a=>a.issue?.id === issue.relatedIssueId); if(a)onNavigate(a) }}>関連指摘を見る</button>}
    </>}
    <small>指摘ID: {issue.id || '詳細を編集すると作成されます'}</small>
    <label>分野<input aria-label="指摘の分野" maxLength={200} value={issue.discipline ?? ''} placeholder="建築・電気・機械など"
      onChange={event => store.updateIssueDetails(annotation.id, { discipline: event.currentTarget.value })} /></label>
    <label>図面番号<input aria-label="指摘の図面番号" maxLength={200} value={issue.drawingNumber ?? ''}
      onChange={event => store.updateIssueDetails(annotation.id, { drawingNumber: event.currentTarget.value })} /></label>
    <label>回答<textarea aria-label="指摘の回答" rows={3} maxLength={8000} value={issue.answer ?? ''}
      onChange={event => store.updateIssueDetails(annotation.id, { answer: event.currentTarget.value })} /></label>
    <label>修正確認<textarea aria-label="指摘の修正確認" rows={3} maxLength={8000} value={issue.verification ?? ''}
      onChange={event => store.updateIssueDetails(annotation.id, { verification: event.currentTarget.value })} /></label>
    <p>PDF保存で詳細も保存します。</p>
    {issue.status === 'done' && <p>旧版の対応済です。修正の確認後に「確認済」へ変更してください。</p>}
    {issue.sourceDocument && <p>引継ぎ元：{issue.sourceDocument}</p>}
  </fieldset><button type="button" onClick={onClose}>詳細を閉じる</button></div>
}
