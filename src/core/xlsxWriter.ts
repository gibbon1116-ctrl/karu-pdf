export type XlsxStyle =
  | 'text' | 'title' | 'header' | 'category'
  | 'integer' | 'decimal'
  | 'borderedText' | 'borderedInteger' | 'borderedDecimal'

export interface XlsxCell {
  value: string | number | null
  style?: XlsxStyle
}

export interface XlsxMerge {
  firstRow: number
  firstColumn: number
  lastRow: number
  lastColumn: number
}

export interface XlsxImage {
  png: Uint8Array
  row: number
  column: number
  width: number
  height: number
}

export interface XlsxSheet {
  name: string
  cells: readonly (readonly XlsxCell[])[]
  merges?: readonly XlsxMerge[]
  columnWidths?: readonly number[]
  /** Zero-based row index -> height in points. */
  rowHeights?: Readonly<Record<number, number>>
  freeze?: { rows: number; columns: number }
  images?: readonly XlsxImage[]
}

interface ZipEntry {
  name: string
  bytes: Uint8Array
}

const MAX_ROWS = 1048576
const MAX_COLUMNS = 16384
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const encoder = new TextEncoder()

const STYLE_IDS: Record<XlsxStyle, number> = {
  text: 0, title: 1, header: 2, category: 3,
  integer: 4, decimal: 5,
  borderedText: 6, borderedInteger: 7, borderedDecimal: 8,
}

export function columnName(column: number): string {
  if (!Number.isInteger(column) || column < 0 || column >= MAX_COLUMNS) {
    throw new RangeError('Excelの列番号は0〜16383で指定してください')
  }
  let result = '', n = column + 1
  while (n > 0) {
    n--
    result = String.fromCharCode(65 + n % 26) + result
    n = Math.floor(n / 26)
  }
  return result
}

function validRow(row: number): void {
  if (!Number.isInteger(row) || row < 0 || row >= MAX_ROWS) {
    throw new RangeError('Excelの行番号は0〜1048575で指定してください')
  }
}

function address(row: number, column: number): string {
  validRow(row)
  return `${columnName(column)}${row + 1}`
}

/** XML 1.0 characters; iteration also removes unpaired UTF-16 surrogates. */
function cleanXml(value: string): string {
  let result = ''
  for (const character of value) {
    const code = character.codePointAt(0)!
    if (code === 9 || code === 10 || code === 13
      || (code >= 0x20 && code <= 0xd7ff)
      || (code >= 0xe000 && code <= 0xfffd)
      || (code >= 0x10000 && code <= 0x10ffff)) result += character
  }
  return result
}

function xml(value: string): string {
  return cleanXml(value).replace(/[&<>"'\r]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&apos;', '\r': '&#13;',
  })[character]!)
}

function truncateName(value: string, length: number): string {
  let result = value.slice(0, length)
  if (/[\ud800-\udbff]$/.test(result)) result = result.slice(0, -1)
  return result
}

