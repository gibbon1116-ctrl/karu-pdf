import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const digest = (bytes, encoding = 'hex') => createHash('sha256').update(bytes).digest(encoding)
export function verifySingle(file) {
  const html = fs.readFileSync(file, 'utf8'), scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  const executable = scripts.filter(s => !s[1].includes('type='))
  if (scripts.length !== 7 || executable.length !== 1 || /<script[^>]+src=|<link[^>]+(?:preload|stylesheet)|<base\b/.test(html)) throw new Error('Unexpected HTML resource or script')
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1]
  const scriptHash = digest(executable[0][2], 'base64')
  const expected = `default-src 'none'; script-src 'sha256-${scriptHash}' 'wasm-unsafe-eval'; worker-src blob:; connect-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; object-src 'none'; base-uri 'none'; form-action 'none'`
  if (csp !== expected) throw new Error('CSP or executable script hash differs')
  const assets = {}
  for (const [id, source] of [
    ['wasm', 'node_modules/mupdf/dist/mupdf-wasm.wasm'],
    ['font-BIZUDGothic', 'public/fonts/BIZUDGothic-Regular.ttf'],
    ['font-BIZUDMincho', 'public/fonts/BIZUDMincho-Regular.ttf'],
  ]) {
    const elements = scripts.filter(s => s[1] === ` type="text/plain" id="single-${id}" data-encoding="base64"`)
    if (elements.length !== 1) throw new Error('Missing or duplicate embedded asset: ' + id)
    const encoded = elements[0][2], bytes = Buffer.from(encoded, 'base64'), original = fs.readFileSync(source)
    if (bytes.toString('base64') !== encoded || !bytes.equals(original)) throw new Error('Embedded asset differs: ' + id)
    assets[id] = { rawBytes: bytes.length, base64Bytes: encoded.length, sha256: digest(bytes) }
  }
  for (const id of ['pdf', 'image']) {
    const worker = scripts.find(s => s[1] === ` type="text/plain" id="single-worker-${id}"`)
    if (!worker || /import\.meta|\bimport\s*\(|\bexport\s/.test(worker[2])) throw new Error('Invalid classic Worker: ' + id)
  }
  if (executable[0][2].includes('import.meta') || /\bimport\s*\(/.test(executable[0][2])) throw new Error('Module syntax remains')
  return { file, htmlBytes: Buffer.byteLength(html), htmlSHA256: digest(html), scriptSHA256: scriptHash, csp, assets }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const files = fs.readdirSync('dist-single')
  if (files.length !== 1 || !files[0].endsWith('.html')) throw new Error('Expected one HTML file')
  console.log('SINGLE_VERIFIED', JSON.stringify(verifySingle(path.join('dist-single', files[0]))))
}
