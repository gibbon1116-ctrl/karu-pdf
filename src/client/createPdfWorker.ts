/* @single:start */import { createSingleWorker } from '../single/runtime'
/* @single:end */
/* @server:start */import { sharedPdfModule } from './sharedPdfModule'
/* @server:end */

export function createPdfWorker(): Worker {
  /* @single:start */const single = createSingleWorker('pdf')
  if (single) return single
  /* @single:end */
  /* @server:start */
  const worker = new Worker(new URL('../worker/pdf.bootstrap.ts', import.meta.url), { type: 'module' })
  void sharedPdfModule().then(module => worker.postMessage({ type: 'pdf-init', module })).catch(error => {
    worker.dispatchEvent(new ErrorEvent('error', { message: error instanceof Error ? error.message : String(error), error }))
  })
  return worker
  /* @server:end */
  throw new Error('PDF表示エンジンを起動できません。')
}
