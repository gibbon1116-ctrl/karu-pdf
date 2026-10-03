import mupdf, { type PDFDocument, type PDFObject, type PDFPage } from 'mupdf'
import type { Rect } from './annotations'
import { encodeCharacter, type FontResources } from './fontMetrics'
import { extractTextLines } from './textExtract'
import { invertMatrix } from './measure'
import { assertEditablePdf } from './pdfRestrictions'

export interface TextCorrection { pageIndex: number; rect: Rect; originalText: string; text: string; fontSize: number }
function pageText(page: PDFPage) {
  const list = page.toDisplayList(false), structured = list.toStructuredText('preserve-whitespace')
  try { return extractTextLines(structured, page.getBounds(), 0) } finally { structured.destroy(); list.destroy() }
}
function copyDictionary(doc: PDFDocument, source: PDFObject) {
  const result = doc.newDictionary()
  if (source.isDictionary()) for (const key of Object.keys(source.asJS())) {
    const value = source.get(key)
    try { result.put(key, value) } finally { value.destroy() }
  }
  return result
}
function intersect(a: Rect, b: Rect) { return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1] }
function lineKey(line: { text: string; rect: Rect }) { return JSON.stringify([line.text, line.rect.map(n => Math.round(n*100))]) }

/** Called only on an isolated output document, never on the open original. */
export function applyTextCorrection(doc: PDFDocument, input: TextCorrection, fonts: FontResources): void {
  assertEditablePdf(doc)
  if (!Number.isInteger(input.pageIndex) || input.pageIndex < 0 || input.pageIndex >= doc.countPages()
    || input.rect.length !== 4 || input.rect.some(n => !Number.isFinite(n)) || !input.originalText.trim()
    || !input.text.trim() || input.text.length > 200 || /[\r\n]/.test(input.text) || !Number.isFinite(input.fontSize) || input.fontSize < 4 || input.fontSize > 72) throw new Error('横書き1行を選び、200文字以内の修正文を入力してください。')
  const font = fonts.BIZUDGothic
  if (!font) throw new Error('修正用のフォントを読み込めませんでした。')
  const page = doc.loadPage(input.pageIndex), object = page.getObject()
  const rotation = object.getInheritable('Rotate'), resources = object.getInheritable('Resources'), xobjects = resources.get('XObject'), contents = object.get('Contents')
  try {
    if (rotation.asNumber()%360 !== 0) throw new Error('回転ページの本文修正は対象外です。訂正注釈を使用してください。')
    if (xobjects.isDictionary()) for (const key of Object.keys(xobjects.asJS())) {
      const value = xobjects.get(key), type = value.get('Subtype')
      try { if (type.asName() === 'Form') throw new Error('Formを含む図面は安全な本文修正の対象外です。訂正注釈を使用してください。') }
      finally { type.destroy(); value.destroy() }
    }
    const streams = contents.isArray() ? Array.from({ length: contents.length }, (_,i) => contents.get(i)) : [contents.get()]
    try {
      for (const stream of streams) {
        if (!stream.isStream()) throw new Error('本文の構造を確認できませんでした。')
        const buffer = stream.readStream()
        try {
          if (buffer.length > 2*1024*1024 || /(?:^|\s)(?:W\*?|[4-7]\s+Tr)(?=\s|$)/.test(buffer.asString())) throw new Error('複雑なクリッピングを含む図面は訂正注釈を使用してください。')
        } finally { buffer.destroy() }
      }
    } finally { streams.forEach(s => s.destroy()) }
    const before = pageText(page)
    if (before.truncated || before.invalidPositions || before.uncertainCharacters) throw new Error('文字と位置を安全に特定できませんでした。')
    const selected = before.lines.filter(l => l.text.trim() === input.originalText.trim() && l.rect.every((n,i) => Math.abs(n-input.rect[i]) < 1.5))
    if (selected.length !== 1 || selected[0].writingMode !== 0 || Math.abs(selected[0].direction[0]-1) > .001 || Math.abs(selected[0].direction[1]) > .001) throw new Error('本文修正は横書き1行全体を選択してください。その他は訂正注釈を使用できます。')
    const rect = selected[0].rect
    if (before.lines.some(l => l !== selected[0] && intersect(l.rect, rect))) throw new Error('近接する文字と重なるため、安全に本文修正できません。')
    const glyphs = [...input.text].map(ch => encodeCharacter(font.font, ch))
    if (glyphs.some(g => g.replaced || g.glyph > 65535)) throw new Error('修正用フォントで表示できない文字があります。')
    if (glyphs.reduce((n,g)=>n+g.advance,0)*input.fontSize > rect[2]-rect[0] || input.fontSize*1.2 > rect[3]-rect[1]+.5) throw new Error('修正文が元の範囲に収まりません。文字サイズを小さくしてください。')
    const redaction = page.createAnnotation('Redact')
    try {
      redaction.setRect(rect); redaction.update()
      redaction.applyRedaction(0, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE)
    } finally { redaction.destroy() }
    const remaining = pageText(page)
    if (JSON.stringify(remaining.lines.map(lineKey)) !== JSON.stringify(before.lines.filter(l=>l!==selected[0]).map(lineKey))) throw new Error('対象外の文字にも変化があったため修正を中止しました。')
    const newResources = copyDictionary(doc, resources), oldFonts = resources.get('Font'), fontDictionary = copyDictionary(doc, oldFonts)
    const reference = doc.addFont(font.font), resourceName = `KaruCorrection_${crypto.randomUUID().replaceAll('-','')}`
    const inverse = invertMatrix(page.getTransform())
    const baseline = rect[1]+font.ascent*input.fontSize
    const content = `q ${inverse.join(' ')} cm BT /${resourceName} ${input.fontSize} Tf 0 0 0 rg 1 0 0 -1 ${rect[0]} ${baseline} Tm <${glyphs.map(g=>g.glyph.toString(16).padStart(4,'0')).join('')}> Tj ET Q\n`
    const stream = doc.addStream(content, {}), oldContents = object.get('Contents'), array = doc.newArray()
    try {
      fontDictionary.put(resourceName, reference); newResources.put('Font',fontDictionary); object.put('Resources',newResources)
      if (oldContents.isArray()) for (let i=0;i<oldContents.length;i++) { const value=oldContents.get(i); try { array.push(value) } finally { value.destroy() } }
      else if (!oldContents.isNull()) array.push(oldContents)
      array.push(stream); object.put('Contents',array)
    } finally { array.destroy(); oldContents.destroy(); stream.destroy(); reference.destroy(); fontDictionary.destroy(); oldFonts.destroy(); newResources.destroy() }
    const verifiedPage = doc.loadPage(input.pageIndex)
    try {
      const after = pageText(verifiedPage)
      if (!after.lines.some(l => l.text === input.text)) throw new Error('修正文の再抽出を確認できなかったため中止しました。')
    } finally { verifiedPage.destroy() }
  } finally { contents.destroy(); xobjects.destroy(); resources.destroy(); rotation.destroy(); object.destroy(); page.destroy() }
}
