import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/usage'
import { loadDealEmails, emailsToText } from '@/lib/deals/deal-emails'
import type { DocumentRecord } from '@/lib/types'
import { ProfileSchema, fromAi, scrubProfile, type Profile } from './schema'

// Borrower profile: reads the deal's tax returns, entity papers and emails
// and pulls out what lender application forms ask for (legal name, EIN,
// owners and their percentages, addresses…). Only the pages that matter are
// sent — as real pages, so filled-in form values stay next to their labels.

const MODEL = 'claude-sonnet-5-5'
const PAGES_PER_DOC = 18
const SCANNED_PAGES_PER_DOC = 10
const MAX_PAGES = 50

// Documents worth reading for owner/company details.
const USEFUL = /tax|return|1040|1120|1065|k-?1|schedule|article|incorporat|organiz|operating|bylaw|certificate|formation|ein|ss-?4|good standing|application|\bapp\b|license|\bid\b|passport|pfs|personal financial|debt schedule|ownership|cap table|resolution|w-?9/i
const NOT_USEFUL = /statement|bank|appraisal|invoice|photo|\.(jpe?g|png|heic)$/i
// Pages that carry owner / entity details — the strongest ones (K-1s,
// officer lists, subsidiaries) are kept first when a document is long.
const KEY_PAGE =
  /schedule k-1|shareholder'?s name|partner'?s name|1125-e|compensation of officers|schedule b\b|date incorporated|registered agent|governors?\b|member'?s name|percentage of|stock owned/i
const OWNER_PAGE =
  /shareholder|partner'?s|member|officer|k-1|schedule b\b|employer identification|date incorporated|incorporat|organiz|ownership|percent(age)? of|president|director|governor|manager|registered agent|social security|signature of officer|principal|balance sheets? per books|loans from shareholders/i

type Block = Anthropic.ContentBlockParam

function pickDocs(docs: DocumentRecord[]) {
  const label = (d: DocumentRecord) => `${d.file_name} ${d.triage?.doc_type ?? ''}`
  const picked = docs.filter((d) => USEFUL.test(label(d)) && !NOT_USEFUL.test(d.file_name))
  // Nothing obviously useful: try the smallest non-statement files.
  if (!picked.length) return docs.filter((d) => !/statement|bank/i.test(label(d))).sort((a, b) => (a.file_size ?? 0) - (b.file_size ?? 0)).slice(0, 4)
  // Newest first, so this year's return wins over last year's.
  return picked.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
}

async function documentPages(supabase: SupabaseClient, docs: DocumentRecord[]): Promise<{ blocks: Block[]; read: string[]; skipped: string[] }> {
  const mupdf = await import('mupdf')
  const blocks: Block[] = []
  const read: string[] = []
  const skipped: string[] = []
  let pagesSent = 0
  const seen = new Set<string>()
  for (const doc of docs) {
    // Same file uploaded twice.
    const key = `${doc.file_name.toLowerCase()}|${doc.file_size}`
    if (seen.has(key)) continue
    seen.add(key)
    if (pagesSent >= MAX_PAGES) {
      skipped.push(doc.file_name)
      continue
    }
    const { data } = await supabase.storage.from('borrower-documents').download(doc.storage_path)
    if (!data) {
      skipped.push(doc.file_name)
      continue
    }
    const buffer = Buffer.from(await data.arrayBuffer())
    const isPdf = doc.file_name.toLowerCase().endsWith('.pdf') || doc.content_type === 'application/pdf'
    try {
      if (isPdf) {
        const pdf = mupdf.Document.openDocument(buffer, 'application/pdf')
        const total = pdf.countPages()
        const texts = Array.from({ length: total }, (_, i) => pdf.loadPage(i).toStructuredText('preserve-whitespace').asText())
        const scanned = texts.reduce((n, t) => n + t.replace(/\s+/g, '').length, 0) / Math.max(1, total) < 150
        // Text PDFs: the first 2 pages plus every page with owner/entity
        // details. Scans: just the first pages.
        const room = Math.min(scanned ? SCANNED_PAGES_PER_DOC : PAGES_PER_DOC, MAX_PAGES - pagesSent)
        let keep: number[]
        if (scanned) keep = Array.from({ length: Math.min(total, room) }, (_, i) => i)
        else {
          const pages = texts.map((t, i) => i)
          const first = pages.filter((i) => i < 2 || KEY_PAGE.test(texts[i]))
          const then = pages.filter((i) => !first.includes(i) && OWNER_PAGE.test(texts[i]))
          keep = [...first, ...then].slice(0, room).sort((a, b) => a - b)
        }
        // A fresh copy with every other page removed.
        const out = mupdf.Document.openDocument(buffer, 'application/pdf').asPDF()!
        const wanted = new Set(keep)
        for (let i = total - 1; i >= 0; i--) if (!wanted.has(i)) out.deletePage(i)
        blocks.push({ type: 'text', text: `--- ${doc.file_name} (${total} pages; showing pages ${keep.map((i) => i + 1).join(', ')}) ---` })
        blocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(out.saveToBuffer('compress').asUint8Array()).toString('base64') },
        })
        pagesSent += keep.length
        read.push(doc.file_name)
      } else if (/\.(jpe?g|png)$/i.test(doc.file_name)) {
        blocks.push({ type: 'text', text: `--- ${doc.file_name} ---` })
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: doc.file_name.toLowerCase().endsWith('png') ? 'image/png' : 'image/jpeg', data: buffer.toString('base64') },
        })
        pagesSent += 1
        read.push(doc.file_name)
      } else skipped.push(doc.file_name)
    } catch {
      skipped.push(doc.file_name)
    }
  }
  return { blocks, read, skipped }
}

