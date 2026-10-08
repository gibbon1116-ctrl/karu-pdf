import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { Kind } from '../src/editor/AnnotationStore'

const selected = (page: Page) => page.getByRole('button', { name: '選択', exact: true })
const layer = (page: Page) => page.getByTestId('annotation-layer-0')
const annotations = (page: Page) => page.evaluate(() => window.__karu!.getEditableAnnotations(0))

async function open(page: Page) {
  await page.goto('/karu-pdf/?test=1')
  await page.getByTestId('file-input').setInputFiles(path.resolve('test-data/sample-small.pdf'))
  await expect(layer(page)).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__karu!.getEditableAnnotations(0).some(a => a.text === 'Existing note'))).toBe(true)
}

async function choose(page: Page, group: string, name: string) {
  await page.getByRole('button', { name: `${group}▼`, exact: true }).click()
  await page.getByRole('menu').getByText(name, { exact: true }).click()
  await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
}

async function point(page: Page, x: number, y: number) {
  return layer(page).evaluate((element, p) => {
    const svg = element as SVGSVGElement, box = svg.getBoundingClientRect(), view = svg.viewBox.baseVal
    return { x: box.left + p.x * box.width / view.width, y: box.top + p.y * box.height / view.height }
  }, { x, y })
}

async function click(page: Page, x: number, y: number) {
  const p = await point(page, x, y)
  await page.mouse.click(p.x, p.y)
}

async function drag(page: Page, x: number, y: number, dx = 80, dy = 50, release = true) {
  const start = await point(page, x, y), end = await point(page, x + dx, y + dy)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  if (release) await page.mouse.up()
}

async function newOfKind(page: Page, ids: string[], kind: Kind) {
  return (await annotations(page)).filter(a => !ids.includes(a.id) && a.kind === kind)
}

