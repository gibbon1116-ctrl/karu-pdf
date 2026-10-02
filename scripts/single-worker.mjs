import { rolldown } from 'rolldown'

export function selectRegions(code, mode) {
  const region = /(?:\{)?\/\* @(fixed|pages|single|server):start \*\/(?:\})?([\s\S]*?)(?:\{)?\/\* @\1:end \*\/(?:\})?/g
  while (/@(?:fixed|pages|single|server):start/.test(code)) code = code.replace(region,
    (_all, region, body) => (region === mode || region === 'server' && mode !== 'single') ? body : '')
  return code
}

export async function bundleWorker(input, probeCode) {
  const bundle = await rolldown({
    input: probeCode ? 'single-probe' : input,
    platform: 'browser',
    plugins: [{
      name: 'single-worker-assets',
      resolveId(id) {
        if (id === 'single-probe' || id === 'module' || id.startsWith('node:') || id.endsWith('.wasm')) return '\0' + id
      },
      load(id) {
        if (id === '\0single-probe') return probeCode
        if (id.startsWith('\0')) return 'export default {}'
      },
      transform(code, id) {
        if (id.replaceAll('\\', '/').includes('/src/')) code = selectRegions(code, 'single')
        return code.replaceAll('import.meta.url', 'self.location.href')
          .replaceAll('import.meta.env.BASE_URL', '"./"')
      },
    }],
  })
  try {
    const { output } = await bundle.generate({ format: 'es', codeSplitting: false, minify: true })
    if (output.length !== 1 || output[0].type !== 'chunk' || output[0].imports.length || /\bimport\s*\(/.test(output[0].code) || output[0].exports.length) throw new Error('Worker must be a single bundle without imports or exports')
    return wrapWorker(output[0].code)
  } finally { await bundle.close() }
}

export function wrapWorker(code) {
  // Install the handler before MuPDF's top-level await. Buffer all subsequent
  // messages until its scheduler is installed; compilation happens on the page.
  return `self.onmessage = async function bootstrap(event) {
    if (event.data?.type !== 'single-init') throw new Error('Missing single-init');
    const queued = []; self.onmessage = e => queued.push(e);
    self.addEventListener('securitypolicyviolation', e => postMessage({type:'single-csp',violation:{directive:e.effectiveDirective,blockedURI:e.blockedURI}}));
    globalThis.$libmupdf_wasm_Module = { instantiateWasm(imports, done) {
      const instance = new WebAssembly.Instance(event.data.module, imports);
      done(instance, event.data.module); return instance.exports;
    }};
    try {
      await (async function() {\n${code}\n})();
      const handler = self.onmessage;
      for (const e of queued) handler.call(self, e);
    } catch (error) { setTimeout(() => { throw error; }); }
  };`
}
