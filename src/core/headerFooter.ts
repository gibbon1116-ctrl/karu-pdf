import mupdf, { type Matrix, type PDFDocument, type PDFObject, type PDFPage } from 'mupdf'
import { composeHeaderFooterText, pageNumberMap, type HeaderFooterField, type HeaderFooterSettings } from '../app/headerFooterText'
import { encodeCharacter, replaceMissingCharacters, type FontResource } from './fontMetrics'

const MM_TO_PT = 72 / 25.4
const FIELD_LAYOUT: Array<{ field: HeaderFooterField; vertical: 'top' | 'bottom'; horizontal: 'left' | 'center' | 'right' }> = [
  { field: 'topLeft', vertical: 'top', horizontal: 'left' }, { field: 'topCenter', vertical: 'top', horizontal: 'center' }, { field: 'topRight', vertical: 'top', horizontal: 'right' },
  { field: 'bottomLeft', vertical: 'bottom', horizontal: 'left' }, { field: 'bottomCenter', vertical: 'bottom', horizontal: 'center' }, { field: 'bottomRight', vertical: 'bottom', horizontal: 'right' },
]

function root(document: PDFDocument): PDFObject { return document.getTrailer().get('Root') }

export function getHeaderFooterSettings(document: PDFDocument): HeaderFooterSettings | null {
  const catalog = root(document)
  const value = catalog.get('KaruHeaderFooter')
  try {
    if (!value.isString()) return null
    return JSON.parse(value.asString()) as HeaderFooterSettings
  } catch { return null }
  finally { value.destroy(); catalog.destroy() }
}

function saveSettings(document: PDFDocument, settings: HeaderFooterSettings): void {
  const catalog = root(document)
  const value = document.newString(JSON.stringify(settings))
  try { catalog.put('KaruHeaderFooter', value) }
  finally { value.destroy(); catalog.destroy() }
}

function marked(stream: PDFObject): boolean {
  const flag = stream.get('KaruHeaderFooter')
  try { return flag.isBoolean() && flag.asBoolean() } finally { flag.destroy() }
}

// 内容ストリームは、間接参照のまま扱う。resolve() した辞書に isStream() を聞くと
// 常に false になり、元のページの内容をすべて捨ててしまう。
function originalContents(document: PDFDocument, pageObject: PDFObject): PDFObject[] {
  const contents = pageObject.get('Contents')
  const items: PDFObject[] = []
  if (contents.isArray()) {
    try {
      for (let index = 0; index < contents.length; index += 1) items.push(contents.get(index))
    } finally { contents.destroy() }
  } else if (contents.isNull()) {
    contents.destroy()
  } else {
    items.push(contents)
  }
  return items.filter((item) => {
    if (item.isStream() && !marked(item)) return true
    item.destroy()
    return false
  })
}

function setContents(document: PDFDocument, pageObject: PDFObject, originals: PDFObject[], drawing?: string): void {
  const array = document.newArray()
  const before = drawing ? document.addStream('q\n', { KaruHeaderFooter: true }) : undefined
  const after = drawing ? document.addStream(`Q\n${drawing}`, { KaruHeaderFooter: true }) : undefined
  try {
    if (before) array.push(before)
    originals.forEach((item) => array.push(item))
    if (after) array.push(after)
    pageObject.put('Contents', array)
  } finally {
    before?.destroy(); after?.destroy(); array.destroy(); originals.forEach((item) => item.destroy())
  }
}

function removeStreams(document: PDFDocument): void {
  for (let index = 0; index < document.countPages(); index += 1) {
    const page = document.findPage(index)
    try { setContents(document, page, originalContents(document, page)) } finally { page.destroy() }
  }
}

function pdfNumber(value: number): string { return Number(value.toFixed(5)).toString() }
function hex(value: number, digits: number): string { return Math.max(0, value).toString(16).padStart(digits, '0').slice(-digits) }

interface InstalledFonts { primary: PDFObject; fallback?: PDFObject }

