import { expect, test } from '@playwright/test'

test('版・法的告知・ソースの入手先と同じ配信元のライセンス全文を表示する', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.getByRole('button', { name: 'ヘルプ▼', exact: true }).click()
  await page.getByRole('menuitem', { name: 'このアプリについて', exact: true }).click()
  const about = page.getByRole('dialog', { name: 'かるPDFについて' })
  const version = about.locator('p').filter({ hasText: /^版 / })
  await expect(version).toBeVisible()
  await expect(version).toHaveText('版 1.11.1')
  await expect(version).toHaveAttribute('title', /^(?:[a-f0-9]{40}|unknown)$/i)
  await expect(version).not.toContainText('（')
  await expect(about).toContainText('Copyright (C) 2026 gibbon1116-ctrl')
  await expect(about).toContainText('AGPL-3.0-or-later・無保証')
  const source = about.getByRole('link', { name: /^https:\/\/github\.com\//, includeHidden: true })
  await expect(source).toBeHidden()
  await about.getByText('ソースコード', { exact: true }).click()
  await expect(source).toBeVisible()
  await expect(source).toHaveAttribute('href', /^https:\/\/github\.com\/gibbon1116-ctrl\/karu-pdf(?:\/tree\/[a-f0-9]+)?$/)
  await expect(source).toHaveAttribute('target', '_blank')
  for (const [name, filename, text] of [
    ['ライセンス', 'LICENSE.txt', 'GNU AFFERO GENERAL PUBLIC LICENSE'],
    ['第三者ライセンス', 'THIRD_PARTY_LICENSES.txt', 'react'],
    ['データ出典', 'DATA_SOURCES.txt', '国土交通省'],
  ]) {
    const href = await about.getByRole('link', { name, exact: true }).getAttribute('href')
    expect(href).toBe('/karu-pdf/licenses/' + filename)
    const target = new URL(href!, page.url())
    expect(target.origin).toBe(new URL(page.url()).origin)
    const response = await page.request.get(target.href)
    expect(response.status()).toBe(200)
    expect(await response.text()).toContain(text)
  }
})

test('Service Worker の制御下でもライセンスのリンク先に全文を表示する', async ({ page, context }) => {
  await page.goto('/karu-pdf/?test=1')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.reload()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await page.getByRole('button', { name: 'ヘルプ▼', exact: true }).click()
  await page.getByRole('menuitem', { name: 'このアプリについて', exact: true }).click()
  const about = page.getByRole('dialog', { name: 'かるPDFについて' })
  for (const [name, filename, text] of [
    ['ライセンス', 'LICENSE.txt', 'GNU AFFERO GENERAL PUBLIC LICENSE'],
    ['第三者ライセンス', 'THIRD_PARTY_LICENSES.txt', 'MuPDF bundled third-party components'],
    ['データ出典', 'DATA_SOURCES.txt', '国土交通省'],
  ]) {
    const target = new URL('/karu-pdf/licenses/' + filename, page.url())
    const [licensePage] = await Promise.all([
      context.waitForEvent('page'),
      about.getByRole('link', { name, exact: true }).click(),
    ])
    await licensePage.waitForLoadState('domcontentloaded')
    await expect(licensePage).toHaveURL(target.href)
    await expect(licensePage.locator('body')).toContainText(text)
    await expect(licensePage.getByRole('button', { name: 'ファイル▼', exact: true })).toHaveCount(0)
    await licensePage.close()
  }
})
