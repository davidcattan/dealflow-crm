// Reads the first sheet of an Excel (.xlsx) file in the browser into rows
// keyed by the header row — so a list can be imported without saving as CSV.
import { unzipSync, strFromU8 } from 'fflate'

function colIndex(ref: string) {
  const letters = ref.replace(/[0-9]/g, '')
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export type Sheet = { name: string; rows: Record<string, string>[] }

// Every sheet in the workbook, in order.
export function readXlsx(buffer: ArrayBuffer): Sheet[] {
  const files = unzipSync(new Uint8Array(buffer))
  const xml = (path: string) => (files[path] ? new DOMParser().parseFromString(strFromU8(files[path]), 'application/xml') : null)

  const shared: string[] = []
  const ss = xml('xl/sharedStrings.xml')
  if (ss) for (const si of Array.from(ss.getElementsByTagName('si'))) shared.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''))

  const wb = xml('xl/workbook.xml')
  const rels = xml('xl/_rels/workbook.xml.rels')
  const targets = new Map(
    rels ? Array.from(rels.getElementsByTagName('Relationship')).map((r) => [r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '']) : []
  )
  const sheets: Sheet[] = []
  for (const el of Array.from(wb?.getElementsByTagName('sheet') ?? [])) {
    const rid = el.getAttribute('r:id') ?? el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? ''
    const target = targets.get(rid)
    const sheet = target ? xml(`xl/${target.replace(/^\/?xl\//, '')}`) : null
    if (sheet) sheets.push({ name: el.getAttribute('name') ?? 'Sheet', rows: sheetRows(sheet, shared) })
  }
  if (!sheets.length) {
    const only = xml('xl/worksheets/sheet1.xml')
    if (only) sheets.push({ name: 'Sheet1', rows: sheetRows(only, shared) })
  }
  return sheets
}

function sheetRows(sheet: Document, shared: string[]): Record<string, string>[] {
  const grid: string[][] = []
  for (const row of Array.from(sheet.getElementsByTagName('row'))) {
    const cells: string[] = []
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const i = colIndex(c.getAttribute('r') ?? 'A1')
      const type = c.getAttribute('t')
      const v = c.getElementsByTagName('v')[0]?.textContent ?? ''
      cells[i] =
        type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? Array.from(c.getElementsByTagName('t')).map((t) => t.textContent ?? '').join('') : v
    }
    if (cells.some((x) => x && x.trim())) grid.push(Array.from(cells, (x) => x ?? ''))
  }
  const [header, ...body] = grid
  if (!header) return []
  const keys = header.map((h) => h.trim())
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}
