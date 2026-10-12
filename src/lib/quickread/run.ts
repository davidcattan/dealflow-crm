import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/usage'
import { loadDealEmails, emailsToText } from '@/lib/deals/deal-emails'
import { snapshotToText } from '@/lib/snapshot/text'
import type { Snapshot } from '@/lib/snapshot/schema'
import type { DocumentRecord } from '@/lib/types'
import { QuickReadSchema, type QuickRead } from './schema'

// Quick read: a short take instead of the full underwriting. Uses the
// cheaper model and reads as little as possible — the existing snapshot if
// the deal was already underwritten (about a penny), otherwise the text of
// the documents (scanned PDFs: their first pages only).

const MODEL = 'claude-sonnet-5-5'
const TEXT_PAGES_PER_PDF = 40
const SCANNED_PAGES_PER_PDF = 12
const MAX_TEXT_CHARS = 160_000

const RULES = `You are a commercial-finance analyst giving a debt broker a QUICK READ of a deal — just the important things, not a full underwriting. Be brief: short phrases, no paragraphs. Use only facts and numbers in the material; never invent or estimate. If something important isn't there, say it's missing rather than guess.`

type Block = Anthropic.ContentBlockParam

// Documents as cheaply as possible: extracted text for normal PDFs, the
// first pages as real pages for scans, spreadsheets as text.
async function cheapDocuments(supabase: SupabaseClient, docs: DocumentRecord[]): Promise<{ blocks: Block[]; skipped: string[] }> {
  const mupdf = await import('mupdf')
  const blocks: Block[] = []
  const skipped: string[] = []
  let chars = 0
  for (const doc of [...docs].sort((a, b) => (a.file_size ?? 0) - (b.file_size ?? 0))) {
    if (chars > MAX_TEXT_CHARS) {
      skipped.push(doc.file_name)
      continue
    }
    const { data } = await supabase.storage.from('borrower-documents').download(doc.storage_path)
    if (!data) {
      skipped.push(doc.file_name)
      continue
    }
    const buffer = Buffer.from(await data.arrayBuffer())
    const name = doc.file_name.toLowerCase()
    try {
      if (name.endsWith('.pdf') || doc.content_type === 'application/pdf') {
        const pdf = mupdf.Document.openDocument(buffer, 'application/pdf')
        const total = pdf.countPages()
        let text = ''
        for (let i = 0; i < Math.min(total, TEXT_PAGES_PER_PDF); i++) text += pdf.loadPage(i).toStructuredText('preserve-whitespace').asText() + '\n'
        const perPage = text.replace(/\s+/g, '').length / Math.max(1, Math.min(total, TEXT_PAGES_PER_PDF))
        if (perPage > 150) {
          const clipped = text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').slice(0, 40_000)
          chars += clipped.length
          blocks.push({ type: 'text', text: `--- ${doc.file_name} (${total} pages${total > TEXT_PAGES_PER_PDF ? `, first ${TEXT_PAGES_PER_PDF} as text` : ''}) ---\n${clipped}` })
        } else {
          // A scan: send its first pages as real pages.
          const out = pdf.asPDF()!
          for (let i = total - 1; i >= SCANNED_PAGES_PER_PDF; i--) out.deletePage(i)
          blocks.push({ type: 'text', text: `--- ${doc.file_name} (scanned; first ${Math.min(total, SCANNED_PAGES_PER_PDF)} of ${total} pages) ---` })
          blocks.push({
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(out.saveToBuffer('compress').asUint8Array()).toString('base64') },
          })
          chars += 20_000
        }
      } else if (/\.(xlsx|xls)$/.test(name)) {
        const ExcelJS = (await import('exceljs')).default
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(buffer as unknown as ArrayBuffer)
        let text = ''
        wb.eachSheet((ws) => {
          text += `# ${ws.name}\n`
          ws.eachRow((row) => (text += (row.values as unknown[]).slice(1).map((v) => (v && typeof v === 'object' && 'result' in v ? (v as { result: unknown }).result : v) ?? '').join(' | ') + '\n'))
        })
        const clipped = text.slice(0, 30_000)
        chars += clipped.length
        blocks.push({ type: 'text', text: `--- ${doc.file_name} ---\n${clipped}` })
      } else if (/\.(csv|txt)$/.test(name)) {
        const clipped = buffer.toString('utf8').slice(0, 30_000)
        chars += clipped.length
        blocks.push({ type: 'text', text: `--- ${doc.file_name} ---\n${clipped}` })
      } else skipped.push(doc.file_name)
    } catch {
      skipped.push(doc.file_name)
    }
  }
  return { blocks, skipped }
}

export async function runQuickRead(supabase: SupabaseClient, dealId: string): Promise<QuickRead> {
  const [{ data: deal }, { data: documents }, emails] = await Promise.all([
    supabase.from('deals').select('*').eq('id', dealId).single(),
    supabase.from('documents').select('*').eq('deal_id', dealId),
    loadDealEmails(supabase, dealId, 12),
  ])
  if (!deal) throw new Error('Deal not found')

  const header = [
    `Deal: ${deal.company_name}`,
    deal.loan_type ? `Loan type: ${deal.loan_type}` : null,
    deal.deal_type ? `Ask: ${deal.deal_type}` : null,
    deal.description ? `Broker's description: ${deal.description}` : null,
    deal.notes ? `Notes: ${deal.notes}` : null,
    emailsToText(emails),
  ]
    .filter(Boolean)
    .join('\n')

  let material: Block[]
  if (deal.snapshot) {
    material = [{ type: 'text', text: `Underwriting snapshot already done for this deal:\n${snapshotToText(deal.snapshot as Snapshot)}` }]
  } else {
    const { blocks, skipped } = await cheapDocuments(supabase, (documents ?? []) as DocumentRecord[])
    material = blocks.length ? blocks : [{ type: 'text', text: 'No readable documents yet — work from the emails and notes.' }]
    if (skipped.length) material.push({ type: 'text', text: `Not read: ${skipped.join(', ')}` })
  }

  const response = await new Anthropic().messages.parse({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: [{ type: 'text', text: header }, ...material, { type: 'text', text: RULES }] }],
    output_config: { format: zodOutputFormat(QuickReadSchema) },
  })
  await logUsage({ feature: 'quick-read', model: MODEL, dealId, usage: response.usage })
  if (!response.parsed_output) throw new Error('Couldn’t write the quick read')
  return response.parsed_output
}
