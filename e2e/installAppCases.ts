import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

async function setup(page: Page, options: { standalone?: boolean; installed?: boolean; chrome?: boolean; copyFails?: boolean } = {}) {
  await page.addInitScript(options => {
    if (options.standalone) {
      const original = window.matchMedia.bind(window)
      window.matchMedia = query => {
        const result = original(query)
        if (query === '(display-mode: standalone)') Object.defineProperty(result, 'matches', { value: true })
        return result
      }
    }
    if (options.installed) localStorage.setItem('karu-pdf:installed-via-app', '1')
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: {
      brands: [{ brand: options.chrome ? 'Google Chrome' : 'Microsoft Edge', version: '1' }],
    } })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      async writeText(text: string) {
        if (options.copyFails) throw new Error('clipboard blocked')
        ;(window as Window & { copiedAppAddress?: string }).copiedAppAddress = text
      },
    } })
  }, options)
  await page.goto('/karu-pdf/?test=1')
  await expect(page.getByTestId('start-screen')).toBeVisible()
  await page.waitForFunction(() => Boolean(window.__karu))
}

async function sendInstallPrompt(page: Page, outcome: 'accepted' | 'dismissed' = 'accepted') {
  return page.evaluate(outcome => {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      async prompt() {
        const host = window as Window & { installPromptCalls?: number }
        host.installPromptCalls = (host.installPromptCalls ?? 0) + 1
      },
      userChoice: Promise.resolve({ outcome }),
    })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }, outcome)
}

