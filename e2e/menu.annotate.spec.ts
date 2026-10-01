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

test('道具は名前・アイコン・説明で見分けられる', async ({ page }) => {
  await openSample(page)
  const mark = page.getByRole('button', { name: '文字に印▼' })
  await mark.click()
  const menu = page.getByRole('menu', { name: '文字に印▼' })
  await expect(menu.getByText('文字ハイライト', { exact: true })).toBeVisible()
  await expect(menu.getByText('選んだ文字だけに色を付ける', { exact: true })).toBeVisible()
  await expect(menu.getByText('選んだ文字の下に線を引く', { exact: true })).toBeVisible()
  await expect(menu.getByText('選んだ文字の中央に線を引く', { exact: true })).toBeVisible()
  await expect(menu.locator('svg.tool-icon')).toHaveCount(4)
  await menu.getByRole('menuitemcheckbox', { name: /文字ハイライト/ }).click()
  const main = page.getByRole('button', { name: '文字ハイライト', exact: true })
  await expect(main).toHaveAttribute('aria-pressed', 'true')
  await expect(main.locator('svg.tool-icon')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'ハイライト', exact: true })).toHaveCount(0)
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

test('1600pxでは道具の段を1段に収め、狭い幅では折り返して文字を省略しない', async ({ page }) => {
  await openSample(page)
  for (const width of [1600, 831, 800]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.locator('.menu-bar')).toHaveCSS('height', '32px')
    if (width === 1600) await expect(page.locator('.tool-row')).toHaveCSS('height', '40px')
    else expect(await page.locator('.tool-row').evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(80)
    // 道具の段のボタンの文字が、省略されたりはみ出したりしていない
    const clipped = await page.locator('.tool-row').evaluate((row) => [...row.querySelectorAll('button, .split-label')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('split-arrow'))
      .map((el) => el.textContent))
    expect(clipped).toEqual([])
    // 道具の段は画面の右にはみ出さない
    expect(await page.locator('.tool-row').evaluate((row) => row.scrollWidth <= row.clientWidth + 1)).toBe(true)
    // 2段になっても、下の作業領域に重ならない
    expect(await page.evaluate(() => document.querySelector('.tool-row')!.getBoundingClientRect().bottom
      <= document.querySelector('.document-workspace')!.getBoundingClientRect().top + 0.5)).toBe(true)
    await page.screenshot({ path: `test-results/menu-${width}.png`, fullPage: true })
  }
})

test('831pxの幅で、すべてのプルダウンの項目が重ならず、切れず、横にはみ出さない', async ({ page }) => {
  await openSample(page)
  await page.setViewportSize({ width: 831, height: 640 })
  for (const name of ['ファイル▼', '編集▼', '表示▼', 'ページ▼', 'ヘルプ▼', '文字▼', '図形▼', 'ペン▼', '文字に印▼', '計測▼']) {
    await page.getByRole('button', { name, exact: true }).first().click()
    const menu = page.locator('.dropdown.open .dropdown-menu')
    await expect(menu).toBeVisible()
    const result = await menu.evaluate((element) => {
      const problems: string[] = []
      const box = element.getBoundingClientRect()
      if (element.scrollWidth > element.clientWidth + 1) problems.push('横スクロール')
      if (box.left < 0 || box.right > window.innerWidth) problems.push('画面外')
      for (const item of element.querySelectorAll('button')) {
        const label = item.querySelector('.dropdown-label') as HTMLElement | null
        const shortcut = item.querySelector('kbd')
        if (!label) continue
        const labelBox = label.getBoundingClientRect()
        if (labelBox.right > item.getBoundingClientRect().right) problems.push(`はみ出し:${label.textContent}`)
        if (shortcut && labelBox.left + label.scrollWidth > shortcut.getBoundingClientRect().left - 2) problems.push(`重なり:${label.textContent}`)
      }
      return problems
    })
    expect(result, name).toEqual([])
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  }
})
