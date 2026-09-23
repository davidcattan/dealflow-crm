import ExcelJS from 'exceljs'
import { PDFDocument } from 'pdf-lib'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DocumentRecord } from '@/lib/types'

type ContentBlock =
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'text'; text: string }

const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
])

const SPREADSHEET_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])

function extensionOf(fileName: string) {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase()
}

// Cut a PDF down to just the pages triage flagged as important, keeping
// them as real PDF pages (so Claude still reads tables visually — flat text
// extraction scrambled them). Returns null if slicing isn't worthwhile or
// fails, in which case the caller sends the whole document.
async function slicePdf(
  buffer: Buffer,
  ranges: { start: number; end: number }[],
  totalPages: number
): Promise<{ data: Buffer; kept: number; total: number } | null> {
  try {
    const src = await PDFDocument.load(buffer, { ignoreEncryption: true })
    const total = src.getPageCount()
    if (total !== totalPages && Math.abs(total - totalPages) > 1) return null

    const keep = new Set<number>()
    for (const r of ranges) {
      for (let p = Math.max(1, r.start); p <= Math.min(total, r.end); p++) keep.add(p - 1)
    }
    if (keep.size === 0 || keep.size >= total) return null

    const out = await PDFDocument.create()
    const pages = await out.copyPages(src, [...keep].sort((a, b) => a - b))
    pages.forEach((pg) => out.addPage(pg))
    return { data: Buffer.from(await out.save()), kept: keep.size, total }
  } catch {
    return null
  }
}

async function spreadsheetToText(buffer: Buffer, fileName: string): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)

  const parts: string[] = [`--- ${fileName} ---`]
  workbook.eachSheet((sheet) => {
    parts.push(`\nSheet: ${sheet.name}`)
    sheet.eachRow((row) => {
      const cells = (row.values as unknown[]).slice(1).map((v) => {
        if (v === null || v === undefined) return ''
        if (typeof v === 'object' && 'result' in (v as Record<string, unknown>)) {
          return String((v as { result: unknown }).result ?? '')
        }
        return String(v)
      })
      parts.push(cells.join(','))
    })
  })
  return parts.join('\n')
}

export type DocumentContentResult = {
  blocks: ContentBlock[]
  skipped: string[]
}

// Every document here gets fully base64-encoded into one request to
// Claude — with no cap, a handful of real diligence PDFs can blow past
// Anthropic's request-size limit or just take long enough to time out the
// function, and either way the failure is opaque to the user. Stop adding
// documents once this budget (of *original* file bytes, before the ~33%
// base64 inflation) is used up; anything beyond it is skipped with a clear
// reason instead of silently failing the whole run.
const MAX_TOTAL_DOCUMENT_BYTES = 15 * 1024 * 1024

export async function buildDocumentContent(
  supabase: SupabaseClient,
  documents: DocumentRecord[]
): Promise<DocumentContentResult> {
  const blocks: ContentBlock[] = []
  const skipped: string[] = []

  // Smallest first, so the budget is spent on as many documents as
  // possible rather than one large file crowding everything else out.
  const ordered = [...documents].sort(
    (a, b) => (a.file_size ?? 0) - (b.file_size ?? 0)
  )

  let bytesUsed = 0

  for (const doc of ordered) {
    const size = doc.file_size ?? 0
    if (bytesUsed + size > MAX_TOTAL_DOCUMENT_BYTES) {
      skipped.push(`${doc.file_name} (skipped — total document size limit reached)`)
      continue
    }

    const { data, error } = await supabase.storage
      .from('borrower-documents')
      .download(doc.storage_path)

    if (error || !data) {
      skipped.push(`${doc.file_name} (could not be downloaded)`)
      continue
    }

    const buffer = Buffer.from(await data.arrayBuffer())
    bytesUsed += buffer.byteLength
    const ext = extensionOf(doc.file_name)
    const contentType = doc.content_type ?? ''

    if (contentType === 'application/pdf' || ext === 'pdf') {
      // Native page reading preserves table structure (flat text extraction
      // scrambled it). If the AI triage flagged which pages matter, send
      // only those pages — still as real PDF pages.
      let pdfBuffer: Buffer = buffer
      const triage = doc.triage
      if (triage && triage.important_pages.length > 0) {
        const sliced = await slicePdf(buffer, triage.important_pages, triage.total_pages)
        if (sliced) {
          pdfBuffer = sliced.data
          blocks.push({
            type: 'text',
            text: `Note on "${doc.file_name}" (${triage.doc_type}): only ${sliced.kept} of its ${sliced.total} pages are included below — the rest were triaged as boilerplate. ${triage.summary}`,
          })
        }
      }
      blocks.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: pdfBuffer.toString('base64'),
        },
      })
    } else if (IMAGE_TYPES.has(contentType) || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
      const mediaType = contentType || `image/${ext === 'jpg' ? 'jpeg' : ext}`
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') },
      })
    } else if (SPREADSHEET_TYPES.has(contentType) || ['xlsx', 'xls'].includes(ext)) {
      try {
        const text = await spreadsheetToText(buffer, doc.file_name)
        blocks.push({ type: 'text', text })
      } catch {
        skipped.push(`${doc.file_name} (could not be parsed as a spreadsheet)`)
      }
    } else if (contentType.startsWith('text/') || ['csv', 'txt'].includes(ext)) {
      blocks.push({
        type: 'text',
        text: `--- ${doc.file_name} ---\n${buffer.toString('utf-8')}`,
      })
    } else {
      skipped.push(`${doc.file_name} (unsupported file type)`)
    }
  }

  return { blocks, skipped }
}

export async function fetchWebsiteText(url: string): Promise<string | null> {
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`
    const res = await fetch(normalized, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DealflowCRM/1.0)' },
    })
    if (!res.ok) return null

    const html = await res.text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    return text.slice(0, 8000)
  } catch {
    return null
  }
}
