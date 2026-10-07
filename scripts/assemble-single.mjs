import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { bundleWorker } from './single-worker.mjs'
import { walk } from './audit-network.mjs'

const root = 'dist-single', files = walk(root)
const build = JSON.parse(fs.readFileSync(`${root}/build-info.json`, 'utf8'))
if (build.mode !== 'single' || !/^\d+\.\d+\.\d+-single$/.test(build.version)) throw new Error('Invalid single metadata')
const programs = files.filter(f => /\/assets\/index-[^/]+\.js$/.test(f))
if (programs.length !== 1 || files.filter(f => f.endsWith('.js')).length !== 1) throw new Error('Expected exactly one application script')
const program = fs.readFileSync(programs[0], 'utf8').replaceAll('import.meta.resolve', 'undefined').replaceAll('import.meta.url', 'self.location.href')
if (/\bimport\s*(?:\(|["'{*])|\bexport\s/.test(program)) throw new Error('Unexpected ESM in application bundle')
const escapeScript = value => value.replace(/<\/script/gi, '<\\/script')
const workers = { pdf: await bundleWorker('src/worker/pdf.worker.ts'), image: await bundleWorker('src/worker/image.worker.ts'), 'symbol-search': await bundleWorker('src/worker/symbolSearch.worker.ts') }
const binary = {
  wasm: fs.readFileSync('node_modules/mupdf/dist/mupdf-wasm.wasm'),
  'font-BIZUDGothic': fs.readFileSync('public/fonts/BIZUDGothic-Regular.ttf'),
  'font-BIZUDMincho': fs.readFileSync('public/fonts/BIZUDMincho-Regular.ttf'),
}
const css = files.filter(f => f.endsWith('.css')).map(f => fs.readFileSync(f, 'utf8')).join('\n')
if (/@font-face|url\((?!["']?(?:data:|blob:))/.test(css)) throw new Error('Unexpected external CSS resource')
const script = escapeScript(`globalThis.__singleDiagnostics = {wasmDecodes:0,wasmCompiles:0,fontDecodes:{},violations:[]};
document.addEventListener('securitypolicyviolation',e=>__singleDiagnostics.violations.push({directive:e.effectiveDirective,blockedURI:e.blockedURI}));
(async function() {
  const encoded=document.getElementById('single-wasm').textContent;
  let bytes;
  if(Uint8Array.fromBase64) bytes=Uint8Array.fromBase64(encoded);
  else {const binary=atob(encoded);bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i)}
  __singleDiagnostics.wasmDecodes++;
  globalThis.__singleWasm=await WebAssembly.compile(bytes);bytes=null;__singleDiagnostics.wasmCompiles++;
  globalThis.$libmupdf_wasm_Module={instantiateWasm(imports,done){WebAssembly.instantiate(__singleWasm,imports).then(instance=>done(instance,__singleWasm)).catch(error=>{setTimeout(()=>{throw error})});return {}}};
  ${program}
})().catch(error=>{document.getElementById('root').textContent='起動できませんでした。HTML ファイルを確かめてください。';console.error(error)});`)
const hash = createHash('sha256').update(script).digest('base64')
const csp = `default-src 'none'; script-src 'sha256-${hash}' 'wasm-unsafe-eval'; worker-src blob:; connect-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; object-src 'none'; base-uri 'none'; form-action 'none'`
const sections = [
  ...Object.entries(binary).map(([id, bytes]) => `<script type="text/plain" id="single-${id}" data-encoding="base64">${bytes.toString('base64')}</script>`),
  ...Object.entries(workers).map(([id, code]) => `<script type="text/plain" id="single-worker-${id}">${escapeScript(code)}</script>`),
  `<script type="application/json" id="single-build-info">${escapeScript(JSON.stringify({ ...build, csp }))}</script>`,
]
const icon = fs.readFileSync('public/icons/icon-192.png').toString('base64')
const html = `<!doctype html>\n<html lang="ja"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="theme-color" content="#1769aa"><link rel="icon" href="data:image/png;base64,${icon}"><title>かるPDF</title><style>${css}</style></head><body><div id="root"></div>\n${sections.join('\n')}\n<script>${script}</script></body></html>\n`
// Intermediate Vite files are not part of the distribution. Delete only the
// explicitly inspected children of this output directory.
for (const entry of fs.readdirSync(root)) fs.rmSync(path.join(root, entry), { recursive: true, force: true })
const filename = `karu-pdf-v${build.version.replace(/-single$/, '')}.html`
fs.writeFileSync(path.join(root, filename), html)
console.log('SINGLE_SIZE', JSON.stringify({ file: filename, htmlBytes: Buffer.byteLength(html), rawBinary: Object.fromEntries(Object.entries(binary).map(([id, b]) => [id, b.length])), embeddedBase64: Object.fromEntries(Object.entries(binary).map(([id, b]) => [id, b.toString('base64').length])), programBytes: Buffer.byteLength(script), workers: Object.fromEntries(Object.entries(workers).map(([id, s]) => [id, Buffer.byteLength(s)])), cssBytes: Buffer.byteLength(css), scriptSHA256: hash }))
