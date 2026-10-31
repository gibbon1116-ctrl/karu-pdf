export function FixedAbout() {
  return <>
    <p>版 {__FIXED_BUILD__.version}</p>
    <p>ビルドの日付: {__FIXED_BUILD__.buildDate}</p>
    <p title={__FIXED_BUILD__.gitCommit}>コミット: {__FIXED_BUILD__.gitShort} ({__FIXED_BUILD__.gitCommit})</p>
    <p>ソース: {__FIXED_BUILD__.sourceDirty ? '未コミット変更を含む検証版' : 'コミット済み'} / {__FIXED_BUILD__.sourceHash?.slice(0, 12)}</p>
    <p>配布形態: 固定・閉域版</p>
    <p>外部通信: 使用しない</p>
    <p>更新方式: 管理者による手動更新</p>
  </>
}