function sheetNames(sheets: readonly XlsxSheet[]): string[] {
  const used = new Set<string>()
  return sheets.map(sheet => {
    let base = cleanXml(sheet.name).replace(/[\[\]:*?\/\\]/g, '_')
      .replace(/[\t\r\n]/g, ' ').trim().replace(/^'+|'+$/g, '')
    base = truncateName(base, 31).replace(/'+$/g, '') || 'Sheet'
    let name = base, suffix = 2
    while (used.has(name.toLowerCase())) {
      const tail = ` (${suffix++})`
      name = truncateName(base, 31 - tail.length) + tail
    }
    used.add(name.toLowerCase())
    return name
  })
}

function relationships(body: string): string {
  return `${XML_HEADER}<Relationships xmlns="${PACKAGE_REL_NS}">${body}</Relationships>`
}

function relationship(id: string, type: string, target: string): string {
  return `<Relationship Id="${xml(id)}" Type="${REL_NS}/${type}" Target="${xml(target)}"/>`
}

const STYLES_XML = `${XML_HEADER}<styleSheet xmlns="${MAIN_NS}">
<fonts count="2">
  <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
  <font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFE4EFFA"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
  <border><left/><right/><top/><bottom/><diagonal/></border>
  <border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
  <xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  <xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
  <xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
  <xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < table.length; i++) {
    let value = i
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
    table[i] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255]
  return (crc ^ 0xffffffff) >>> 0
}

function storedZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > 65535) throw new RangeError('ZIPのファイル数が上限を超えています')
  const files = entries.map(entry => {
    if (!/^[\x20-\x7e]+$/.test(entry.name)) throw new Error('ZIPのファイル名はASCIIで指定してください')
    const name = encoder.encode(entry.name)
    if (name.length > 65535 || entry.bytes.length > 0xffffffff) throw new RangeError('ZIPのサイズが上限を超えています')
    return { ...entry, name, crc: crc32(entry.bytes), offset: 0 }
  })
  let localSize = 0, centralSize = 0
  for (const file of files) {
    file.offset = localSize
    localSize += 30 + file.name.length + file.bytes.length
    centralSize += 46 + file.name.length
  }
  const totalSize = localSize + centralSize + 22
  if (totalSize > 0xffffffff) throw new RangeError('ZIP64が必要なサイズのExcelファイルは作成できません')
  const output = new Uint8Array(totalSize)
  const view = new DataView(output.buffer)
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, true)
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true)
  for (const file of files) {
    const offset = file.offset
    u32(offset, 0x04034b50)
    u16(offset + 4, 20)
    u16(offset + 6, 0)
    u16(offset + 8, 0)
    u16(offset + 10, 0)
    u16(offset + 12, 33)
    u32(offset + 14, file.crc)
    u32(offset + 18, file.bytes.length)
    u32(offset + 22, file.bytes.length)
    u16(offset + 26, file.name.length)
    u16(offset + 28, 0)
    output.set(file.name, offset + 30)
    output.set(file.bytes, offset + 30 + file.name.length)
  }
  let offset = localSize
  for (const file of files) {
    u32(offset, 0x02014b50)
    u16(offset + 4, 20)
    u16(offset + 6, 20)
    u16(offset + 8, 0)
    u16(offset + 10, 0)
    u16(offset + 12, 0)
    u16(offset + 14, 33)
    u32(offset + 16, file.crc)
    u32(offset + 20, file.bytes.length)
    u32(offset + 24, file.bytes.length)
    u16(offset + 28, file.name.length)
    u16(offset + 30, 0)
    u16(offset + 32, 0)
    u16(offset + 34, 0)
    u16(offset + 36, 0)
    u32(offset + 38, 0)
    u32(offset + 42, file.offset)
    output.set(file.name, offset + 46)
    offset += 46 + file.name.length
  }
  u32(offset, 0x06054b50)
  u16(offset + 4, 0)
  u16(offset + 6, 0)
  u16(offset + 8, files.length)
  u16(offset + 10, files.length)
  u32(offset + 12, centralSize)
  u32(offset + 16, localSize)
  u16(offset + 20, 0)
  return output
}

function drawingXml(images: readonly XlsxImage[], imageNumbers: readonly number[]): string {
  const anchors = images.map((image, i) => {
    validRow(image.row)
    columnName(image.column)
    if (!Number.isFinite(image.width) || !Number.isFinite(image.height)
      || image.width <= 0 || image.height <= 0) throw new Error('見本の表示サイズが不正です')
    const cx = Math.round(image.width * 9525), cy = Math.round(image.height * 9525)
    if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cy) || cx < 1 || cy < 1) {
      throw new Error('見本の表示サイズが範囲外です')
    }
    return `<xdr:oneCellAnchor>
<xdr:from><xdr:col>${image.column}</xdr:col><xdr:colOff>19050</xdr:colOff><xdr:row>${image.row}</xdr:row><xdr:rowOff>19050</xdr:rowOff></xdr:from>
<xdr:ext cx="${cx}" cy="${cy}"/>
<xdr:pic>
<xdr:nvPicPr><xdr:cNvPr id="${i + 1}" name="Image ${imageNumbers[i]}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>
<xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
</xdr:pic><xdr:clientData/>
</xdr:oneCellAnchor>`
  }).join('')
  return `${XML_HEADER}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL_NS}">${anchors}</xdr:wsDr>`
}

