import { expect, it } from 'vitest'
import { columnName, writeXlsx } from '../src/core/xlsxWriter'

const decoder = new TextDecoder()
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const png = Uint8Array.from(atob(PNG_BASE64), character => character.charCodeAt(0))

/** Independent, bit-at-a-time CRC rather than the writer's table algorithm. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function readStoredZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (offset: number) => view.getUint16(offset, true)
  const u32 = (offset: number) => view.getUint32(offset, true)
  const files = new Map<string, Uint8Array>()
  const local = new Map<string, { offset: number; crc: number; size: number }>()
  let offset = 0
  while (u32(offset) === 0x04034b50) {
    expect(u16(offset + 6)).toBe(0)
    expect(u16(offset + 8)).toBe(0)
    const crc = u32(offset + 14), size = u32(offset + 18)
    expect(u32(offset + 22)).toBe(size)
    const nameLength = u16(offset + 26), extraLength = u16(offset + 28)
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength))
    expect(name).toMatch(/^[\x20-\x7e]+$/)
    expect(files.has(name)).toBe(false)
    const start = offset + 30 + nameLength + extraLength
    expect(start + size).toBeLessThanOrEqual(bytes.length)
    const content = bytes.slice(start, start + size)
    expect(crc32(content)).toBe(crc)
    files.set(name, content)
    local.set(name, { offset, crc, size })
    offset = start + size
  }
  const centralOffset = offset
  const centralNames = new Set<string>()
  while (u32(offset) === 0x02014b50) {
    expect(u16(offset + 8)).toBe(0)
    expect(u16(offset + 10)).toBe(0)
    const nameLength = u16(offset + 28), extraLength = u16(offset + 30), commentLength = u16(offset + 32)
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    expect(centralNames.has(name)).toBe(false)
    centralNames.add(name)
    const file = local.get(name)
    expect(file).toBeDefined()
    expect(u32(offset + 16)).toBe(file!.crc)
    expect(u32(offset + 20)).toBe(file!.size)
    expect(u32(offset + 24)).toBe(file!.size)
    expect(u32(offset + 42)).toBe(file!.offset)
    offset += 46 + nameLength + extraLength + commentLength
  }
  expect(u32(offset)).toBe(0x06054b50)
  expect(u16(offset + 4)).toBe(0)
  expect(u16(offset + 6)).toBe(0)
  expect(u16(offset + 8)).toBe(files.size)
  expect(u16(offset + 10)).toBe(files.size)
  expect(centralNames.size).toBe(files.size)
  expect(u32(offset + 12)).toBe(offset - centralOffset)
  expect(u32(offset + 16)).toBe(centralOffset)
  expect(offset + 22 + u16(offset + 20)).toBe(bytes.length)
  return files
}

function unescapeXml(value: string): string {
  return value.replace(/&#13;/g, '\r').replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
}

function expectWellFormed(value: string): void {
  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(value, 'application/xml')
    expect(document.getElementsByTagName('parsererror')).toHaveLength(0)
    return
  }
  expect(value).toMatch(/^<\?xml\b/)
  const stack: string[] = []
  const tags = /<\?[\s\S]*?\?>|<\/?([A-Za-z_][\w:.-]*)\b[^>]*>/g
  for (const match of value.matchAll(tags)) {
    if (!match[1]) continue
    if (match[0].startsWith('</')) expect(stack.pop()).toBe(match[1])
    else if (!match[0].endsWith('/>')) stack.push(match[1])
  }
  expect(stack).toEqual([])
}

it('converts zero-based columns through XFD and rejects out-of-range columns', () => {
  expect([0, 25, 26, 701, 702, 16383].map(columnName)).toEqual(['A', 'Z', 'AA', 'ZZ', 'AAA', 'XFD'])
  for (const value of [-1, 16384, NaN, Infinity, 0.5]) expect(() => columnName(value)).toThrow()
})

it('creates the required parts, stored ZIP headers, central directory and correct CRCs', () => {
  const files = readStoredZip(writeXlsx([
    { name: '集計表', cells: [[{ value: '日本語' }]] },
    { name: '明細', cells: [[{ value: 7 }]] },
  ]))
  expect([...files.keys()].sort()).toEqual([
    '[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml',
    'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml', 'xl/styles.xml',
    'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
  ].sort())
  const types = decoder.decode(files.get('[Content_Types].xml')!)
  expect(types).toContain('/xl/worksheets/sheet1.xml')
  expect(types).toContain('/xl/worksheets/sheet2.xml')
  expect(types).toContain('spreadsheetml.worksheet+xml')
  expect(types).toContain('spreadsheetml.sharedStrings+xml')
  expect(types).toContain('spreadsheetml.styles+xml')
  expect(types).not.toContain('image/png')
  const rels = decoder.decode(files.get('xl/_rels/workbook.xml.rels')!)
  expect(rels).toContain('Target="worksheets/sheet2.xml"')
  expect(rels).toContain('Target="styles.xml"')
  expect(rels).toContain('Target="sharedStrings.xml"')
  for (const [name, bytes] of files) if (name.endsWith('.xml') || name.endsWith('.rels')) {
    expectWellFormed(decoder.decode(bytes))
  }
})

it('escapes XML, preserves Japanese/whitespace, strips invalid characters and uses shared strings', () => {
  const value = ` A&B<C>"D' 日本語\t\n\r😀\u0000\u0001\u000b\u001f\ufffe\uffff\ud800 `
  const files = readStoredZip(writeXlsx([{ name: '集計表', cells: [
    [{ value }, { value }, { value: '=SUM(A1)' }],
    [{ value: 12.34567, style: 'decimal' }, { value: NaN }, { value: Infinity }, { value: null }],
  ] }]))
  const strings = decoder.decode(files.get('xl/sharedStrings.xml')!)
  expect(strings).toContain('A&amp;B&lt;C&gt;&quot;D&apos;')
  expect(strings).toContain('日本語')
  expect(strings).toContain('xml:space="preserve"')
  expect(strings).toContain('count="3" uniqueCount="2"')
  const first = strings.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)![1]
  expect(unescapeXml(first)).toBe(` A&B<C>"D' 日本語\t\n\r😀 `)
  const sheet = decoder.decode(files.get('xl/worksheets/sheet1.xml')!)
  expect(sheet).toContain('<c r="A1" s="0" t="s"><v>0</v></c>')
  expect(sheet).toContain('<c r="B1" s="0" t="s"><v>0</v></c>')
  expect(sheet).toContain('<c r="C1" s="0" t="s"><v>1</v></c>')
  expect(sheet).toContain('<c r="A2" s="5"><v>12.34567</v></c>')
  expect(sheet).toContain('<c r="B2" s="0"/>')
  expect(sheet).toContain('<c r="C2" s="0"/>')
  expect(sheet).not.toContain('<f>')
  expect(sheet).not.toContain('NaN')
  expect(sheet).not.toContain('Infinity')
  expectWellFormed(strings)
  expectWellFormed(sheet)
})

it('writes merges, frozen panes, widths, heights and all predefined formats', () => {
  const files = readStoredZip(writeXlsx([{
    name: '集計表',
    cells: [
      [{ value: '見出し', style: 'header' }, { value: null, style: 'header' }],
      [{ value: '分類', style: 'category' }, { value: null, style: 'category' }],
      [{ value: '文字', style: 'borderedText' }, { value: 2, style: 'borderedInteger' }],
      [{ value: 2.12345, style: 'borderedDecimal' }, { value: 3, style: 'integer' }],
    ],
    merges: [{ firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: 1 }],
    columnWidths: [6, 28],
    rowHeights: { 0: 30 },
    freeze: { rows: 5, columns: 5 },
  }]))
  const sheet = decoder.decode(files.get('xl/worksheets/sheet1.xml')!)
  expect(sheet).toContain('<mergeCell ref="A1:B1"/>')
  expect(sheet).toContain('xSplit="5" ySplit="5" topLeftCell="F6" activePane="bottomRight" state="frozen"')
  expect(sheet).toContain('<col min="1" max="1" width="6" customWidth="1"/>')
  expect(sheet).toContain('<col min="2" max="2" width="28" customWidth="1"/>')
  expect(sheet).toContain('<row r="1" ht="30" customHeight="1">')
  expect(sheet).toContain('<c r="A4" s="8"><v>2.12345</v></c>')
  const styles = decoder.decode(files.get('xl/styles.xml')!)
  expect(styles).toContain('<cellXfs count="10">')
  expect(styles).toContain('numFmtId="1"')
  expect(styles).toContain('numFmtId="2"')
  expect(styles).toContain('wrapText="1"')
  expect(styles).toContain('style="thin"')
  expect(styles).toContain('FFEFEFEF')
  expect(styles).toContain('FFE4EFFA')
  expectWellFormed(sheet)
  expectWellFormed(styles)
})

it('embeds PNG bytes and creates drawings and relationships only on sheets with images', () => {
  const files = readStoredZip(writeXlsx([
    {
      name: '集計表', cells: [[{ value: null }]],
      images: [{ png, row: 0, column: 0, width: 12, height: 24 }],
    },
    { name: '明細', cells: [[{ value: '明細' }]] },
  ]))
  expect(files.get('xl/media/image1.png')).toEqual(png)
  expect(files.has('xl/drawings/drawing1.xml')).toBe(true)
  expect(files.has('xl/drawings/_rels/drawing1.xml.rels')).toBe(true)
  expect(files.has('xl/worksheets/_rels/sheet1.xml.rels')).toBe(true)
  expect(files.has('xl/drawings/drawing2.xml')).toBe(false)
  expect(files.has('xl/worksheets/_rels/sheet2.xml.rels')).toBe(false)
  expect(decoder.decode(files.get('xl/worksheets/sheet1.xml')!)).toContain('<drawing r:id="rId1"/>')
  expect(decoder.decode(files.get('xl/worksheets/sheet2.xml')!)).not.toContain('<drawing')
  expect(decoder.decode(files.get('xl/worksheets/_rels/sheet1.xml.rels')!)).toContain('Target="../drawings/drawing1.xml"')
  expect(decoder.decode(files.get('xl/drawings/_rels/drawing1.xml.rels')!)).toContain('Target="../media/image1.png"')
  const drawing = decoder.decode(files.get('xl/drawings/drawing1.xml')!)
  expect(drawing).toContain('<xdr:col>0</xdr:col>')
  expect(drawing).toContain('<xdr:row>0</xdr:row>')
  expect(drawing).toContain('<xdr:ext cx="114300" cy="228600"/>')
  const types = decoder.decode(files.get('[Content_Types].xml')!)
  expect(types).toContain('ContentType="image/png"')
  expect(types).toContain('PartName="/xl/drawings/drawing1.xml"')
  expect(types).toContain('officedocument.drawing+xml')
  for (const [name, bytes] of files) if (name.endsWith('.xml') || name.endsWith('.rels')) {
    expectWellFormed(decoder.decode(bytes))
  }
})

it('normalizes invalid, empty, overlong and duplicate sheet names', () => {
  const files = readStoredZip(writeXlsx(
    ['[]:*?/\\', '', "'名称'", 'A'.repeat(40), '集計表', '集計表', 'name', 'NAME']
      .map(name => ({ name, cells: [] })),
  ))
  const workbook = decoder.decode(files.get('xl/workbook.xml')!)
  const names = [...workbook.matchAll(/<sheet name="([^"]*)"/g)].map(match => unescapeXml(match[1]))
  expect(names).toHaveLength(8)
  expect(new Set(names.map(name => name.toLowerCase())).size).toBe(names.length)
  for (const name of names) {
    expect(name.length).toBeGreaterThan(0)
    expect(name.length).toBeLessThanOrEqual(31)
    expect(name).not.toMatch(/[\[\]:*?\/\\]/)
    expect(name).not.toMatch(/^'|'$/)
  }
  expect(names[2]).toBe('名称')
  expect(names[3]).toBe('A'.repeat(31))
  expectWellFormed(workbook)
})

it('writes formula cells with optional numeric caches and requests recalculation on opening', () => {
  const files = readStoredZip(writeXlsx([{
    name: '数式',
    cells: [[
      { value: null, formula: 'IF(E1="","",C1*E1)', style: 'borderedMoney' },
      { value: 12, formula: '3*4', style: 'borderedMoney' },
    ]],
  }]))
  const sheet = decoder.decode(files.get('xl/worksheets/sheet1.xml')!)
  expect(sheet).toContain('<c r="A1" s="9"><f>IF(E1=&quot;&quot;,&quot;&quot;,C1*E1)</f></c>')
  expect(sheet).toContain('<c r="B1" s="9"><f>3*4</f><v>12</v></c>')
  expect(sheet).not.toContain('t="s"')
  const workbook = decoder.decode(files.get('xl/workbook.xml')!)
  expect(workbook).toContain('</sheets><calcPr fullCalcOnLoad="1"/></workbook>')
  expectWellFormed(sheet)
  expectWellFormed(workbook)
})

it('escapes formula XML including sheet references and comparison operators', () => {
  const input = `IF(A1<2,"A&B",IF(A1>3,'別紙明細'!F5,0))`
  const files = readStoredZip(writeXlsx([{
    name: '数式', cells: [[{ value: null, formula: input }]],
  }]))
  const sheet = decoder.decode(files.get('xl/worksheets/sheet1.xml')!)
  expect(sheet).toContain(
    '<f>IF(A1&lt;2,&quot;A&amp;B&quot;,IF(A1&gt;3,&apos;別紙明細&apos;!F5,0))</f>',
  )
  expect(unescapeXml(sheet.match(/<f>([\s\S]*?)<\/f>/)![1])).toBe(input)
  expectWellFormed(sheet)
})

it('rejects string values on formula cells', () => {
  expect(() => writeXlsx([{
    name: '数式', cells: [[{ value: '', formula: 'C1*E1' }]],
  }])).toThrow(Error)
  expect(() => writeXlsx([{
    name: '数式', cells: [[{ value: '文字列', formula: 'C1*E1' }]],
  }])).toThrow('文字列のキャッシュ値')
})

it('appends the bordered money format without renumbering existing styles', () => {
  const files = readStoredZip(writeXlsx([{
    name: '金額', cells: [[{ value: 123456, style: 'borderedMoney' }]],
  }]))
  const styles = decoder.decode(files.get('xl/styles.xml')!)
  const formats = styles.match(/<cellXfs count="10">([\s\S]*?)<\/cellXfs>/)![1]
  const entries = [...formats.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)]
  expect(entries).toHaveLength(10)
  expect(entries.map(entry => Number(entry[1].match(/\bnumFmtId="(\d+)"/)![1])))
    .toEqual([0, 0, 0, 0, 1, 2, 0, 1, 2, 3])
  expect(entries[9][1]).toContain('borderId="1"')
  expect(entries[9][1]).toContain('applyNumberFormat="1"')
  expect(entries[9][1]).toContain('applyBorder="1"')
  expect(decoder.decode(files.get('xl/worksheets/sheet1.xml')!))
    .toContain('<c r="A1" s="9"><v>123456</v></c>')
  expectWellFormed(styles)
})

it('rejects workbook sizes and cell coordinates that Excel cannot represent', () => {
  expect(() => writeXlsx([])).toThrow()
  expect(() => writeXlsx([{ name: '例', cells: [[{ value: 'a'.repeat(32768) }]] }])).toThrow()
  expect(() => writeXlsx([{
    name: '例', cells: [],
    merges: [{ firstRow: 0, firstColumn: 0, lastRow: 1048576, lastColumn: 0 }],
  }])).toThrow()
  expect(() => writeXlsx([{ name: '例', cells: [], freeze: { rows: -1, columns: 0 } }])).toThrow()
})
