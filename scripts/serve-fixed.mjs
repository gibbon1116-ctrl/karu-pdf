import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { SECURITY_HEADERS } from './fixed-policy.mjs'
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.ttf': 'font/ttf', '.png': 'image/png', '.json': 'application/json' }
export function createFixedServer(root = path.resolve('dist-fixed'), base = '/karu-pdf/') {
  return createServer(async (req, res) => {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value)
    res.setHeader('Cache-Control', 'no-cache')
    try {
      const url = new URL(req.url, 'http://localhost')
      if (!['GET', 'HEAD'].includes(req.method) || !url.pathname.startsWith(base)) { res.writeHead(404); res.end(); return }
      const relative = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html'
      if (relative.includes('\\') || relative.split('/').includes('..')) throw new Error('Invalid path')
      const file = path.resolve(root, relative)
      if (!file.startsWith(path.resolve(root) + path.sep) || !(await stat(file)).isFile()) throw new Error('Not found')
      res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream')
      res.writeHead(200); res.end(req.method === 'HEAD' ? undefined : await readFile(file))
    } catch { res.writeHead(404); res.end() }
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const build = JSON.parse(await readFile('dist-fixed/build-info.json', 'utf8'))
  const server = createFixedServer(undefined, build.base)
  server.listen(4174, '127.0.0.1', () => console.log(`Fixed server: http://127.0.0.1:4174${build.base}`))
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
}
