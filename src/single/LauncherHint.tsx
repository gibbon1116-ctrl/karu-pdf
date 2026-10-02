import { useState } from 'react'

const key = 'karu-single-hide-launcher-hint'
export function LauncherHint() {
  const [visible, setVisible] = useState(() => {
    // Edge's --app window reports standalone even when toolbar.visible is true.
    if (window.matchMedia('(display-mode: standalone)').matches || window.toolbar?.visible !== true) return false
    try { return localStorage.getItem(key) !== '1' } catch { return true }
  })
  if (!visible) return null
  return <aside data-testid="launcher-hint" style={{ fontSize: '0.85rem', color: '#555', maxWidth: '38rem' }}>
    <p>専用の窓で開くには、同じフォルダの「かるPDFを開く.cmd」か、デスクトップのショートカットを使ってください。</p>
    <button type="button" onClick={() => {
      try { localStorage.setItem(key, '1') } catch { /* Hiding still works for this session. */ }
      setVisible(false)
    }}>今後表示しない</button>
  </aside>
}