for (const [name, kind, group] of [
  ['四角', 'square', '図形'], ['線', 'line', '図形'], ['矢印', 'arrow', '図形'],
  ['丸', 'circle', '図形'], ['雲（四角）', 'cloudSquare', '図形'],
  ['蛍光ペン', 'highlight', 'ペン'], ['手書き', 'ink', 'ペン'],
] as const) {
  test(`${name}は選び直さず2つ作れ、選択と道具を保ち、つかみを出さない`, async ({ page }) => {
    await open(page)
    const ids = (await annotations(page)).map(a => a.id)
    await choose(page, group, name)
    await drag(page, 100, 220)
    await expect.poll(async () => (await newOfKind(page, ids, kind)).length).toBe(1)
    // 1.5秒以内のペンの線をまとめる決まりは維持。別の書き込みはその期限後に描く。
    if (kind === 'highlight' || kind === 'ink') await page.waitForTimeout(1600)
    await drag(page, 260, 300)
    await expect.poll(async () => (await newOfKind(page, ids, kind)).length).toBe(2)
    const created = await newOfKind(page, ids, kind)
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(layer(page).locator(`g[data-annotation-id="${created[1].id}"] .annotation-selection`)).toHaveCount(1)
    await expect(layer(page).locator('.annotation-resize-handle')).toHaveCount(0)
    expect(created[0].rect[0]).toBeCloseTo(100, 3)
    expect(created[1].rect[0]).toBeCloseTo(260, 3)
    await selected(page).click()
    await expect(selected(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(layer(page).locator('.annotation-resize-handle')).not.toHaveCount(0)
  })
}

for (const [name, kind] of [['蛍光ペン', 'highlight'], ['手書き', 'ink']] as const) {
  test(`${name}の1.5秒以内の線は同じ書き込みに結合する`, async ({ page }) => {
    await open(page)
    const ids = (await annotations(page)).map(a => a.id)
    await choose(page, 'ペン', name)
    await drag(page, 100, 220)
    await drag(page, 240, 280)
    const created = await newOfKind(page, ids, kind)
    expect(created).toHaveLength(1)
    expect(created[0].inkList).toHaveLength(2)
    expect(created[0].inkList![0][0][0]).toBeCloseTo(100, 3)
    expect(created[0].inkList![1][0][0]).toBeCloseTo(240, 3)
    await expect(layer(page).locator('.annotation-selection')).toHaveCount(1)
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
  })
}

for (const [name, kind] of [['文字', 'freetext'], ['吹き出し', 'callout']] as const) {
  test(`${name}の外側クリックは確定だけで、次のクリックから新しく作る`, async ({ page }) => {
    await open(page)
    const ids = (await annotations(page)).map(a => a.id)
    await choose(page, '文字', name)
    await click(page, 100, 220)
    const editor = page.getByTestId('text-editor')
    await editor.fill('1つ目の文字')
    await click(page, 300, 300)
    await expect(editor).toHaveCount(0)
    expect(await newOfKind(page, ids, kind)).toHaveLength(1)
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await click(page, 300, 300)
    await expect(editor).toBeVisible()
    expect(await newOfKind(page, ids, kind)).toHaveLength(2)
    await editor.fill('2つ目の文字')
    await editor.press('Control+Enter')
    await expect(editor).toHaveCount(0)
    expect((await newOfKind(page, ids, kind)).map(a => a.text)).toEqual(['1つ目の文字', '2つ目の文字'])
    // FreeText の既存文字を1回クリックして編集する。枠の数は増やさない。
    const first = (await newOfKind(page, ids, kind))[0]
    await layer(page).locator(`g[data-annotation-id="${first.id}"] .annotation-hit`).first().click()
    await expect(editor).toHaveValue('1つ目の文字')
    expect(await newOfKind(page, ids, kind)).toHaveLength(2)
    await editor.fill('書き直した文字')
    await editor.press('Control+Enter')
    await expect(editor).toHaveCount(0)
    expect((await newOfKind(page, ids, kind))[0].text).toBe('書き直した文字')
  })
}

test('作成直後の四角の書式・Delete・Undoは道具を保ったまま使える', async ({ page }) => {
  await open(page)
  const ids = (await annotations(page)).map(a => a.id)
  await choose(page, '図形', '四角')
  await drag(page, 100, 220)
  const square = (await newOfKind(page, ids, 'square'))[0]
  await page.getByLabel('枠線の色 青', { exact: true }).click()
  expect((await newOfKind(page, ids, 'square'))[0].borderColor).toEqual([0, 0.25, 1])
  await expect(layer(page).locator(`g[data-annotation-id="${square.id}"] .annotation-square`)).toHaveAttribute('stroke', 'rgb(0 64 255)')
  await expect(page.getByRole('button', { name: '四角', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Delete')
  expect(await newOfKind(page, ids, 'square')).toHaveLength(0)
  await page.keyboard.press('Control+z')
  expect(await newOfKind(page, ids, 'square')).toHaveLength(1)
  await page.keyboard.press('Control+z')
  expect((await newOfKind(page, ids, 'square'))[0].borderColor).toEqual([1, 0, 0])
  await page.keyboard.press('Control+z')
  expect(await newOfKind(page, ids, 'square')).toHaveLength(0)
})

async function setScale(page: Page) {
  await page.getByRole('button', { name: '計測▼' }).click()
  await page.getByRole('menuitem', { name: /縮尺の設定/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('縮尺の分母').fill('100')
  await dialog.getByRole('button', { name: '決定', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

for (const [name, kind] of [['距離', 'distance'], ['連続した長さ', 'perimeter'], ['面積', 'area'], ['雲（多角形）', 'cloudPolygon']] as const) {
  test(`${name}も選び直さず2つ作れる`, async ({ page }) => {
    await open(page)
    const ids = (await annotations(page)).map(a => a.id)
    if (kind !== 'cloudPolygon') await setScale(page)
    await choose(page, kind === 'cloudPolygon' ? '図形' : '計測', name)
    for (const x of [100, 260]) {
      if (kind === 'distance') await drag(page, x, 240, 72, 0)
      else {
        for (const [dx, dy] of [[0, 0], [72, 0], [72, 72]]) await click(page, x + dx, 240 + dy)
        await page.keyboard.press('Enter')
      }
    }
    const created = await newOfKind(page, ids, kind)
    expect(created).toHaveLength(2)
    expect(created[0].vertices).toHaveLength(kind === 'distance' ? 2 : 3)
    expect(created[1].vertices![0][0]).toBeCloseTo(260, 3)
    if (kind === 'distance') expect(created.map(a => a.text)).toEqual(['2,540 mm', '2,540 mm'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(layer(page).locator(kind === 'cloudPolygon' ? '.annotation-selection' : '.annotation-selection-path')).toHaveCount(1)
    await expect(layer(page).locator('[data-measure-vertex]')).toHaveCount(0)
  })
}

test('書式の選択欄にフォーカスがあってもEsc1回で選択とフォーカスを外す', async ({ page }) => {
  await open(page)
  await choose(page, '図形', '四角')
  await drag(page, 100, 220)
  const opacity = page.getByLabel('透明度', { exact: true })
  await opacity.selectOption('0.5')
  await opacity.focus()
  await expect(opacity).toBeFocused()
  await opacity.press('Escape')
  await expect(selected(page)).toHaveAttribute('aria-pressed', 'true')
  // 選択解除で四角の書式欄自体が消えるので、実際のフォーカス先を調べる。
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY')
  await expect(layer(page).locator('.annotation-selection')).toHaveCount(0)
  expect((await annotations(page)).find(a => a.objNum === null && a.kind === 'square')?.opacity).toBe(0.5)
})

async function searchBounds(page: Page) {
  await page.keyboard.press('Control+f')
  const input = page.getByLabel('検索する文字')
  await input.fill('Sample page 1')
  await input.press('Enter')
  const highlight = page.locator('.search-highlight-layer polygon.active')
  await expect(highlight).toBeVisible()
  const box = await highlight.boundingBox()
  if (!box) throw new Error('検索した文字の位置がありません')
  return box
}

test('検索欄からEsc1回で選択に戻り、検索の強調も消える', async ({ page }) => {
  await open(page)
  await choose(page, '図形', '四角')
  await searchBounds(page)
  const input = page.getByLabel('検索する文字')
  await expect(input).toBeFocused()
  await input.press('Escape')
  await expect(selected(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(input).not.toBeFocused()
  await expect(page.locator('.search-highlight-layer polygon')).toHaveCount(0)
})

for (const [name, group] of [['面積', '計測'], ['連続した長さ', '計測'], ['雲（多角形）', '図形']] as const) {
  test(`${name}の2点の描きかけはEsc1回で消え、書き込みを作らない`, async ({ page }) => {
    await open(page)
    if (group === '計測') await setScale(page)
    const before = (await annotations(page)).length
    await choose(page, group, name)
    await click(page, 100, 220)
    await click(page, 200, 280)
    await expect(layer(page).locator('.measurement-draft > *')).not.toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(selected(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(layer(page).locator('.measurement-draft > *')).toHaveCount(0)
    await page.keyboard.press('Enter')
    expect(await annotations(page)).toHaveLength(before)
  })
}

test('指摘の入力はEsc1回で確定し、印を残して選択に戻る', async ({ page }) => {
  await open(page)
  const before = (await annotations(page)).length
  await choose(page, '文字', '指摘')
  await click(page, 100, 220)
  const input = page.getByTestId('issue-editor')
  await input.fill('Escで確定する指摘')
  await input.press('Escape')
  await expect(selected(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(input).toHaveCount(0)
  const items = await annotations(page)
  expect(items).toHaveLength(before + 1)
  expect(items.find(a => a.issue)?.text).toBe('Escで確定する指摘')
  await expect(layer(page).locator('.annotation-issue')).toHaveCount(1)
  await expect(layer(page).locator('.annotation-selection')).toHaveCount(0)
})

for (const name of ['文字', '吹き出し']) {
  test(`${name}の入力はEsc1回で確定して選択に戻る`, async ({ page }) => {
    await open(page)
    const before = (await annotations(page)).length
    await choose(page, '文字', name)
    await click(page, 100, 220)
    const input = page.getByTestId('text-editor')
    await input.fill('Escで確定する文字')
    await input.press('Escape')
    await expect(selected(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(input).toHaveCount(0)
    expect(await annotations(page)).toHaveLength(before + 1)
    expect((await annotations(page)).some(a => a.text === 'Escで確定する文字' && a.layout!.lines.length > 0)).toBe(true)
    await expect(layer(page).locator('.annotation-selection')).toHaveCount(0)
  })
}

test('空の文字は外側クリックでもEscでも削除し、外側クリックは次の枠を作らない', async ({ page }) => {
  await open(page)
  const before = (await annotations(page)).length
  await choose(page, '文字', '文字')
  await click(page, 100, 220)
  await expect(page.getByTestId('text-editor')).toBeVisible()
  await click(page, 300, 300)
  await expect(page.getByTestId('text-editor')).toHaveCount(0)
  expect(await annotations(page)).toHaveLength(before)
  await expect(page.getByRole('button', { name: '文字', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await click(page, 300, 300)
  await page.getByTestId('text-editor').press('Escape')
  await expect(selected(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('text-editor')).toHaveCount(0)
  expect(await annotations(page)).toHaveLength(before)
})

for (const [name, group] of [['四角', '図形'], ['線', '図形'], ['蛍光ペン', 'ペン'], ['手書き', 'ペン']] as const) {
  test(`${name}のドラッグ途中のEsc1回は描きかけを破棄する`, async ({ page }) => {
    await open(page)
    const before = (await annotations(page)).length
    await choose(page, group, name)
    await drag(page, 100, 220, 80, 50, false)
    const draftClass = name === '四角' ? '.annotation-draft' : name === '線' ? '.annotation-line-draft' : '.annotation-ink-draft'
    await expect(layer(page).locator(draftClass)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(selected(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(layer(page).locator(draftClass)).toBeHidden()
    await page.mouse.up()
    expect(await annotations(page)).toHaveLength(before)
  })
}

test('文字選択後のEsc1回で青い選択と操作の帯を消す', async ({ page }) => {
  await open(page)
  const bounds = await searchBounds(page)
  await choose(page, '文字に印', '文字を選択')
  await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width - 2, bounds.y + bounds.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('.text-selection-toolbar')).toBeVisible()
  await expect(layer(page).locator('.text-selection-quads polygon')).not.toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(selected(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.text-selection-toolbar')).toHaveCount(0)
  await expect(layer(page).locator('.text-selection-quads polygon')).toHaveCount(0)
})

test('文字選択の操作帯から作った印も、道具を保って色を変え、Deleteで消せる', async ({ page }) => {
  await open(page)
  const bounds = await searchBounds(page)
  const ids = (await annotations(page)).map(a => a.id)
  await choose(page, '文字に印', '文字を選択')
  await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width - 2, bounds.y + bounds.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.locator('.text-selection-toolbar').getByRole('button', { name: 'ハイライト', exact: true }).click()
  await expect.poll(async () => (await newOfKind(page, ids, 'textHighlight')).length).toBe(1)
  await expect(page.getByRole('button', { name: '文字を選択', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(layer(page).locator('.annotation-selection')).toHaveCount(1)
  await page.getByLabel('色 緑', { exact: true }).click()
  expect((await newOfKind(page, ids, 'textHighlight'))[0].color).toEqual([0.35, 0.9, 0.3])
  await page.keyboard.press('Delete')
  expect(await newOfKind(page, ids, 'textHighlight')).toHaveLength(0)
  await expect(page.getByRole('button', { name: '文字を選択', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('左右に並べた右の表示からもEsc1回で左の道具を選択に戻す', async ({ page }) => {
  await open(page)
  await page.keyboard.press('Control+\\')
  const right = page.getByTestId('right-viewer')
  await expect(right).toBeVisible()
  await choose(page, '図形', '四角')
  await right.click({ position: { x: 30, y: 80 } })
  await expect(right).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(selected(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(right).not.toBeFocused()
})

test('メニュー・縮尺ダイアログ・なぞる途中のEscは道具を保つ', async ({ page }) => {
  await open(page)
  await choose(page, '図形', '四角')
  await drag(page, 100, 220)
  const square = page.getByRole('button', { name: '四角', exact: true })
  await page.getByRole('button', { name: 'ペン▼' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(square).toHaveAttribute('aria-pressed', 'true')
  await expect(layer(page).locator('.annotation-selection')).toHaveCount(1)
  await page.getByRole('button', { name: '計測▼' }).click()
  await page.getByRole('menuitem', { name: /縮尺の設定/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(square).toHaveAttribute('aria-pressed', 'true')
  await expect(layer(page).locator('.annotation-selection')).toHaveCount(1)
  await page.getByRole('button', { name: '計測▼' }).click()
  await page.getByRole('menuitem', { name: /縮尺の設定/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('図面の寸法をなぞって合わせる').check()
  await dialog.getByRole('button', { name: 'なぞる', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await click(page, 100, 220)
  await expect(layer(page).locator('.measurement-draft > *')).not.toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(layer(page).locator('.measurement-draft > *')).toHaveCount(0)
  await expect(square).toHaveAttribute('aria-pressed', 'true')
})

for (const [name, kind] of [['蛍光ペン', 'highlight'], ['手書き', 'ink']] as const) {
  test(`${name}のShift・Ctrl+Shiftは5度刻み、Ctrlは任意角度の2点になる`, async ({ page }) => {
    await open(page)
    const ids = (await annotations(page)).map(a => a.id)
    await choose(page, 'ペン', name)
    for (const [key, x, y, dx, dy] of [
      ['Shift', 100, 220, 100, 58], ['Shift', 260, 220, 100, 10],
      ['Control+Shift', 100, 340, 100, 58], ['Control', 260, 340, 100, 58],
    ] as const) {
      if (key.includes('Control')) await page.keyboard.down('Control')
      if (key.includes('Shift')) await page.keyboard.down('Shift')
      await drag(page, x, y, dx, dy)
      if (key.includes('Shift')) await page.keyboard.up('Shift')
      if (key.includes('Control')) await page.keyboard.up('Control')
    }
    const strokes = (await newOfKind(page, ids, kind)).flatMap(a => a.inkList!)
    expect(strokes).toHaveLength(4)
    strokes.forEach(p => expect(p).toHaveLength(2))
    const deltas = strokes.map(p => [p[1][0] - p[0][0], p[1][1] - p[0][1]])
    expect(Math.atan2(deltas[0][1], deltas[0][0])).toBeCloseTo(30 * Math.PI / 180, 6)
    expect(Math.atan2(deltas[1][1], deltas[1][0])).toBeCloseTo(5 * Math.PI / 180, 6)
    expect(Math.atan2(deltas[2][1], deltas[2][0])).toBeCloseTo(30 * Math.PI / 180, 6)
    expect(deltas[3][0]).toBeCloseTo(100, 3)
    expect(deltas[3][1]).toBeCloseTo(58, 3)
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
  })
}

for (const [name, kind] of [['文字ハイライト', 'textHighlight'], ['文字に下線', 'underline'], ['文字に取り消し線', 'strikeout']] as const) {
  test(`${name}は文字を2回選んで2つ続けて作れる`, async ({ page }) => {
    await open(page)
    const measured = await searchBounds(page)
    const viewerBefore = (await page.getByTestId('viewer').boundingBox())!
    const ids = (await annotations(page)).map(a => a.id)
    await choose(page, '文字に印', name)
    // A longer tool label can wrap the toolbar and move the viewer; follow it.
    const viewerAfter = (await page.getByTestId('viewer').boundingBox())!
    const bounds = { ...measured, x: measured.x + viewerAfter.x - viewerBefore.x, y: measured.y + viewerAfter.y - viewerBefore.y }
    for (let i = 0; i < 2; i += 1) {
      await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2)
      await page.mouse.down()
      await page.mouse.move(bounds.x + bounds.width - 2, bounds.y + bounds.height / 2, { steps: 8 })
      await page.mouse.up()
      await expect.poll(async () => (await newOfKind(page, ids, kind)).length).toBe(i + 1)
    }
    expect((await newOfKind(page, ids, kind)).every(a => a.text.includes('Sample page 1') && a.quads!.length > 0)).toBe(true)
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(layer(page).locator('.annotation-selection')).toHaveCount(1)
    await expect(layer(page).locator('.text-selection-quads polygon')).toHaveCount(0)
  })
}
