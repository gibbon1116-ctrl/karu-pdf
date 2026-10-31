export function PagesAbout() {
  return <p title={__PAGES_BUILD__.gitCommit}>版 {__PAGES_BUILD__.version}（{__PAGES_BUILD__.gitShort}）</p>
}
