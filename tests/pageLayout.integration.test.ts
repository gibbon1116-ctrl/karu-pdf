import mupdf, { type PDFDocument } from 'mupdf'
import { describe, expect, it } from 'vitest'
import { applyEdits, listAnnotations } from '../src/core/annotations'
import { applyPageLayout, extractPages, getPageInfo, splitPages, type PageLayoutCard } from '../src/core/pageOps'

function makeDocument(labels: readonly string[], width = 300, height = 400): PDFDocument {
  const document = new mupdf.PDFDocument()
  for (const label of labels) {
    const page = document.addPage(
      [0, 0, width, height],
      0,
      { Font: { F1: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' } } },
      `BT /F1 18 Tf 40 80 Td (${label}) Tj ET`,
    )
    try { document.insertPage(-1, page) } finally { page.destroy() }
  }
  return document
}

function cards(docId: string, count: number): PageLayoutCard[] {
  return Array.from({ length: count }, (_, pageIndex) => ({
    id: `${docId}-${pageIndex}`,
    source: { kind: 'page', docId, pageIndex },
    rotation: 0,
  }))
}

function addTextWidget(document: PDFDocument, pageIndex: number, name: string, value = `${name}-value`): void {
  const page = document.loadPage(pageIndex)
  try {
    const widget = page.createAnnotation('Widget')
    try {
      widget.setRect([20, 20, 120, 45])
      const object = widget.getObject()
      const fieldType = document.newName('Tx')
      const fieldName = document.newString(name)
      const fieldValue = document.newString(value)
      const defaultAppearance = document.newString('/Helv 10 Tf 0 g')
      try {
        object.put('FT', fieldType)
        object.put('T', fieldName)
        object.put('V', fieldValue)
        const root = document.getTrailer().get('Root')
        let form = root.get('AcroForm')
        if (form.isNull()) {
          form.destroy()
          const formDictionary = document.newDictionary()
          try { form = document.addObject(formDictionary) } finally { formDictionary.destroy() }
        }
        let fields = form.get('Fields')
        if (!fields.isArray()) {
          fields.destroy()
          fields = document.newArray()
        }
        try {
          fields.push(object)
          form.put('Fields', fields)
          form.put('DA', defaultAppearance)
          form.put('DR', {})
          form.put('NeedAppearances', true)
          root.put('AcroForm', form)
        } finally {
          root.destroy()
          form.destroy()
          fields.destroy()
        }
      } finally {
        defaultAppearance.destroy()
        fieldValue.destroy()
        fieldName.destroy()
        fieldType.destroy()
        object.destroy()
      }
      widget.update()
    } finally { widget.destroy() }
  } finally { page.destroy() }
}

function wrapWidgetInParentField(document: PDFDocument, pageIndex: number): void {
  const page = document.loadPage(pageIndex)
  try {
    const widgets = page.getWidgets()
    try {
      const widgetObject = widgets[0].getObject()
      const parentDictionary = document.newDictionary()
      const kids = document.newArray()
      try {
        for (const key of ['FT', 'T', 'V']) {
          const value = widgetObject.get(key)
          try { parentDictionary.put(key, value) } finally { value.destroy() }
          widgetObject.delete(key)
        }
        kids.push(widgetObject)
        parentDictionary.put('Kids', kids)
        const parent = document.addObject(parentDictionary)
        try {
          widgetObject.put('Parent', parent)
          const fields = document.newArray()
          const acroForm = document.getTrailer().get('Root', 'AcroForm')
          try {
            fields.push(parent)
            acroForm.put('Fields', fields)
          } finally {
            acroForm.destroy()
            fields.destroy()
          }
        } finally { parent.destroy() }
      } finally {
        kids.destroy()
        parentDictionary.destroy()
        widgetObject.destroy()
      }
    } finally { widgets.forEach((widget) => widget.destroy()) }
  } finally { page.destroy() }
}

describe('pageOps', () => {
  it('並べ替え・削除・回転・白紙・別PDFの追加を一度に適用する', () => {
    const main = makeDocument(['Page 1', 'Page 2', 'Page 3', 'Page 4'])
    const source = makeDocument(['Source 1', 'Source 2'], 200, 250)
    try {
      const original = cards('main', 4)
      const added = cards('source', 2)
      const layout: PageLayoutCard[] = [
        { ...original[2], rotation: 90 },
        original[0],
        { id: 'blank', source: { kind: 'blank', width: 300, height: 400 }, rotation: 0 },
        added[1],
      ]
      applyPageLayout('main', main, layout, new Map([['source', source]]))
      const info = getPageInfo(main)
      expect(info).toHaveLength(4)
      expect(info.map((item) => item.text)).toEqual(['Page 3', 'Page 1', '', 'Source 2'])
      expect(info.map((item) => item.rotation)).toEqual([90, 0, 0, 0])
      expect(info[2]).toMatchObject({ width: 300, height: 400 })
    } finally {
      source.destroy()
      main.destroy()
    }
  })

  it('注釈は移動したページに残る', () => {
    const document = makeDocument(['Page 1', 'Page 2', 'Page 3'])
    try {
      const applied = applyEdits(document, [{
        kind: 'createSquare', pageIndex: 1, rect: [20, 30, 80, 90], color: [1, 0, 0], borderWidth: 2, interiorColor: null,
      }], {})
      expect(applied.errors).toEqual([])
      applyPageLayout('main', document, [cards('main', 3)[1], cards('main', 3)[0]], new Map())
      expect(listAnnotations(document, 0)).toHaveLength(1)
      expect(listAnnotations(document, 0)[0].rect).toEqual([20, 30, 80, 90])
      expect(listAnnotations(document, 1)).toHaveLength(0)
    } finally {
      document.destroy()
    }
  })

  it('抽出と分割で順番と回転を保つ', () => {
    const document = makeDocument(['Page 1', 'Page 2', 'Page 3', 'Page 4'])
    try {
      const original = cards('main', 4)
      const selected: PageLayoutCard[] = [{ ...original[3], rotation: 180 }, original[1], original[0]]
      const extractedBytes = extractPages('main', document, selected, new Map())
      const extracted = new mupdf.PDFDocument(extractedBytes)
      try {
        expect(getPageInfo(extracted).map((item) => [item.text, item.rotation]))
          .toEqual([['Page 4', 180], ['Page 2', 0], ['Page 1', 0]])
      } finally { extracted.destroy() }

      const outputs = splitPages('main', document, [selected.slice(0, 1), selected.slice(1)], new Map())
      expect(outputs).toHaveLength(2)
      const first = new mupdf.PDFDocument(outputs[0])
      const second = new mupdf.PDFDocument(outputs[1])
      try {
        expect(getPageInfo(first).map((item) => item.text)).toEqual(['Page 4'])
        expect(getPageInfo(second).map((item) => item.text)).toEqual(['Page 2', 'Page 1'])
      } finally {
        first.destroy()
        second.destroy()
      }
    } finally {
      document.destroy()
    }
  })

  it('適用前のバイト列を開き直すと元の並びへ戻る', () => {
    const document = makeDocument(['Page 1', 'Page 2', 'Page 3'])
    let backup: Uint8Array
    const buffer = document.saveToBuffer('compress')
    try { backup = new Uint8Array(buffer.asUint8Array()) } finally { buffer.destroy() }
    try {
      applyPageLayout('main', document, [cards('main', 3)[2], cards('main', 3)[0]], new Map())
      expect(getPageInfo(document).map((item) => item.text)).toEqual(['Page 3', 'Page 1'])
      const restored = new mupdf.PDFDocument(backup)
      try { expect(getPageInfo(restored).map((item) => item.text)).toEqual(['Page 1', 'Page 2', 'Page 3']) }
      finally { restored.destroy() }
    } finally {
      document.destroy()
    }
  })

  it('rearrangePages と graftPage のしおり・リンク・フォームの扱いを記録する', () => {
    const document = makeDocument(['Page 1', 'Page 2', 'Page 3'])
    const source = makeDocument(['Form source'])
    try {
      addTextWidget(document, 2, 'mainField')
      wrapWidgetInParentField(document, 2)
      addTextWidget(document, 1, 'deletedField')
      const formBefore = document.getTrailer().get('Root', 'AcroForm')
      try { expect(formBefore.isIndirect() || formBefore.isDictionary()).toBe(true) } finally { formBefore.destroy() }
      const outline = document.outlineIterator()
      try {
        outline.insert({ title: 'Page 3 bookmark', uri: '#page=3', page: 2, open: false })
        outline.insert({ title: 'Deleted page bookmark', uri: '#page=2', page: 1, open: false })
      } finally { outline.destroy() }
      const firstPage = document.loadPage(0)
      try {
        const link = firstPage.createLink([10, 10, 80, 30], '#page=3')
        link.destroy()
      } finally { firstPage.destroy() }

      const sourcePage = source.loadPage(0)
      try {
        const sourceLink = sourcePage.createLink([140, 20, 240, 45], 'https://example.com/')
        sourceLink.destroy()
        const sourceLinks = sourcePage.getLinks()
        try { expect(sourceLinks).toHaveLength(1) } finally { sourceLinks.forEach((link) => link.destroy()) }
      } finally { sourcePage.destroy() }
      addTextWidget(source, 0, 'sourceField')
      const sourcePageWithWidget = source.loadPage(0)
      try {
        const sourceWidgets = sourcePageWithWidget.getWidgets()
        try { expect(sourceWidgets).toHaveLength(1) } finally { sourceWidgets.forEach((item) => item.destroy()) }
      } finally { sourcePageWithWidget.destroy() }
      const sourceOutline = source.outlineIterator()
      try { sourceOutline.insert({ title: 'Source bookmark', uri: '#page=1', page: 0, open: false }) } finally { sourceOutline.destroy() }

      const layout: PageLayoutCard[] = [cards('main', 3)[2], cards('main', 3)[0], cards('source', 1)[0]]
      applyPageLayout('main', document, layout, new Map([['source', source]]))

      const afterOutline = document.loadOutline() ?? []
      expect(afterOutline.map((item) => item.title)).toEqual(['Page 3 bookmark'])
      expect(afterOutline[0]).toMatchObject({ page: 0, uri: '#page=1' })
      const formPage = document.loadPage(0)
      try {
        const widgets = formPage.getWidgets()
        try {
          expect(widgets).toHaveLength(1)
          expect(widgets[0].getName()).toBe('mainField')
          expect(widgets[0].getValue()).toBe('mainField-value')
        } finally { widgets.forEach((widget) => widget.destroy()) }
      } finally { formPage.destroy() }
      const linkedPage = document.loadPage(1)
      try {
        const links = linkedPage.getLinks()
        try {
          expect(links).toHaveLength(1)
          expect(document.resolveLink(links[0])).toBe(0)
        } finally { links.forEach((link) => link.destroy()) }
      } finally { linkedPage.destroy() }
      const graftedPage = document.loadPage(2)
      try {
        const graftedLinks = graftedPage.getLinks()
        try {
          expect(graftedLinks).toHaveLength(0)
        } finally { graftedLinks.forEach((link) => link.destroy()) }
        const widgets = graftedPage.getWidgets()
        try { expect(widgets).toHaveLength(0) } finally { widgets.forEach((widget) => widget.destroy()) }
      } finally { graftedPage.destroy() }
      const acroForm = document.getTrailer().get('Root', 'AcroForm')
      try {
        expect(acroForm.isIndirect() || acroForm.isDictionary()).toBe(true)
        const fields = acroForm.get('Fields')
        const defaultAppearance = acroForm.get('DA')
        const resources = acroForm.get('DR')
        const needAppearances = acroForm.get('NeedAppearances')
        try {
          expect(fields.length).toBe(1)
          expect(fields.get(0).get('T').asString()).toBe('mainField')
          expect(defaultAppearance.asString()).toBe('/Helv 10 Tf 0 g')
          expect(resources.isDictionary()).toBe(true)
          expect(needAppearances.asBoolean()).toBe(true)
        } finally {
          needAppearances.destroy()
          resources.destroy()
          defaultAppearance.destroy()
          fields.destroy()
        }
      } finally { acroForm.destroy() }

      const saved = document.saveToBuffer('compress')
      let savedBytes: Uint8Array
      try { savedBytes = new Uint8Array(saved.asUint8Array()) } finally { saved.destroy() }
      const reopened = new mupdf.PDFDocument(savedBytes)
      try {
        const reopenedForm = reopened.getTrailer().get('Root', 'AcroForm')
        try {
          const fields = reopenedForm.get('Fields')
          try {
            expect(fields.length).toBe(1)
            expect(fields.get(0).get('T').asString()).toBe('mainField')
          } finally { fields.destroy() }
        } finally { reopenedForm.destroy() }
        const reopenedPage = reopened.loadPage(0)
        try {
          const widgets = reopenedPage.getWidgets()
          try {
            expect(widgets).toHaveLength(1)
            expect(widgets[0].getName()).toBe('mainField')
            expect(widgets[0].getValue()).toBe('mainField-value')
          } finally { widgets.forEach((widget) => widget.destroy()) }
        } finally { reopenedPage.destroy() }
      } finally { reopened.destroy() }
    } finally {
      source.destroy()
      document.destroy()
    }
  })
})