const RULES = `You are filling in the borrower section of a commercial loan application for a debt broker. From the documents, emails and notes above, extract the operating company's details and every owner's details.

Rules:
- Copy values EXACTLY as printed (spelling, punctuation, suite numbers). Never guess or invent. If it isn't there, value = "" and status = "missing".
- status "confirmed" only when the value is printed in a document for THIS company/person. Use "check" when you worked it out (e.g. a date or EIN from a parent/holding company, a percentage held indirectly, an email from a signature line, or documents that disagree) and say why in note.
- The operating company may sit under a holding company: give the operating company's own legal name and EIN, list the parent under related_entities, and warn if a form could mix them up.
- If the company name is spelled differently anywhere (deal name, emails, documents), add a warning.
- Ownership: give each person's percentage; if they own it through a parent company, say so in note.
- NEVER output a Social Security number or any digits of one. For ssn_where give only where it appears (document and page).
- source: short, e.g. "2024 tax return (1120-S), p.15".`

export async function runProfile(supabase: SupabaseClient, dealId: string): Promise<{ profile: Profile; read: string[] }> {
  const [{ data: deal }, { data: documents }, emails] = await Promise.all([
    supabase.from('deals').select('*').eq('id', dealId).single(),
    supabase.from('documents').select('*').eq('deal_id', dealId),
    loadDealEmails(supabase, dealId, 15),
  ])
  if (!deal) throw new Error('Deal not found')

  const docs = pickDocs((documents ?? []) as DocumentRecord[])
  const { blocks, read, skipped } = await documentPages(supabase, docs)
  if (!blocks.length && !emails.length) throw new Error('No tax returns, entity papers or emails on this deal to read yet.')

  const header = [
    `Deal name in our CRM: ${deal.company_name}`,
    deal.contact_name ? `Contact on file: ${deal.contact_name} ${deal.contact_email ?? ''} ${deal.contact_phone ?? ''}` : null,
    deal.website ? `Website on file: ${deal.website}` : null,
    deal.description ? `Broker's description: ${deal.description}` : null,
    deal.notes ? `Notes: ${deal.notes}` : null,
    emailsToText(emails),
  ]
    .filter(Boolean)
    .join('\n')

  const content: Block[] = [{ type: 'text', text: header }, ...blocks]
  if (skipped.length) content.push({ type: 'text', text: `Not read: ${skipped.join(', ')}` })
  content.push({ type: 'text', text: RULES })

  const response = await new Anthropic().messages.parse({
    model: MODEL,
    max_tokens: 6000,
    messages: [{ role: 'user', content }],
    output_config: { format: zodOutputFormat(ProfileSchema) },
  })
  await logUsage({ feature: 'borrower-profile', model: MODEL, dealId, usage: response.usage })
  if (!response.parsed_output) throw new Error('Couldn’t read the owner details')
  return { profile: scrubProfile(fromAi(response.parsed_output)), read }
}
