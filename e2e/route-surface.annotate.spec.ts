import { expect, test, type Page } from '@playwright/test'
import mupdf from 'mupdf'
import { writeCountFixtures, type CountFixture } from '../src/core/countFixtures'

const style = {
  shape: 'circle', fill: 'none', size: 10, opacity: 1, showCode: true,
} as const
const fixtures: CountFixture[] = [
  {
    id: 'duct', name: '長方形ダクト', code: 'SD', spec: '500×300',
    category: 'ダクト', order: 0, kind: 'length', method: 'polyline',
    convert: { factor: 1.6, unit: '㎡', basis: '周長' },
    style: { ...style, color: [0, 0, 1] },
  },
  {
    id: 'insulation', name: 'ダクト保温', code: 'GW',
    category: '保温', order: 1, kind: 'area', method: 'lengthHeight',
    style: { ...style, color: [1, 0, 0] },
  },
]

function pdf(): number[] {
  const doc = new mupdf.PDFDocument()
  const ref = doc.addPage([0, 0, 500, 500], 0, {}, '')
  try {
    doc.insertPage(-1, ref)
    writeCountFixtures(doc, fixtures)
    const buffer = doc.saveToBuffer('compress')
    try {
      return [...buffer.asUint8Array()]
    } finally {
      buffer.destroy()
    }
  } finally {
    ref.destroy()
    doc.destroy()
  }
}

async function click(page: Page, x: number, y: number) {
  const point = await page.getByTestId('annotation-layer-0').evaluate((element, p) => {
    const svg = element as SVGSVGElement
    const box = svg.getBoundingClientRect()
    return {
      x: box.left + p.x * box.width / svg.viewBox.baseVal.width,
      y: box.top + p.y * box.height / svg.viewBox.baseVal.height,
    }
  }, { x, y })
  await page.mouse.click(point.x, point.y)
}

const total = (page: Page, name: string) => page.getByTestId('fixture-panel')
  .getByRole('button', { name, exact: true })
  .locator('.fixture-row-count').first()

test('ダクト保温を周長×経路長で拾い、保存して開き直しても保持する', async ({ page }) => {
  await page.goto('/karu-pdf/?test=1&workers=2&warm=0')
  await page.waitForFunction(() => !!window.__karu)
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '経路の保温.pdf'), pdf())
  await page.evaluate(() => window.__karu!.setZoom(1))
  await expect(page.getByTestId('annotation-layer-0')).toBeVisible()
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await page.getByTestId('fixture-panel').getByRole('button', {
    name: 'SD 500×300 長方形ダクト', exact: true,
  }).click()

  await click(page, 100, 220)
  const scale = page.getByRole('dialog', { name: '縮尺の設定（1 ページ）' })
  await expect(scale).toBeVisible()
  await scale.getByLabel('縮尺の分母').fill('100')
  await scale.getByRole('button', { name: '決定', exact: true }).click()
  await click(page, 100, 220)
  await click(page, 172, 220)
  await page.keyboard.press('Enter')

  const panel = page.getByTestId('format-panel')
  await expect(total(page, 'SD 500×300 長方形ダクト')).not.toHaveText('0.00')
  await panel.getByRole('button', { name: '線要素を追加', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '線要素を追加' })
  await expect(picker.getByRole('heading', {
    name: '表面積（周長×長さ）', exact: true,
  })).toBeVisible()
  await picker.getByRole('button', { name: 'GW', exact: true }).click()

  const perimeter = panel.getByLabel('GW ダクト保温の周長', { exact: true })
  await expect(perimeter).toHaveValue('1.600')
  // has の中の locator は外側の要素から探すので、パネルからの locator ではなく page から作る。
  const surfaceRow = panel.locator('.route-item').filter({
    has: page.getByLabel('GW ダクト保温の周長', { exact: true }),
  })
  await expect(surfaceRow.getByRole('button', {
    name: 'GWを主にする', exact: true,
  })).toBeDisabled()
  await expect(surfaceRow.getByRole('button', {
    name: 'GWを主にする', exact: true,
  })).toHaveAttribute('title', '面積の線要素は主にできません')

  const planText = await panel.locator('.route-lengths > span').first().innerText()
  const planM = Number(planText.match(/平面\s+([\d.]+)/)?.[1])
  expect(planM).toBeGreaterThan(0)
  const expectedArea = (planM * 1.6).toFixed(2)
  await expect(total(page, 'GW ダクト保温')).toHaveText(expectedArea)
  await expect(surfaceRow.locator('.route-item-length')).toContainText('× 周長 1.600 m')
  await expect(surfaceRow.locator('.route-item-length')).toContainText(`＝ ${expectedArea} ㎡`)

  // 自動値を直せる。空欄では0になり、主の寸法から再設定できる。
  await perimeter.fill('1')
  await perimeter.press('Enter')
  await expect(perimeter).toHaveValue('1.000')
  await expect(total(page, 'GW ダクト保温')).toHaveText(planM.toFixed(2))
  await perimeter.fill('')
  await perimeter.press('Enter')
  await expect(total(page, 'GW ダクト保温')).toHaveText('0.00')
  await expect(surfaceRow.getByRole('status')).toHaveText('周長（m）を入れてください')
  await surfaceRow.getByRole('button', {
    name: '主の寸法から入れ直す', exact: true,
  }).click()
  await expect(perimeter).toHaveValue('1.600')
  await expect(total(page, 'GW ダクト保温')).toHaveText(expectedArea)

  const saved = await page.evaluate(async () => [
    ...(await window.__karu!.saveToBytes())!,
  ])
  await page.evaluate(bytes => window.__karu!.openBytes(bytes, '再読込.pdf'), saved)
  await page.evaluate(() => window.__karu!.setZoom(1))
  await page.getByRole('tab', { name: '数量', exact: true }).click()
  await expect(total(page, 'GW ダクト保温')).toHaveText(expectedArea)

  await page.keyboard.press('Escape')
  await click(page, 136, 220)
  await expect(panel.getByLabel('GW ダクト保温の周長', {
    exact: true,
  })).toHaveValue('1.600')
})
