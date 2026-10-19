import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DocumentRecord } from '@/lib/types'

// Page-by-page text of a deal document, pulled out once and kept in
// document_texts (works without that table too, just slower). Pages with
// little text are scans — Ask AI looks at those as images instead.

export type DocText = { pageCount: number; pages: string[]; scanned: number[] }

const SCAN_CHARS = 80
const MAX_PAGE_CHARS = 12_000
// Data-room spreadsheets past this (row-level AR/unbilled detail) take more
// memory and time to open than a server request has, and crashed the email
// sync; they're skipped here (the file itself stays on the deal).
const MAX_SHEET_BYTES = 6 * 1024 * 1024

async function download(supabase: SupabaseClient, doc: DocumentRecord) {
  const { data } = await supabase.storage.from('borrower-documents').download(doc.storage_path)
  return data ? Buffer.from(await data.arrayBuffer()) : null
}

const isPdf = (d: DocumentRecord) => d.file_name.toLowerCase().endsWith('.pdf') || d.content_type === 'application/pdf'
const isImage = (d: DocumentRecord) => /\.(jpe?g|png|webp|gif)$/i.test(d.file_name)

async function extract(buffer: Buffer, doc: DocumentRecord): Promise<DocText> {
  const name = doc.file_name.toLowerCase()
  if (isPdf(doc)) {
    const mupdf = await import('mupdf')
    const pdf = mupdf.Document.openDocument(buffer, 'application/pdf')
    const n = pdf.countPages()
    const pages: string[] = []
    const scanned: number[] = []
    for (let i = 0; i < n; i++) {
      const t = pdf.loadPage(i).toStructuredText('preserve-whitespace').asText().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
      pages.push(t.slice(0, MAX_PAGE_CHARS))
      if (t.replace(/\s+/g, '').length < SCAN_CHARS) scanned.push(i + 1)
    }
    return { pageCount: n, pages, scanned }
  }
  if (isImage(doc)) return { pageCount: 1, pages: [''], scanned: [1] }
  if (/\.(xlsx|xls)$/.test(name)) {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as ArrayBuffer)
    const pages: string[] = []
    wb.eachSheet((ws) => {
      let text = `# ${ws.name}\n`
      ws.eachRow((row) => {
        if (text.length > MAX_PAGE_CHARS * 3) return
        text += (row.values as unknown[]).slice(1).map((v) => (v && typeof v === 'object' && 'result' in v ? (v as { result: unknown }).result : v) ?? '').join(' | ') + '\n'
      })
      pages.push(text.slice(0, MAX_PAGE_CHARS * 3))
    })
    return { pageCount: pages.length, pages, scanned: [] }
  }
  if (/\.(csv|txt|md)$/.test(name)) return { pageCount: 1, pages: [buffer.toString('utf8').slice(0, MAX_PAGE_CHARS * 3)], scanned: [] }
  return { pageCount: 0, pages: [], scanned: [] }
}

export async function getDocText(supabase: SupabaseClient, doc: DocumentRecord): Promise<DocText | null> {
  const { data: cached } = await supabase.from('document_texts').select('page_count, pages, scanned_pages').eq('document_id', doc.id).maybeSingle()
  if (cached) return { pageCount: cached.page_count, pages: cached.pages, scanned: cached.scanned_pages ?? [] }
  if (/\.(xlsx|xls)$/i.test(doc.file_name) && (doc.file_size ?? 0) > MAX_SHEET_BYTES) return null
  const buffer = await download(supabase, doc)
  if (!buffer) return null
  const text = await extract(buffer, doc).catch(() => null)
  if (!text) return null
  // Best effort — fine if the table isn't there yet.
  await supabase
    .from('document_texts')
    .upsert({ document_id: doc.id, page_count: text.pageCount, pages: text.pages, scanned_pages: text.scanned })
    .then(
      () => null,
      () => null
    )
  return text
}

// Pages as PNG images (base64) — for scans and filled-in forms, where the
// text alone loses which number goes in which box.
export async function renderPages(supabase: SupabaseClient, doc: DocumentRecord, pageNumbers: number[]) {
  const buffer = await download(supabase, doc)
  if (!buffer) return []
  if (isImage(doc)) {
    const ext = doc.file_name.toLowerCase().split('.').pop()
    const media = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
    return [{ page: 1, media: media as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data: buffer.toString('base64') }]
  }
  if (!isPdf(doc)) return []
  const mupdf = await import('mupdf')
  const pdf = mupdf.Document.openDocument(buffer, 'application/pdf')
  const n = pdf.countPages()
  return pageNumbers
    .filter((p) => p >= 1 && p <= n)
    .map((p) => {
      const pix = pdf.loadPage(p - 1).toPixmap(mupdf.Matrix.scale(1.4, 1.4), mupdf.ColorSpace.DeviceRGB, false, true)
      return { page: p, media: 'image/png' as const, data: Buffer.from(pix.asPNG()).toString('base64') }
    })
}
