import { describe, expect, it } from 'vitest'
import { blocksFixedStartup, fixedAssetUrl } from '../src/fixed/security'

describe('固定版の境界', () => {
  it('GitHub Pages のホストだけで起動を止める', () => {
    for (const host of ['github.io', 'user.github.io', 'USER.GITHUB.IO.', 'a.b.github.io']) expect(blocksFixedStartup(host)).toBe(true)
    for (const host of ['localhost', '127.0.0.1', 'internal.example', 'github.io.example', 'mygithub.io']) expect(blocksFixedStartup(host)).toBe(false)
  })
  it('origin と配布パスの境界を検査し、余分なスラッシュを作らない', () => {
    const origin = 'https://internal.example'
    expect(fixedAssetUrl('fonts/a.ttf', origin, '/karu-pdf/').href).toBe(origin + '/karu-pdf/fonts/a.ttf')
    expect(fixedAssetUrl('fonts/a.ttf', origin, '/').pathname).toBe('/fonts/a.ttf')
    for (const asset of ['https://external.example/a', '//external.example/a', '../a.ttf', '/karu-pdf-evil/a.ttf', 'fonts/%2fsecret', 'fonts/%2e%2e/../secret', 'fonts/a.ttf?secret=x', 'fonts/a.ttf#x']) {
      expect(() => fixedAssetUrl(asset, origin, '/karu-pdf/')).toThrow()
    }
    for (const base of ['karu-pdf/', '/karu-pdf', '//evil/', '/a/../', '/a\\/', '/a/?x/']) expect(() => fixedAssetUrl('a', origin, base)).toThrow()
  })
})
