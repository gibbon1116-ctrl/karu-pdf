import mupdf, { type PDFDocument, type PDFObject } from 'mupdf'
import type { PageSize } from './mupdfDoc'

export type PageRotation = 0 | 90 | 180 | 270

export type PageLayoutSource =
  | { kind: 'page'; docId: string; pageIndex: number }
  | { kind: 'blank'; width: number; height: number }

export interface PageLayoutCard {
  id: string
  source: PageLayoutSource
  rotation: PageRotation
}

export interface PageInfo extends PageSize {
  rotation: PageRotation
  text: string
}

function normalizedRotation(value: number): PageRotation {
  return ((Math.round(value / 90) * 90 % 360 + 360) % 360) as PageRotation
}

function readRotation(pageObject: PDFObject): PageRotation {
  const rotate = pageObject.getInheritable('Rotate')
  try {
    return rotate.isNumber() ? normalizedRotation(rotate.asNumber()) : 0
  } finally {
    rotate.destroy()
  }
}

function rotatePage(document: PDFDocument, pageIndex: number, additional: PageRotation): void {
  if (additional === 0) return
  const pageObject = document.findPage(pageIndex)
  try {
    pageObject.put('Rotate', normalizedRotation(readRotation(pageObject) + additional))
  } finally {
    pageObject.destroy()
  }
}

function sourceDocument(
  targetDocId: string,
  target: PDFDocument,
  sourceDocId: string,
  sources: ReadonlyMap<string, PDFDocument>,
): PDFDocument {
  if (sourceDocId === targetDocId) return target
  const source = sources.get(sourceDocId)
  if (!source) throw new Error(`追加元の PDF が見つかりません: ${sourceDocId}`)
  return source
}

function addBlank(document: PDFDocument, width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) throw new Error('白紙の大きさが正しくありません。')
  const page = document.addPage([0, 0, width, height], 0, {}, '')
  try {
    document.insertPage(-1, page)
  } finally {
    page.destroy()
  }
  return document.countPages() - 1
}

function existingAcroForm(document: PDFDocument): PDFObject | null {
  const root = document.getTrailer().get('Root')
  try {
    const acroForm = root.get('AcroForm')
    if (!acroForm.isNull()) return acroForm
    acroForm.destroy()
    return null
  } finally {
    root.destroy()
  }
}

function topLevelField(widgetObject: PDFObject): PDFObject {
  let current = widgetObject
  for (;;) {
    const parent = current.get('Parent')
    if (parent.isNull()) {
      parent.destroy()
      return current
    }
    current.destroy()
    current = parent
  }
}

function rebuildAcroFormFields(document: PDFDocument, preservedAcroForm: PDFObject | null): void {
  const fields = document.newArray()
  const seen = new Set<string>()
  let fieldCount = 0
  try {
    for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
      const page = document.loadPage(pageIndex)
      try {
        const widgets = page.getWidgets()
        try {
          for (const widget of widgets) {
            const field = topLevelField(widget.getObject())
            try {
              const key = field.isIndirect()
                ? `indirect:${field.asIndirect()}`
                : `direct:${field.toString(true, true)}`
              if (seen.has(key)) continue
              seen.add(key)
              fields.push(field)
              fieldCount += 1
            } finally {
              field.destroy()
            }
          }
        } finally {
          widgets.forEach((widget) => widget.destroy())
        }
      } finally {
        page.destroy()
      }
    }

    if (!preservedAcroForm && fieldCount === 0) return
    const acroForm = preservedAcroForm ?? document.newDictionary()
    const root = document.getTrailer().get('Root')
    try {
      acroForm.put('Fields', fields)
      root.put('AcroForm', acroForm)
    } finally {
      root.destroy()
      if (!preservedAcroForm) acroForm.destroy()
    }
  } finally {
    fields.destroy()
    preservedAcroForm?.destroy()
  }
}

export function applyPageLayout(
  targetDocId: string,
  target: PDFDocument,
  cards: readonly PageLayoutCard[],
  sources: ReadonlyMap<string, PDFDocument>,
): void {
  if (cards.length === 0) throw new Error('PDF には1ページ以上必要です。')
  const originalPageCount = target.countPages()
  const order: number[] = []

  for (const card of cards) {
    if (card.source.kind === 'blank') {
      order.push(addBlank(target, card.source.width, card.source.height))
      continue
    }
    if (card.source.docId === targetDocId) {
      if (card.source.pageIndex < 0 || card.source.pageIndex >= originalPageCount) {
        throw new Error(`元のページ番号が範囲外です: ${card.source.pageIndex + 1}`)
      }
      order.push(card.source.pageIndex)
      continue
    }
    const source = sourceDocument(targetDocId, target, card.source.docId, sources)
    if (card.source.pageIndex < 0 || card.source.pageIndex >= source.countPages()) {
      throw new Error(`追加元のページ番号が範囲外です: ${card.source.pageIndex + 1}`)
    }
    const appended = target.countPages()
    target.graftPage(-1, source, card.source.pageIndex)
    order.push(appended)
  }

  const acroForm = existingAcroForm(target)
  try {
    target.rearrangePages(order)
  } catch (error) {
    acroForm?.destroy()
    throw error
  }
  rebuildAcroFormFields(target, acroForm)
  cards.forEach((card, index) => rotatePage(target, index, card.rotation))
}

export function extractPages(
  targetDocId: string,
  target: PDFDocument,
  cards: readonly PageLayoutCard[],
  sources: ReadonlyMap<string, PDFDocument>,
): Uint8Array {
  if (cards.length === 0) throw new Error('抽出するページを選んでください。')
  const output = new mupdf.PDFDocument()
  try {
    cards.forEach((card, index) => {
      if (card.source.kind === 'blank') addBlank(output, card.source.width, card.source.height)
      else output.graftPage(-1, sourceDocument(targetDocId, target, card.source.docId, sources), card.source.pageIndex)
      rotatePage(output, index, card.rotation)
    })
    const buffer = output.saveToBuffer('garbage=4,compress,compress-images')
    try {
      return new Uint8Array(buffer.asUint8Array())
    } finally {
      buffer.destroy()
    }
  } finally {
    output.destroy()
  }
}

export function splitPages(
  targetDocId: string,
  target: PDFDocument,
  groups: readonly (readonly PageLayoutCard[])[],
  sources: ReadonlyMap<string, PDFDocument>,
): Uint8Array[] {
  if (groups.length === 0 || groups.some((group) => group.length === 0)) {
    throw new Error('分割するページの区切りが正しくありません。')
  }
  return groups.map((group) => extractPages(targetDocId, target, group, sources))
}

export function getPageInfo(document: PDFDocument): PageInfo[] {
  const result: PageInfo[] = []
  for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
    const pageObject = document.findPage(pageIndex)
    const page = document.loadPage(pageIndex)
    try {
      const [x0, y0, x1, y1] = page.getBounds()
      const structured = page.toStructuredText('preserve-whitespace')
      try {
        result.push({
          width: x1 - x0,
          height: y1 - y0,
          rotation: readRotation(pageObject),
          text: structured.asText().replace(/\s+/g, ' ').trim().slice(0, 30),
        })
      } finally {
        structured.destroy()
      }
    } finally {
      page.destroy()
      pageObject.destroy()
    }
  }
  return result
}

export function getPageSizes(document: PDFDocument): PageSize[] {
  const result: PageSize[] = []
  for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
    const page = document.loadPage(pageIndex)
    try {
      const [x0, y0, x1, y1] = page.getBounds()
      result.push({ width: x1 - x0, height: y1 - y0 })
    } finally {
      page.destroy()
    }
  }
  return result
}