async function openSteps(page: Page) {
  await page.getByRole('button', { name: 'ヘルプ▼' }).click()
  await page.getByRole('menuitem', { name: 'デスクトップにアプリを置く手順…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'デスクトップにアプリを置く手順', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

export function installAppCases() {
  test('起動画面とヘルプからインストールし、完了を状態欄に表示する', async ({ page }, testInfo) => {
    await setup(page)
    const installButton = page.getByTestId('start-screen').getByRole('button', { name: 'アプリとしてインストール', exact: true })
    await expect(installButton).toHaveCount(0)
    await page.getByRole('button', { name: 'ヘルプ▼' }).click()
    await expect(page.getByRole('menuitem', { name: 'アプリとしてインストール…', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    expect(await sendInstallPrompt(page, 'dismissed')).toBe(true)
    await expect(installButton).toBeVisible()
    await expect(page.getByRole('region', { name: 'アプリのインストール' })).toContainText('専用の窓で開けます')
    await page.getByTestId('start-screen').screenshot({ path: testInfo.outputPath('install-start-screen.png') })
    await installButton.click()
    await expect.poll(() => page.evaluate(() => (window as Window & { installPromptCalls?: number }).installPromptCalls)).toBe(1)
    await expect(installButton).toHaveCount(0)
    expect(await sendInstallPrompt(page)).toBe(true)
    await page.getByRole('button', { name: 'ヘルプ▼' }).click()
    await page.getByRole('menuitem', { name: 'アプリとしてインストール…', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as Window & { installPromptCalls?: number }).installPromptCalls)).toBe(2)
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
    await expect(installButton).toHaveCount(0)
    await expect(page.locator('.status-bar')).toContainText('インストールしました。デスクトップに置くかどうかは、アプリを初めて開いたときに Edge が出す画面で選べます。')
    expect(await page.evaluate(() => localStorage.getItem('karu-pdf:installed-via-app'))).toBe('1')
    await page.getByRole('button', { name: 'ヘルプ▼' }).click()
    await expect(page.getByRole('menuitem', { name: 'アプリとしてインストール…', exact: true })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'デスクトップにアプリを置く手順…', exact: true })).toBeEnabled()
  })

  test('アプリの窓の初回だけ帯を出し、手順とアドレスのコピーを案内する', async ({ page, context }, testInfo) => {
    await setup(page, { standalone: true })
    const initialUrl = page.url()
    const pageCount = context.pages().length
    const banner = page.getByRole('complementary', { name: 'デスクトップへの配置' })
    await expect(banner).toContainText('デスクトップにかるPDFを置きますか？')
    await banner.screenshot({ path: testInfo.outputPath('desktop-prompt-banner.png') })
    await banner.getByRole('button', { name: '置く手順を見る' }).click()
    await expect(banner).toHaveCount(0)
    const dialog = page.getByRole('dialog', { name: 'デスクトップにアプリを置く手順', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('ol > li')).toHaveCount(3)
    await expect(dialog).toContainText('edge://apps')
    await expect(dialog).toContainText('「かるPDF」の「詳細」')
    await expect(dialog).toContainText('「デスクトップ ショートカットを作成します」')
    await dialog.getByRole('button', { name: 'アドレスをコピー' }).click()
    expect(await page.evaluate(() => (window as Window & { copiedAppAddress?: string }).copiedAppAddress)).toBe('edge://apps')
    await dialog.screenshot({ path: testInfo.outputPath('desktop-steps.png') })
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    expect(await page.evaluate(() => window.__karu!.getExternalSendRecords())).toEqual([])
    expect(page.url()).toBe(initialUrl)
    expect(context.pages()).toHaveLength(pageCount)
    expect(await page.evaluate(() => localStorage.getItem('karu-pdf:desktop-prompt-seen'))).toBe('1')
    await page.reload()
    await expect(page.getByTestId('start-screen')).toBeVisible()
    await expect(banner).toHaveCount(0)
    await openSteps(page)
  })

  test('置かないを選んでも再読込で帯を出さない', async ({ page }) => {
    await setup(page, { standalone: true })
    await page.getByRole('button', { name: '置かない', exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'デスクトップへの配置' })).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'デスクトップにアプリを置く手順', exact: true })).not.toBeVisible()
    await page.reload()
    await expect(page.getByTestId('start-screen')).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'デスクトップへの配置' })).toHaveCount(0)
  })

  test('帯を表示したままでも PDF を開き、メニューを操作できる', async ({ page }) => {
    await setup(page, { standalone: true })
    const banner = page.getByRole('complementary', { name: 'デスクトップへの配置' })
    await expect(banner).toBeVisible()
    await page.getByTestId('file-input').setInputFiles(path.resolve('test-data/sample-small.pdf'))
    await expect(page.getByText('1 / 5')).toBeVisible()
    await expect(banner).toBeVisible()
    await page.getByRole('button', { name: '表示▼' }).click()
    await expect(page.getByRole('menu', { name: '表示▼' })).toBeVisible()
    await page.keyboard.press('Escape')
    const regions = await page.evaluate(() => {
      const banner = document.querySelector('.desktop-prompt-banner')!.getBoundingClientRect()
      const workspace = document.querySelector('.document-workspace')!.getBoundingClientRect()
      return { bottom: banner.bottom, workspaceTop: workspace.top }
    })
    expect(regions.bottom).toBeLessThanOrEqual(regions.workspaceTop)
  })

  test('アプリからのインストールの印があれば帯を出さず、聞いた印を保存する', async ({ page }) => {
    await setup(page, { standalone: true, installed: true })
    await expect(page.getByRole('complementary', { name: 'デスクトップへの配置' })).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('karu-pdf:desktop-prompt-seen'))).toBe('1')
  })

  test('手順画面でも先にインストールできる', async ({ page }) => {
    await setup(page)
    await sendInstallPrompt(page)
    const dialog = await openSteps(page)
    await expect(dialog).toContainText('先に、かるPDFをアプリとしてインストール')
    await dialog.getByRole('button', { name: 'アプリとしてインストール', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as Window & { installPromptCalls?: number }).installPromptCalls)).toBe(1)
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
    await expect(dialog.getByRole('button', { name: 'アプリとしてインストール', exact: true })).toHaveCount(0)
  })

  test('Chrome の手順と、コピー不可時の選択と手動コピー案内', async ({ page, context }) => {
    await setup(page, { chrome: true, copyFails: true })
    const originalUrl = page.url()
    const pageCount = context.pages().length
    const dialog = await openSteps(page)
    await expect(dialog.locator('ol > li')).toHaveCount(3)
    await expect(dialog).toContainText('chrome://apps')
    await expect(dialog).toContainText('右クリックして「ショートカットを作成」')
    await expect(dialog).toContainText('「デスクトップ」を選びます')
    await dialog.getByRole('button', { name: 'アドレスをコピー' }).click()
    const address = dialog.getByRole('textbox', { name: 'アプリ管理のアドレス' })
    await expect(address).toBeFocused()
    expect(await address.evaluate((input: HTMLInputElement) => input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0))).toBe('chrome://apps')
    await expect(dialog).toContainText('Ctrl+C またはコピー操作')
    expect(page.url()).toBe(originalUrl)
    expect(context.pages()).toHaveLength(pageCount)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    expect(await page.evaluate(() => window.__karu!.getExternalSendRecords())).toEqual([])
  })
}