function sheetXml(sheet: XlsxSheet, sharedString: (value: string) => number): string {
  if (sheet.cells.length > MAX_ROWS || (sheet.columnWidths?.length ?? 0) > MAX_COLUMNS) {
    throw new RangeError('Excelの行数または列数の上限を超えています')
  }
  let lastRow = Math.max(0, sheet.cells.length - 1)
  let lastColumn = Math.max(0, (sheet.columnWidths?.length ?? 0) - 1)
  for (const row of sheet.cells) {
    if (row.length > MAX_COLUMNS) throw new RangeError('Excelの列数の上限を超えています')
    lastColumn = Math.max(lastColumn, row.length - 1)
  }
  const rowIndices = new Set(sheet.cells.map((_, row) => row))
  for (const [key, height] of Object.entries(sheet.rowHeights ?? {})) {
    const row = Number(key)
    validRow(row)
    if (!Number.isFinite(height) || height <= 0 || height > 409.5) throw new Error('Excelの行の高さが不正です')
    rowIndices.add(row)
    lastRow = Math.max(lastRow, row)
  }
  const merges = (sheet.merges ?? []).map(merge => {
    if (merge.firstRow > merge.lastRow || merge.firstColumn > merge.lastColumn) throw new Error('セルの結合範囲が不正です')
    const first = address(merge.firstRow, merge.firstColumn)
    const last = address(merge.lastRow, merge.lastColumn)
    lastRow = Math.max(lastRow, merge.lastRow)
    lastColumn = Math.max(lastColumn, merge.lastColumn)
    return `<mergeCell ref="${first}:${last}"/>`
  }).join('')
  for (const image of sheet.images ?? []) {
    address(image.row, image.column)
    lastRow = Math.max(lastRow, image.row)
    lastColumn = Math.max(lastColumn, image.column)
  }
  const freeze = sheet.freeze ?? { rows: 0, columns: 0 }
  if (!Number.isInteger(freeze.rows) || !Number.isInteger(freeze.columns)
    || freeze.rows < 0 || freeze.rows >= MAX_ROWS || freeze.columns < 0 || freeze.columns >= MAX_COLUMNS) {
    throw new Error('固定表示の行数または列数が不正です')
  }
  const frozen = freeze.rows > 0 || freeze.columns > 0
  const pane = freeze.rows && freeze.columns ? 'bottomRight' : freeze.rows ? 'bottomLeft' : 'topRight'
  const topLeft = address(freeze.rows, freeze.columns)
  const view = frozen
    ? `<pane${freeze.columns ? ` xSplit="${freeze.columns}"` : ''}${freeze.rows ? ` ySplit="${freeze.rows}"` : ''} topLeftCell="${topLeft}" activePane="${pane}" state="frozen"/><selection pane="${pane}" activeCell="${topLeft}" sqref="${topLeft}"/>`
    : ''
  const columns = (sheet.columnWidths ?? []).map((width, column) => {
    if (!Number.isFinite(width) || width <= 0 || width > 255) throw new Error('Excelの列の幅が不正です')
    return `<col min="${column + 1}" max="${column + 1}" width="${width}" customWidth="1"/>`
  }).join('')
  const rows = [...rowIndices].sort((a, b) => a - b).map(row => {
    const height = sheet.rowHeights?.[row]
    const cells = (sheet.cells[row] ?? []).map((cell, column) => {
      const style = STYLE_IDS[cell.style ?? 'text']
      if (style === undefined) throw new Error('Excelのセル書式が不正です')
      const attributes = `r="${address(row, column)}" s="${style}"`
      if (typeof cell.value === 'string') {
        return `<c ${attributes} t="s"><v>${sharedString(cell.value)}</v></c>`
      }
      if (typeof cell.value === 'number' && Number.isFinite(cell.value)) {
        return `<c ${attributes}><v>${cell.value}</v></c>`
      }
      return `<c ${attributes}/>`
    }).join('')
    return `<row r="${row + 1}"${height === undefined ? '' : ` ht="${height}" customHeight="1"`}>${cells}</row>`
  }).join('')
  return `${XML_HEADER}<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">
<dimension ref="A1:${address(lastRow, lastColumn)}"/>
<sheetViews><sheetView workbookViewId="0">${view}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${columns ? `<cols>${columns}</cols>` : ''}
<sheetData>${rows}</sheetData>
${merges ? `<mergeCells count="${sheet.merges!.length}">${merges}</mergeCells>` : ''}
${sheet.images?.length ? '<drawing r:id="rId1"/>' : ''}
</worksheet>`
}

