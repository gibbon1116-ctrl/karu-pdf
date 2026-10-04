import { expect, test } from '@playwright/test'
import { probeServerWorkers } from './externalSendWorkerProbe'

test('外部 fetch を送る前に止め、内部フォントを読み込める', async ({ page, context }, testInfo) => {
  const wire: string[] = []
  await context.route('https://example.com/**', route => { wire.push(route.request().url()); return route.abort() })
  await page.goto('/karu-pdf/?test=1')
  await page.waitForFunction(() => Boolean(window.__karu))
  const result = await page.evaluate(async () => {
    let rejected = false
    for (let i = 0; i < 2; i++) {
      try { await fetch(new Request('https://example.com/private?drawing=secret', { method: 'POST', body: 'private drawing' })) }
      catch (error) { rejected = error instanceof TypeError }
    }
    const font = await fetch(new URL('./fonts/BIZUDGothic-Regular.ttf', location.href))
    return { rejected, font: font.ok, bytes: (await font.arrayBuffer()).byteLength, records: window.__karu!.getExternalSendRecords() }
  })
  expect(result.rejected).toBe(true); expect(result.font).toBe(true); expect(result.bytes).toBeGreaterThan(0)
  const alert = page.getByRole('alertdialog', { name: '外部への送信を止めました' })
  await expect(alert).toContainText('example.com'); await expect(alert).toContainText('データは送信していません')
  await expect(alert).toContainText('2件'); await expect(alert).not.toContainText('private'); await expect(alert).not.toContainText('secret')
  expect(result.records.slice(-2)).toEqual([{ kind: 'fetch', host: 'example.com', count: 1 }, { kind: 'fetch', host: 'example.com', count: 1 }])
  expect(wire).toEqual([])
  await alert.screenshot({ path: testInfo.outputPath('external-send-alert.png') })
  await alert.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(alert).not.toBeVisible()
  await expect(page.getByTestId('start-screen')).toBeVisible()
})

test('外部リンクを確認し、開かない限り新しいページを作らない', async ({ page, context }, testInfo) => {
  let external = 0
  await context.route('https://example.com/**', route => { external++; return route.fulfill({ body: '<p>external</p>', contentType: 'text/html' }) })
  await page.goto('/karu-pdf/?test=1'); await page.waitForFunction(() => Boolean(window.__karu))
  const pages = context.pages().length
  expect(await page.evaluate(() => window.open('https://example.com/private', '_blank') === null)).toBe(true)
  const dialog = page.getByRole('alertdialog', { name: '外部のサイトを開こうとしています' })
  await expect(dialog).toContainText('example.com'); await expect(dialog).toContainText('開くと、その場所へ接続します')
  await expect(dialog.getByRole('button', { name: '開かない', exact: true })).toBeFocused()
  await dialog.screenshot({ path: testInfo.outputPath('external-link-confirm.png') })
  await dialog.getByRole('button', { name: '開かない', exact: true }).click()
  expect(context.pages()).toHaveLength(pages); expect(external).toBe(0)
  // Also exercise the capture listener, including modifier and middle clicks.
  await page.evaluate(() => {
    const a = document.createElement('a'); a.href = 'https://example.com/private'; a.textContent = '試験リンク'; a.id = 'external-test-link'; document.body.append(a)
  })
  for (const options of [{ modifiers: ['Control' as const] }, { button: 'middle' as const }]) {
    await page.locator('#external-test-link').click(options)
    await expect(dialog).toBeVisible(); await page.keyboard.press('Escape')
  }
  expect(context.pages()).toHaveLength(pages); expect(external).toBe(0)
  await page.locator('#external-test-link').click()
  const popupPromise = context.waitForEvent('page')
  await dialog.getByRole('button', { name: '開く', exact: true }).click()
  const popup = await popupPromise; await popup.waitForLoadState()
  expect(await popup.evaluate(() => window.opener === null)).toBe(true)
  expect(external).toBe(1); await popup.close()
  const printPopup = context.waitForEvent('page')
  await page.evaluate(() => { window.open('', '_blank') })
  const blank = await printPopup; expect(blank.url()).toBe('about:blank'); await blank.close()
})

test('実際の PDF・画像 Worker が外部 fetch の遮断を主画面に知らせる', async ({ page, context }) => {
  await probeServerWorkers(page, context, '/karu-pdf/?test=1', false)
})
