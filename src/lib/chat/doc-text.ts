import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { unzipSync, strFromU8 } from 'fflate'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DocumentRecord } from '@/lib/types'
import { logUsage } from '@/lib/usage'

// Page-by-page text of a deal document, pulled out once and kept in
// document_texts (works without that table too, just slower). Includes what
// was typed into a PDF's fillable boxes, Word documents' text, and — for
// scanned pages and photos — what the AI reads off the image (once, ~½¢ a
// page). Pages that were scans stay listed so Ask AI can still look at them.

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
      const page = pdf.loadPage(i)
      const printed = page.toStructuredText('preserve-whitespace').asText().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
      const t = [printed, formValues(page)].filter(Boolean).join('\n\n')
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
  if (/\.docx$/.test(name)) {
    const xml = strFromU8(unzipSync(new Uint8Array(buffer), { filter: (f) => f.name === 'word/document.xml' })['word/document.xml'] ?? new Uint8Array())
    const text = xml
      .split(/<\/w:p>/)
      .map((para) => (para.match(/<w:t[^>]*>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
      .filter((line) => line.trim())
      .join('\n')
    const pages: string[] = []
    for (let i = 0; i < text.length; i += MAX_PAGE_CHARS) pages.push(text.slice(i, i + MAX_PAGE_CHARS))
    return { pageCount: pages.length, pages, scanned: [] }
  }
  if (/\.(csv|txt|md)$/.test(name)) return { pageCount: 1, pages: [buffer.toString('utf8').slice(0, MAX_PAGE_CHARS * 3)], scanned: [] }
  return { pageCount: 0, pages: [], scanned: [] }
}

// What was typed into a PDF page's fillable boxes ("Market value: 1,300,000"),
// which the printed text doesn't include.
function formValues(page: unknown) {
  const widgets = (page as { getWidgets?: () => { getName(): string; getValue(): string; getFieldType(): string }[] }).getWidgets?.() ?? []
  return widgets
    .map((w) => {
      const value = (w.getValue() ?? '').trim()
      if (!value || /^(off|false)$/i.test(value)) return null
      return `${w.getName()}: ${/checkbox|radiobutton/i.test(w.getFieldType()) ? '✓' : value}`
    })
    .filter(Boolean)
    .join('\n')
}

const OCR_MODEL = 'claude-haiku-5-5'
const OCR_MAX_PAGES = 6
const FROM_IMAGE = '[read from image]'
const needsOcr = (text: DocText) => text.scanned.filter((p) => !(text.pages[p - 1] ?? '').startsWith(FROM_IMAGE)).slice(0, OCR_MAX_PAGES)

// Scanned pages and photos: the AI reads the image once and its text is
// kept like any other page's (marked, so it isn't read twice).
async function readScans(supabase: SupabaseClient, doc: DocumentRecord, buffer: Buffer, text: DocText): Promise<DocText> {
  const todo = needsOcr(text)
  if (!todo.length || (!isPdf(doc) && !isImage(doc))) return text
  const images = await imagesOf(buffer, doc, todo)
  const client = new Anthropic()
  const pages = [...text.pages]
  for (const img of images) {
    try {
      const res = await client.messages.create({
        model: OCR_MODEL,
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: img.media, data: img.data } },
              {
                type: 'text',
                text: 'Transcribe every piece of text on this page exactly, including typed or handwritten values in form boxes and tables. Keep each label with its value on one line ("Market value: 1,300,000"), and each table row on one line with its column headers. No commentary.',
              },
            ],
          },
        ],
      })
      await logUsage({ feature: 'document-ocr', model: OCR_MODEL, dealId: doc.deal_id, usage: res.usage, supabase })
      const out = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
      pages[img.page - 1] = `${FROM_IMAGE} ${out || '(no text found)'}`.slice(0, MAX_PAGE_CHARS)
    } catch (err) {
      console.error('Reading a scanned page failed', doc.file_name, img.page, err)
    }
  }
  return { ...text, pageCount: Math.max(text.pageCount, pages.length), pages }
}

// Bumped when the reader learns something new (2: form boxes, Word, scans);
// texts saved by an older reader are read again once (migration 049).
const READER_VERSION = 2

export async function getDocText(supabase: SupabaseClient, doc: DocumentRecord): Promise<DocText | null> {
  const { data: cached } = await supabase.from('document_texts').select('*').eq('document_id', doc.id).maybeSingle()
  const outdated = cached && 'reader_version' in cached && Number(cached.reader_version) < READER_VERSION
  if (cached && !outdated) {
    const kept = { pageCount: cached.page_count, pages: cached.pages ?? [], scanned: cached.scanned_pages ?? [] } as DocText
    // Read before scans could be read: read them now, once.
    if (!needsOcr(kept).length) return kept
    const buffer = await download(supabase, doc)
    if (!buffer) return kept
    const read = await readScans(supabase, doc, buffer, kept)
    await supabase.from('document_texts').update({ pages: read.pages, page_count: read.pageCount }).eq('document_id', doc.id).then(
      () => null,
      () => null
    )
    return read
  }
  if (/\.(xlsx|xls)$/i.test(doc.file_name) && (doc.file_size ?? 0) > MAX_SHEET_BYTES) return null
  const buffer = await download(supabase, doc)
  if (!buffer) return null
  const extracted = await extract(buffer, doc).catch(() => null)
  if (!extracted) return null
  const text = await readScans(supabase, doc, buffer, extracted)
  // Best effort — fine if the table isn't there yet; without migration 049
  // it's saved without the reader version.
  const row = { document_id: doc.id, page_count: text.pageCount, pages: text.pages, scanned_pages: text.scanned }
  const { error } = await supabase.from('document_texts').upsert({ ...row, reader_version: READER_VERSION })
  if (error) await supabase.from('document_texts').upsert(row).then(
    () => null,
    () => null
  )
  return text
}

// Text of a file that isn't a deal document (e.g. a lender's tear sheet):
// read the same way, scans included, but not kept in document_texts.
export async function readFileText(
  supabase: SupabaseClient,
  file: { file_name: string; storage_path: string; content_type: string | null; file_size: number | null }
): Promise<DocText | null> {
  const doc = { ...file, id: '', deal_id: null } as unknown as DocumentRecord
  if (/\.(xlsx|xls)$/i.test(doc.file_name) && (doc.file_size ?? 0) > MAX_SHEET_BYTES) return null
  const buffer = await download(supabase, doc)
  if (!buffer) return null
  const extracted = await extract(buffer, doc).catch(() => null)
  return extracted ? readScans(supabase, doc, buffer, extracted) : null
}

// Pages as PNG images (base64) — for scans and filled-in forms, where the
// text alone loses which number goes in which box.
export async function renderPages(supabase: SupabaseClient, doc: DocumentRecord, pageNumbers: number[]) {
  const buffer = await download(supabase, doc)
  if (!buffer) return []
  return imagesOf(buffer, doc, pageNumbers)
}

async function imagesOf(buffer: Buffer, doc: DocumentRecord, pageNumbers: number[]) {
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
