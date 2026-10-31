import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkPublication, classifyPublicationResponse, PUBLICATION_STOPPED_KEY, readPublicationStopped, writePublicationStatus } from '../src/app/publicationStatus'

const options = { url: '/app-status.json', timeoutMs: 100, retryDelayMs: 1 }
const response = (status: number, body: unknown = null) => new Response(JSON.stringify(body), { status })

afterEach(() => vi.unstubAllGlobals())

describe('公開状態の応答', () => {
  it.each(['active', 'stopped'] as const)('200 %s を判定する', async status => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(200, { status }))
    expect(classifyPublicationResponse(200, { status })).toBe(status)
    expect(await checkPublication({ ...options, fetchImpl })).toBe(status)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(options.url, {
      cache: 'no-store', credentials: 'omit', signal: expect.any(AbortSignal),
    })
  })

  it('404 が2回続いたときだけ停止する', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response(404))
    expect(classifyPublicationResponse(404, null)).toBe('missing')
    expect(await checkPublication({ ...options, fetchImpl })).toBe('stopped')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it.each([
    [200, { status: 'active' }, 'active'],
    [200, { status: 'stopped' }, 'stopped'],
    [500, null, 'unknown'],
    [403, null, 'unknown'],
    [200, { status: 'other' }, 'unknown'],
  ] as const)('404 の次は応答を判定する (%s, %j)', async (status, body, verdict) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response(404)).mockResolvedValueOnce(response(status, body))
    expect(await checkPublication({ ...options, fetchImpl })).toBe(verdict)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it.each([500, 403, 201, 204])('%s は不明で、再試行しない', async status => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }))
    expect(await checkPublication({ ...options, fetchImpl })).toBe('unknown')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([null, [], 'active', {}, { status: 'other' }, { status: 'active', extra: true }])('定義外の中身 %j は不明', async body => {
    expect(classifyPublicationResponse(200, body)).toBe('unknown')
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(200, body))
    expect(await checkPublication({ ...options, fetchImpl })).toBe('unknown')
  })

  it('通信失敗は不明で、再試行しない', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network failure'))
    expect(await checkPublication({ ...options, fetchImpl })).toBe('unknown')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('404 後の通信失敗でも不明', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response(404)).mockRejectedValueOnce(new TypeError('network failure'))
    expect(await checkPublication({ ...options, fetchImpl })).toBe('unknown')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('JSON として読めなければ不明', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>unavailable</html>', { status: 200 }))
    expect(await checkPublication({ ...options, fetchImpl })).toBe('unknown')
  })

  it('期限で AbortController を打ち切り、不明を返す', async () => {
    let signal: AbortSignal | undefined
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      signal = init?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    })
    expect(await checkPublication({ ...options, fetchImpl, timeoutMs: 1 })).toBe('unknown')
    expect(signal?.aborted).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('本文の読取りが終わらない場合にも期限を適用する', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({ status: 200, json: () => new Promise(() => {}) } as Response)
    expect(await checkPublication({ ...options, fetchImpl, timeoutMs: 1 })).toBe('unknown')
  })

  it('既定の URL を使い、問い合わせ文字列を付けない', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(200, { status: 'active' }))
    await checkPublication({ fetchImpl })
    expect(fetchImpl.mock.calls[0][0]).toBe(import.meta.env.BASE_URL + 'app-status.json')
  })
})

describe('停止の記録', () => {
  it('停止を記録し、不明では維持し、active で消す', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
      removeItem: vi.fn((key: string) => { values.delete(key) }),
    }
    vi.stubGlobal('localStorage', storage)
    expect(readPublicationStopped()).toBe(false)
    expect(storage.getItem).toHaveBeenCalledTimes(1)
    writePublicationStatus('stopped')
    expect(values.get(PUBLICATION_STOPPED_KEY)).toBe('1')
    expect(readPublicationStopped()).toBe(true)
    writePublicationStatus('unknown')
    expect(readPublicationStopped()).toBe(true)
    expect(storage.removeItem).not.toHaveBeenCalled()
    writePublicationStatus('active')
    expect(storage.removeItem).toHaveBeenCalledWith(PUBLICATION_STOPPED_KEY)
    expect(readPublicationStopped()).toBe(false)
  })

  it('ストレージの読み書きが使えなくても例外を出さない', () => {
    const fail = () => { throw new Error('storage unavailable') }
    vi.stubGlobal('localStorage', { getItem: fail, setItem: fail, removeItem: fail })
    expect(readPublicationStopped()).toBe(false)
    for (const status of ['stopped', 'active', 'unknown'] as const) expect(() => writePublicationStatus(status)).not.toThrow()
    vi.stubGlobal('localStorage', undefined)
    expect(readPublicationStopped()).toBe(false)
    expect(() => writePublicationStatus('stopped')).not.toThrow()
  })
})
