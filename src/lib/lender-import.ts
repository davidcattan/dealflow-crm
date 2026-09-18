import ExcelJS from 'exceljs'

export type ParsedLenderRow = {
  contactName: string | null
  company: string
  email: string | null
  lendingType: string | null
  minLoanAmount: number | null
  minRevenue: number | null
  minEbitda: number | null
  caresAboutProfit: boolean | null
  notes: string | null
  unparsedRaw: string[]
}

export type LenderGroup = {
  company: string
  lendingType: string | null
  minLoanAmount: number | null
  minRevenue: number | null
  minEbitda: number | null
  caresAboutProfit: boolean | null
  mandateNotes: string | null
  contacts: { name: string | null; email: string | null }[]
}

const BLANK_VALUES = new Set(['', 'none', 'na', 'n/a', '?'])

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

// Parses loose real-world amount strings like "$10 million", "$100k", "10m+",
// "$1.5 million". Returns null (rather than a guess) for anything that
// doesn't clearly resolve to a single number — callers should keep the raw
// text somewhere so nothing is silently lost.
export function parseAmount(raw: unknown): { value: number | null; unparsed: string | null } {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { value: raw, unparsed: null }
  }

  const str = cellToString(raw).trim()
  if (BLANK_VALUES.has(str.toLowerCase())) {
    return { value: null, unparsed: null }
  }

  const cleaned = str.replace(/\+\s*$/, '').trim()
  const match = cleaned.match(
    /^\$?\s*([\d,]+(?:\.\d+)?)\s*(million|mil|m|thousand|k)?\s*$/i
  )

  if (!match) {
    return { value: null, unparsed: str }
  }

  const num = Number(match[1].replace(/,/g, ''))
  if (!Number.isFinite(num)) {
    return { value: null, unparsed: str }
  }

  const unit = (match[2] ?? '').toLowerCase()
  if (unit === 'million' || unit === 'mil' || unit === 'm') {
    return { value: num * 1_000_000, unparsed: null }
  }
  if (unit === 'thousand' || unit === 'k') {
    return { value: num * 1_000, unparsed: null }
  }
  return { value: num, unparsed: null }
}

function parseBoolean(raw: unknown): boolean | null {
  const str = cellToString(raw).trim().toLowerCase()
  if (str === 'yes') return true
  if (str === 'no') return false
  return null
}

export async function parseLenderWorkbook(buffer: Buffer): Promise<ParsedLenderRow[]> {
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
    name: colIndex('name'),
    company: colIndex('company'),
    email: colIndex('email'),
    type: colIndex('type'),
    minCheck: colIndex('min check size'),
    minRevenue: colIndex('minimum revenue'),
    minEbitda: colIndex('minimum ebitda'),
    caresAboutProfit: colIndex('care about profit?'),
    notes: colIndex('notes'),
  }

  const rows: ParsedLenderRow[] = []

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const values = (row.values as unknown[]).slice(1)
    const get = (i: number) => (i === -1 ? undefined : values[i])

    const company = cellToString(get(idx.company)).trim()
    if (!company) return

    const minCheck = parseAmount(get(idx.minCheck))
    const minRevenue = parseAmount(get(idx.minRevenue))
    const minEbitda = parseAmount(get(idx.minEbitda))

    const unparsedRaw: string[] = []
    if (minCheck.unparsed) unparsedRaw.push(`Min check size (raw): ${minCheck.unparsed}`)
    if (minRevenue.unparsed) unparsedRaw.push(`Minimum revenue (raw): ${minRevenue.unparsed}`)
    if (minEbitda.unparsed) unparsedRaw.push(`Minimum EBITDA (raw): ${minEbitda.unparsed}`)

    const contactName = cellToString(get(idx.name)).trim() || null
    const email = cellToString(get(idx.email)).trim() || null
    const lendingType = cellToString(get(idx.type)).trim() || null
    const notes = cellToString(get(idx.notes)).trim() || null

    rows.push({
      contactName,
      company,
      email,
      lendingType,
      minLoanAmount: minCheck.value,
      minRevenue: minRevenue.value,
      minEbitda: minEbitda.value,
      caresAboutProfit: parseBoolean(get(idx.caresAboutProfit)),
      notes,
      unparsedRaw,
    })
  })

  return rows
}

export function groupLenderRows(rows: ParsedLenderRow[]): LenderGroup[] {
  const groups = new Map<string, LenderGroup>()

  for (const row of rows) {
    const key = row.company.toLowerCase()
    let group = groups.get(key)
    if (!group) {
      group = {
        company: row.company,
        lendingType: null,
        minLoanAmount: null,
        minRevenue: null,
        minEbitda: null,
        caresAboutProfit: null,
        mandateNotes: null,
        contacts: [],
      }
      groups.set(key, group)
    }

    if (!group.lendingType && row.lendingType) group.lendingType = row.lendingType
    if (group.minLoanAmount === null && row.minLoanAmount !== null) {
      group.minLoanAmount = row.minLoanAmount
    }
    if (group.minRevenue === null && row.minRevenue !== null) {
      group.minRevenue = row.minRevenue
    }
    if (group.minEbitda === null && row.minEbitda !== null) {
      group.minEbitda = row.minEbitda
    }
    if (group.caresAboutProfit === null && row.caresAboutProfit !== null) {
      group.caresAboutProfit = row.caresAboutProfit
    }

    const noteParts = [row.notes, ...row.unparsedRaw].filter((v): v is string => Boolean(v))
    for (const part of noteParts) {
      const existing = group.mandateNotes ?? ''
      if (!existing.includes(part)) {
        group.mandateNotes = existing ? `${existing}\n\n${part}` : part
      }
    }

    if (row.contactName || row.email) {
      const alreadyHasContact = group.contacts.some(
        (c) => (c.email ?? '').toLowerCase() === (row.email ?? '').toLowerCase() && row.email
      )
      if (!alreadyHasContact) {
        group.contacts.push({ name: row.contactName, email: row.email })
      }
    }
  }

  return Array.from(groups.values())
}
