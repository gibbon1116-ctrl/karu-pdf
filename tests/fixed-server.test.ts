import { once } from 'node:events'
import { expect, it } from 'vitest'
import { createFixedServer } from '../scripts/serve-fixed.mjs'
import { CSP, SECURITY_HEADERS } from '../scripts/fixed-policy.mjs'

it('実際の HTTP 応答で CSP、MIME、キャッシュ、配布パスを確認する', async () => {
  const server = createFixedServer(undefined, '/karu-pdf/')
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address')
  const root = `http://127.0.0.1:${address.port}`
  try {
    // public is the existing static tree, so tests work before a fixed build.
    const staticServer = createFixedServer('public', '/karu-pdf/')
    staticServer.listen(0, '127.0.0.1'); await once(staticServer, 'listening')
    const addr = staticServer.address(); if (!addr || typeof addr === 'string') throw new Error('No address')
    try {
      const response = await fetch(`http://127.0.0.1:${addr.port}/karu-pdf/fonts/BIZUDGothic-Regular.ttf`, { method: 'HEAD' })
      expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('font/ttf')
      for (const [key, value] of Object.entries(SECURITY_HEADERS)) expect(response.headers.get(key)).toBe(value)
      expect(response.headers.get('cache-control')).toBe('no-cache'); expect(response.headers.get('content-security-policy')).toBe(CSP)
    } finally { await new Promise<void>(resolve => staticServer.close(() => resolve())) }
    expect((await fetch(root + '/')).status).toBe(404)
    expect((await fetch(root + '/karu-pdf/', { method: 'POST', body: 'secret' })).status).toBe(404)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