function installSubsetFonts(document: PDFDocument, text: string, primary: FontResource, fallback: FontResource): InstalledFonts {
  const temporary = new mupdf.PDFDocument()
  const glyphText = [...new Set([...text, ' '])]
  const pageObject = temporary.addPage([0, 0, Math.max(100, glyphText.length * 20), 100], 0, {}, '')
  temporary.insertPage(-1, pageObject)
  pageObject.destroy()
  const page = temporary.loadPage(0)
  const annotation = page.createAnnotation('FreeText')
  const list = new mupdf.DisplayList([0, 0, Math.max(100, glyphText.length * 20), 100])
  const device = new mupdf.DisplayListDevice(list)
  const shown = new mupdf.Text()
  let graft: ReturnType<PDFDocument['newGraftMap']> | undefined
  try {
    let x = 5
    for (const character of glyphText) {
      const encoded = encodeCharacter(primary.font, character, fallback.font)
      shown.showGlyph(encoded.font, [10, 0, 0, -10, x, 30], encoded.glyph, encoded.unicode)
      x += Math.max(2, encoded.advance * 10)
    }
    device.fillText(shown, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, [0, 0, 0], 1)
    device.close()
    annotation.setAppearanceFromDisplayList(null, null, mupdf.Matrix.identity, list)
    temporary.subsetFonts()
    const object = annotation.getObject()
    const fonts = object.get('AP', 'N', 'Resources', 'Font')
    graft = document.newGraftMap()
    let primaryObject: PDFObject | undefined
    let fallbackObject: PDFObject | undefined
    try {
      fonts.forEach((font) => {
        const description = font.toString(false, true)
        const moved = graft!.graftObject(font)
        if (/ZapfDingbats/i.test(description)) fallbackObject = moved
        else primaryObject = moved
      })
    } finally { fonts.destroy(); object.destroy() }
    if (!primaryObject) throw new Error('ページ番号用のフォントを作れませんでした。')
    return { primary: primaryObject, fallback: fallbackObject }
  } finally {
    graft?.destroy(); shown.destroy(); device.destroy(); list.destroy(); annotation.destroy(); page.destroy(); temporary.destroy()
  }
}

function copyResources(document: PDFDocument, pageObject: PDFObject, fonts: InstalledFonts): void {
  const inherited = pageObject.getInheritable('Resources')
  const resources = document.newDictionary()
  const fontDictionary = document.newDictionary()
  try {
    if (inherited.isDictionary()) inherited.forEach((value, key) => resources.put(key, value))
    const inheritedFonts = inherited.get('Font')
    try { if (inheritedFonts.isDictionary()) inheritedFonts.forEach((value, key) => fontDictionary.put(key, value)) }
    finally { inheritedFonts.destroy() }
    fontDictionary.put('KaruHF', fonts.primary)
    if (fonts.fallback) fontDictionary.put('KaruHFD', fonts.fallback)
    resources.put('Font', fontDictionary)
    pageObject.put('Resources', resources)
  } finally { fontDictionary.destroy(); resources.destroy(); inherited.destroy() }
}

function textCommand(text: string, x: number, baseline: number, settings: HeaderFooterSettings, primary: FontResource, fallback: FontResource): string {
  // 文字の大きさは Tf だけで指定する。Tm にも掛けると、大きさの2乗になる。
  // Tm の -1 は、上から下へ測る座標（見えている向きのページ）で文字を正立させるため。
  const commands: string[] = ['BT', `${pdfNumber(settings.color[0])} ${pdfNumber(settings.color[1])} ${pdfNumber(settings.color[2])} rg`, `1 0 0 -1 ${pdfNumber(x)} ${pdfNumber(baseline)} Tm`]
  let current = ''
  let fallbackRun = false
  const flush = () => {
    if (!current) return
    commands.push(`/${fallbackRun ? 'KaruHFD' : 'KaruHF'} ${pdfNumber(settings.fontSize)} Tf <${current}> Tj`)
    current = ''
  }
  // MuPDF の Type0 サブセットでは、文字列の末尾の CID が次の位置情報なしでは
  // 抽出から落ちることがあるため、幅に含めない空白を終端に置く。
  for (const character of [...text, ' ']) {
    const encoded = encodeCharacter(primary.font, character, fallback.font)
    if (current && fallbackRun !== encoded.usedFallback) flush()
    fallbackRun = encoded.usedFallback
    current += hex(encoded.glyph, fallbackRun ? 2 : 4)
  }
  flush()
  commands.push('ET')
  return commands.join('\n')
}

