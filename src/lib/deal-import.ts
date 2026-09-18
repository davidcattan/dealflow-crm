import ExcelJS from 'exceljs'

export type ParsedUpdateEntry = {
  entryDate: string | null // YYYY-MM-DD
  note: string
}

export type ParsedDeal = {
  companyName: string
  repName: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  dealType: string | null
  activityScore: number | null
  notes: string | null
  createdAt: string | null // YYYY-MM-DD
  updates: ParsedUpdateEntry[]
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    if ('text' in (value as Record<string, unknown>)) {
      return String((value as { text: unknown }).text ?? '')
    }
    if ('result' in (value as Record<string, unknown>)) {
      return String((value as { result: unknown }).result ?? '')
    }
    if ('richText' in (value as Record<string, unknown>)) {
      const parts = (value as { richText: { text: string }[] }).richText
      return parts.map((p) => p.text).join('')
    }
  }
  return String(value)
}

// "8.31.2026" -> "2026-08-31". Returns null if it doesn't parse.
function parseSlashDate(raw: string): { iso: string | null; year: number | null } {
  const match = raw.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (!match) return { iso: null, year: null }
  const [, m, d, y] = match
  const month = m.padStart(2, '0')
  const day = d.padStart(2, '0')
  return { iso: `${y}-${month}-${day}`, year: Number(y) }
}

// Some exports give a real Excel date (ExcelJS returns a JS Date) instead of
// "M.D.YYYY" text. Excel dates are timezone-naive — the UTC components of
// the Date object are the actual calendar date, not the local ones (reading
// local components can shift the day backward in timezones behind UTC).
function dateCellToParts(raw: unknown): { iso: string | null; year: number | null } {
  if (raw instanceof Date) {
    const y = raw.getUTCFullYear()
    const m = String(raw.getUTCMonth() + 1).padStart(2, '0')
    const d = String(raw.getUTCDate()).padStart(2, '0')
    return { iso: `${y}-${m}-${d}`, year: y }
  }
  return parseSlashDate(cellToString(raw))
}

function splitEmailPhone(raw: string): { email: string | null; phone: string | null } {
  const str = raw.trim()
  if (!str) return { email: null, phone: null }
  const emailMatch = str.match(/[^\s,]+@[^\s,]+/)
  const email = emailMatch ? emailMatch[0] : null
  const phone = str
    .replace(email ?? '', '')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim()
  return { email, phone: phone || null }
}

// Splits a concatenated log like "9.16: she has no income. 9.2: sent to
// soffer." into dated entries. Falls back to a single undated entry if no
// date-prefix pattern is found.
export function parseUpdateLog(raw: string, fallbackYear: number | null): ParsedUpdateEntry[] {
  const str = raw.trim()
  if (!str) return []

  const regex = /(\d{1,2})\.(\d{1,2}):\s*/g
  const matches = [...str.matchAll(regex)]

  if (matches.length === 0) {
    return [{ entryDate: null, note: str }]
  }

  const entries: ParsedUpdateEntry[] = []
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const start = (m.index ?? 0) + m[0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? str.length) : str.length
    const note = str.slice(start, end).trim().replace(/^[.\s]+/, '')
    if (!note) continue

    const month = m[1].padStart(2, '0')
    const day = m[2].padStart(2, '0')
    const entryDate = fallbackYear ? `${fallbackYear}-${month}-${day}` : null
    entries.push({ entryDate, note })
  }
  return entries
}

export async function parseDealWorkbook(buffer: Buffer): Promise<ParsedDeal[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) return []

  const headerRow = sheet.getRow(1)
  const headers = (headerRow.values as unknown[])
    .slice(1)
    .map((v) => cellToString(v).trim().toLowerCase())

  const colIndex = (label: string) => headers.indexOf(label)
  const idx = {
    rep: colIndex('rep name'),
    date: colIndex('date'),
    company: colIndex('deal name'),
    activity: colIndex('deal activity'),
    contact: colIndex('contact name'),
    emailPhone: colIndex('email/phone'),
    type: colIndex('type'),
    update: colIndex('update'),
    notes: colIndex('notes'),
    notes2: colIndex('notes2'),
  }

  const deals: ParsedDeal[] = []

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const values = (row.values as unknown[]).slice(1)
    const get = (i: number) => (i === -1 ? undefined : values[i])

    const companyName = cellToString(get(idx.company)).trim()
    if (!companyName) return

    const { iso: createdAt, year } = dateCellToParts(get(idx.date))

    const { email, phone } = splitEmailPhone(cellToString(get(idx.emailPhone)))

    const activityRaw = cellToString(get(idx.activity)).trim()
    const activityNum = Number(activityRaw)
    const activityScore =
      activityRaw !== '' && Number.isFinite(activityNum) && activityNum >= 0 && activityNum <= 10
        ? Math.round(activityNum)
        : null

    const updateRaw = cellToString(get(idx.update))
    const updates = parseUpdateLog(updateRaw, year)

    const notes = [cellToString(get(idx.notes)).trim(), cellToString(get(idx.notes2)).trim()]
      .filter(Boolean)
      .join('\n\n')

    deals.push({
      companyName,
      repName: cellToString(get(idx.rep)).trim() || null,
      contactName: cellToString(get(idx.contact)).trim() || null,
      contactEmail: email,
      contactPhone: phone,
      dealType: cellToString(get(idx.type)).trim() || null,
      activityScore,
      notes: notes || null,
      createdAt,
      updates,
    })
  })

  return deals
}
