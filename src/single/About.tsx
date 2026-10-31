declare const __SINGLE_BUILD__: { version: string; buildDate: string; gitCommit: string; gitShort: string; sourceHash: string; sourceDirty: boolean }
export function SingleAbout() {
  return <>
    <p>版 {__SINGLE_BUILD__.version}</p>
    <p>ビルドの日付: {__SINGLE_BUILD__.buildDate}</p>
    <p>コミット: {__SINGLE_BUILD__.gitShort} ({__SINGLE_BUILD__.gitCommit})</p>
    <p>ソース: {__SINGLE_BUILD__.sourceDirty ? '未コミット変更を含む検証版' : 'コミット済み'} / {__SINGLE_BUILD__.sourceHash?.slice(0, 12)}</p>
    <p>配布形態: HTML ファイル1つの版（固定・閉域）</p>
    <p>外部通信: 使用しない（CSP で禁止）</p>
    <p>更新方式: ファイルの差し替え</p>
  </>
}