/** Builds an Office Open XML workbook in an uncompressed ZIP. No I/O. */
export function writeXlsx(sheets: readonly XlsxSheet[]): Uint8Array {
  if (!sheets.length) throw new Error('Excelには1枚以上のシートが必要です')
  const names = sheetNames(sheets)
  const entries: ZipEntry[] = []
  const addXml = (name: string, content: string) => entries.push({ name, bytes: encoder.encode(content) })
  const strings: string[] = [], stringIds = new Map<string, number>()
  let stringCount = 0, imageCount = 0
  const sharedString = (value: string): number => {
    const clean = cleanXml(value)
    if (clean.length > 32767) throw new RangeError('Excelのセルの文字数が32767文字を超えています')
    stringCount++
    const found = stringIds.get(clean)
    if (found !== undefined) return found
    const id = strings.length
    stringIds.set(clean, id)
    strings.push(clean)
    return id
  }
  const drawingOverrides: string[] = []
  sheets.forEach((sheet, i) => {
    const n = i + 1
    addXml(`xl/worksheets/sheet${n}.xml`, sheetXml(sheet, sharedString))
    if (!sheet.images?.length) return
    const numbers = sheet.images.map(image => {
      const number = ++imageCount
      entries.push({ name: `xl/media/image${number}.png`, bytes: image.png })
      return number
    })
    addXml(`xl/drawings/drawing${n}.xml`, drawingXml(sheet.images, numbers))
    addXml(`xl/drawings/_rels/drawing${n}.xml.rels`, relationships(
      numbers.map((number, j) => relationship(`rId${j + 1}`, 'image', `../media/image${number}.png`)).join(''),
    ))
    addXml(`xl/worksheets/_rels/sheet${n}.xml.rels`, relationships(
      relationship('rId1', 'drawing', `../drawings/drawing${n}.xml`),
    ))
    drawingOverrides.push(`<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`)
  })
  addXml('xl/sharedStrings.xml', `${XML_HEADER}<sst xmlns="${MAIN_NS}" count="${stringCount}" uniqueCount="${strings.length}">${strings.map(value => `<si><t xml:space="preserve">${xml(value)}</t></si>`).join('')}</sst>`)
  addXml('xl/styles.xml', STYLES_XML)
  addXml('xl/workbook.xml', `${XML_HEADER}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><bookViews><workbookView/></bookViews><sheets>${names.map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
  addXml('xl/_rels/workbook.xml.rels', relationships(
    sheets.map((_, i) => relationship(`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`)).join('')
    + relationship(`rId${sheets.length + 1}`, 'styles', 'styles.xml')
    + relationship(`rId${sheets.length + 2}`, 'sharedStrings', 'sharedStrings.xml'),
  ))
  const now = new Date().toISOString()
  addXml('docProps/core.xml', `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>かるPDF</dc:creator><cp:lastModifiedBy>かるPDF</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`)
  addXml('docProps/app.xml', `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>かるPDF</Application><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${names.length}" baseType="lpstr">${names.map(name => `<vt:lpstr>${xml(name)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts></Properties>`)
  addXml('_rels/.rels', relationships(
    relationship('rId1', 'officeDocument', 'xl/workbook.xml')
    + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`
    + relationship('rId3', 'extended-properties', 'docProps/app.xml'),
  ))
  addXml('[Content_Types].xml', `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${imageCount ? '<Default Extension="png" ContentType="image/png"/>' : ''}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
${drawingOverrides.join('')}
</Types>`)
  return storedZip(entries)
}
