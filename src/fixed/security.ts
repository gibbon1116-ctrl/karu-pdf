export function blocksFixedStartup(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host === 'github.io' || host.endsWith('.github.io')
}

export function fixedAssetUrl(asset: string, origin: string, base: string): URL {
  if (!base.startsWith('/') || !base.endsWith('/') || base.includes('//') || /[?#\\]/.test(base)) {
    throw new Error('固定版の配布パスが不正です。')
  }
  const root = new URL(base, origin)
  const url = new URL(asset, root)
  // URL normalisation resolves traversal before the boundary comparison.
  if (root.origin !== origin || root.pathname !== base || url.origin !== origin || !url.pathname.startsWith(base)
    || url.search || url.hash || /%2f|%5c|%2e/i.test(url.pathname)) {
    throw new Error('配布パスの外から取得することはできません。')
  }
  return url
}
