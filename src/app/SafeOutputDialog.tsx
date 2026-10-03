import { useEffect, useRef, useState } from 'react'
import type { RedactionRegion } from '../core/safeOutput'

export function SafeOutputDialog({ regions, busy, error, onSave, onClose }: { regions: readonly RedactionRegion[]; busy: boolean; error: string; onSave(redact: boolean): void; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null), [redact, setRedact] = useState(false)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className="utility-dialog" aria-label="共有・提出用に保存" onCancel={event => { if (busy) event.preventDefault(); else onClose() }}>
    <h1>共有・提出用に保存</h1>
    <p>文書情報、添付ファイル、リンク、実行アクション、以前の保存履歴を引き継がず、別名で保存します。書き込みとフォームは見た目を確定し、編集できなくなります。</p>
    <label><input type="checkbox" checked={redact} disabled={busy || !regions.length} onChange={event => setRedact(event.target.checked)} />選択中の四角 {regions.length}個の内側を墨消しする</label>
    <p>墨消しするには、この画面を閉じて図形の「四角」で範囲を囲み、枠を選択してから開いてください。通常の四角や白塗りの保存では情報は消去されません。</p>
    {redact && <p>対象ページ: {[...new Set(regions.map(region => region.pageIndex + 1))].join(', ')}。範囲に触れる文字・画像・線を除去します。長い線や図形が枠の外まで消える場合があります。</p>}
    <p>枠外の本文や図形は残ります。出力後、提出前に目視で確認してください。元の編集文書は保持します。</p>
    <p>PDF内に既存の墨消しマークがある場合も適用します。</p>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy} onClick={onClose}>閉じる</button>
    <button disabled={busy} onClick={() => onSave(redact)}>{busy ? '処理中…' : redact ? '墨消しを適用して別名保存' : '共有用に別名保存'}</button>
  </dialog>
}
