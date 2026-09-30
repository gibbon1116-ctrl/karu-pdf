import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const sample = path.resolve('test-data/sample-small.pdf')

async function openSample(page: Page): Promise<void> {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(sample)
  await expect(page.getByText('1 / 5')).toBeVisible()
}

test('メニューは外側、Esc、別メニューを開いたときに閉じる', async ({ page }) => {
  await openSample(page)
  const file = page.getByRole('button', { name: 'ファイル▼' })
  await file.click()
  await expect(page.getByRole('menu', { name: 'ファイル▼' })).toBeVisible()
  await page.locator('.status-bar').click()
  await expect(page.getByRole('menu', { name: 'ファイル▼' })).toBeHidden()

  await file.click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'ファイル▼' })).toBeHidden()

  await file.click()
  await page.getByRole('button', { name: '編集▼' }).click()
  await expect(page.getByRole('menu', { name: 'ファイル▼' })).toBeHidden()
  await expect(page.getByRole('menu', { name: '編集▼' })).toBeVisible()
})

test('ページ整理の回転メニューは外側を押すと閉じる', async ({ page }) => {
  await openSample(page)
  await page.getByRole('button', { name: 'ページ▼' }).click()
  await page.getByRole('menuitem', { name: 'ページ整理', exact: true }).click()
  await expect(page.getByTestId('organize-view')).toBeVisible()
  await page.getByRole('button', { name: '回転▼' }).click()
  await expect(page.getByRole('menu', { name: '回転▼' })).toBeVisible()
  await page.locator('.organize-grid-scroller').click({ position: { x: 10, y: 10 } })
  await expect(page.getByRole('menu', { name: '回転▼' })).toBeHidden()
})

test('図形の丸を最後に使った道具として再読み込み後も表示する', async ({ page }) => {
  await openSample(page)
  await page.getByRole('button', { name: '図形▼' }).click()
  await page.getByRole('menuitemcheckbox', { name: '丸' }).click()
  await expect(page.getByRole('button', { name: '丸', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(page.getByRole('button', { name: '丸', exact: true })).toBeVisible()
})

test('メニューから保存、ページ一覧、ページ整理を操作できる', async ({ page }) => {
  await openSample(page)
  await page.getByRole('button', { name: 'ファイル▼' }).click()
  await page.getByRole('menuitem', { name: /^別名で保存/ }).click()
  await expect.poll(() => page.evaluate(() => window.__karu!.getMenuActions())).toContain('save-as')

  await page.getByRole('button', { name: '表示▼' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'ページ一覧' }).click()
  await expect(page.locator('.thumbnail-panel')).toBeHidden()

  await page.getByRole('button', { name: 'ページ▼' }).click()
  await page.getByRole('menuitem', { name: 'ページ整理', exact: true }).click()
  await expect(page.getByTestId('organize-view')).toBeVisible()
})

test('キーボードでファイルメニューの2番目を実行する', async ({ page }) => {
  await openSample(page)
  const file = page.getByRole('button', { name: 'ファイル▼' })
  await file.focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__karu!.getMenuActions())).toContain('save')
})

test('1600pxと800pxで上部メニューを2段に収める', async ({ page }) => {
  await openSample(page)
  for (const width of [1600, 800]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.locator('.menu-bar')).toHaveCSS('height', '32px')
    await expect(page.locator('.tool-row')).toHaveCSS('height', '40px')
    await page.screenshot({ path: `test-results/menu-${width}.png`, fullPage: true })
  }
})