function transformCommand(matrix: Matrix): string { return matrix.map(pdfNumber).join(' ') + ' cm' }

function pageDrawing(page: PDFPage, texts: Array<{ field: HeaderFooterField; text: string }>, settings: HeaderFooterSettings, primary: FontResource, fallback: FontResource): string {
  const bounds = page.getBounds()
  const inverse = mupdf.Matrix.invert(page.getTransform())
  const horizontalMargin = settings.horizontalMarginMm * MM_TO_PT
  const verticalMargin = settings.verticalMarginMm * MM_TO_PT
  const commands = ['q', transformCommand(inverse)]
  for (const item of texts) {
    const layout = FIELD_LAYOUT.find((candidate) => candidate.field === item.field)!
    const width = [...item.text].reduce((sum, character) => sum + encodeCharacter(primary.font, character, fallback.font).advance * settings.fontSize, 0)
    const x = layout.horizontal === 'left' ? bounds[0] + horizontalMargin : layout.horizontal === 'center' ? (bounds[0] + bounds[2] - width) / 2 : bounds[2] - horizontalMargin - width
    const baseline = layout.vertical === 'top'
      ? bounds[1] + verticalMargin + primary.ascent * settings.fontSize
      : bounds[3] - verticalMargin - (1 - primary.ascent) * settings.fontSize
    commands.push(`/Artifact <</Type /Pagination /Subtype /${layout.vertical === 'top' ? 'Header' : 'Footer'}>> BDC`)
    commands.push(textCommand(item.text, x, baseline, settings, primary, fallback), 'EMC')
  }
  commands.push('Q')
  return commands.join('\n')
}

export function applyHeaderFooter(document: PDFDocument, settings: HeaderFooterSettings, fileName: string, dateText: string, primary: FontResource, fallback: FontResource): { replacedCharacters: number; unsupportedCharacters: string[] } {
  const numbering = pageNumberMap(settings, document.countPages())
  if (numbering.error) throw new Error(numbering.error)
  removeStreams(document)
  const pageTexts = new Map<number, Array<{ field: HeaderFooterField; text: string }>>()
  for (const [pageIndex, number] of numbering.numbers) {
    const entries: Array<{ field: HeaderFooterField; text: string }> = []
    for (const { field } of FIELD_LAYOUT) {
      const value = composeHeaderFooterText(settings.fields[field], { page: number, total: numbering.total, date: dateText, fileName })
      if (value) entries.push({ field, text: value })
    }
    pageTexts.set(pageIndex, entries)
  }
  const allText = [...pageTexts.values()].flat().map((entry) => entry.text).join('')
  const replaced = replaceMissingCharacters(primary.font, allText, fallback.font)
  const fonts = installSubsetFonts(document, replaced.text || ' ', primary, fallback)
  try {
    for (const [pageIndex, entries] of pageTexts) {
      const page = document.loadPage(pageIndex)
      const pageObject = page.getObject()
      try {
        copyResources(document, pageObject, fonts)
        setContents(document, pageObject, originalContents(document, pageObject), pageDrawing(page, entries, settings, primary, fallback))
      } finally { pageObject.destroy(); page.destroy() }
    }
    saveSettings(document, settings)
  } finally { fonts.primary.destroy(); fonts.fallback?.destroy() }
  return { replacedCharacters: replaced.replacedCharacters, unsupportedCharacters: replaced.unsupportedCharacters }
}

export function removeHeaderFooter(document: PDFDocument): void {
  removeStreams(document)
  const catalog = root(document)
  try { catalog.delete('KaruHeaderFooter') } finally { catalog.destroy() }
}
