export type PublicationStatus = 'active' | 'stopped' | 'unknown'
export const PUBLICATION_STOPPED_KEY = 'karu-pdf.publicationStopped'

export function classifyPublicationResponse(status: number, body: unknown): PublicationStatus | 'missing' {
  if (status === 404) return 'missing'
  if (status !== 200 || body === null || typeof body !== 'object' || Array.isArray(body)) return 'unknown'
  if (Object.keys(body).length !== 1 || !('status' in body)) return 'unknown'
  return body.status === 'active' || body.status === 'stopped' ? body.status : 'unknown'
}

export async function checkPublication(options: {
  fetchImpl?: typeof fetch
  url?: string
  timeoutMs?: number
  retryDelayMs?: number
} = {}): Promise<PublicationStatus> {
  const { fetchImpl = fetch, url = import.meta.env.BASE_URL + 'app-status.json', timeoutMs = 5000, retryDelayMs = 3000 } = options
  const request = async (): Promise<PublicationStatus | 'missing'> => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // Include body reading in the deadline, even if a fetch implementation ignores abort.
      return await Promise.race([
        new Promise<'unknown'>(resolve => {
          timer = setTimeout(() => { resolve('unknown'); controller.abort() }, timeoutMs)
        }),
        (async () => {
          const response = await fetchImpl(url, { cache: 'no-store', credentials: 'omit', signal: controller.signal })
          if (response.status !== 200) return classifyPublicationResponse(response.status, null)
          return classifyPublicationResponse(response.status, await response.json())
        })(),
      ])
    } catch {
      return 'unknown'
    } finally {
      clearTimeout(timer)
    }
  }
  const first = await request()
  if (first !== 'missing') return first
  await new Promise<void>(resolve => setTimeout(resolve, retryDelayMs))
  const second = await request()
  return second === 'missing' ? 'stopped' : second
}

export function readPublicationStopped(): boolean {
  try { return localStorage.getItem(PUBLICATION_STOPPED_KEY) === '1' } catch { return false }
}

export function writePublicationStatus(status: PublicationStatus): void {
  try {
    if (status === 'stopped') localStorage.setItem(PUBLICATION_STOPPED_KEY, '1')
    else if (status === 'active') localStorage.removeItem(PUBLICATION_STOPPED_KEY)
  } catch { /* Storage availability does not change the current verdict. */ }
}
