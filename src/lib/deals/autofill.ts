import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { logUsage } from '@/lib/usage'
import { getDocText, renderPages } from '@/lib/chat/doc-text'
import { INDUSTRY_CATEGORIES } from './categories'
import type { DocumentRecord } from '@/lib/types'

// When documents come in, fill in what the deal is missing — the real
// business name (replacing placeholders like "Jeff Zimmerman (business name
// not stated)"), what it does, industry, website, contact details — from
// the first pages of the new files. Uses the cheapest model on a few pages,
// so it's a fraction of a cent. Only fills blanks; never overwrites what
// someone typed.

const MODEL = 'claude-haiku-5-5'
const PAGES_PER_DOC = 2
const MAX_CHARS = 24_000
const MAX_IMAGES = 4
const MAX_DOCS = 8

const field = (what: string) =>
  z
    .object({
      value: z.string().nullable(),
      printed: z.boolean().describe('true only if this exact value is printed in the documents (not inferred).'),
      source: z.string().nullable().describe('Short: which file, e.g. "Chase statement Mar 2026"'),
    })
    .describe(what)

const AutofillSchema = z.object({
  business_name: field("The borrower business's legal name (LLC/Inc…) exactly as printed — not a bank, lender, broker, accountant or the owner's personal name."),
  dba: field('Doing-business-as / trade name, if different'),
  what_it_does: z
    .string()
    .nullable()
    .describe('1–2 plain sentences: what the business does and where it is based. Only from the documents. null if unclear.'),
  industry: z.enum(INDUSTRY_CATEGORIES).nullable().describe('Best-fitting category, or null if unclear.'),
  website: field('Business website'),
  phone: field('Business or owner phone'),
  email: field('Business or owner email'),
  address: field('Business street address, city, state, ZIP'),
  owner_names: z.array(z.string()).describe('Owners / officers named in the documents.'),
})

type Autofill = z.infer<typeof AutofillSchema>
type Deal = Record<string, string | null>

// "Jeff Zimmerman (business name not stated)", "Unknown", "", or just the
// contact's own name.
export function isPlaceholderName(name: string | null | undefined, contact?: string | null) {
  const n = (name ?? '').trim()
  if (!n) return true
  if (/not stated|unknown|unnamed|tbd|n\/a|no name|\?\?/i.test(n)) return true
  return Boolean(contact && n.toLowerCase() === contact.trim().toLowerCase())
}

function missingFields(deal: Deal) {
  return {
    name: isPlaceholderName(deal.company_name, deal.contact_name),
    industry: !deal.industry || deal.industry === 'Other',
    website: !deal.website,
    description: !deal.description,
    phone: !deal.contact_phone,
    email: !deal.contact_email,
    contact: !deal.contact_name,
  }
}

async function material(supabase: SupabaseClient, docs: DocumentRecord[]) {
  const blocks: Anthropic.ContentBlockParam[] = []
  let chars = 0
  let images = 0
  for (const doc of docs.slice(0, MAX_DOCS)) {
    const text = await getDocText(supabase, doc).catch(() => null)
    if (!text || !text.pageCount) continue
    const first = Array.from({ length: Math.min(PAGES_PER_DOC, text.pageCount) }, (_, i) => i + 1)
    const scans = first.filter((p) => text.scanned.includes(p))
    const textPages = first.filter((p) => !scans.includes(p))
    if (textPages.length && chars < MAX_CHARS) {
      const body = textPages.map((p) => text.pages[p - 1]).join('\n').slice(0, 5000)
      chars += body.length
      blocks.push({ type: 'text', text: `--- ${doc.file_name} (first pages) ---\n${body}` })
    }
    if (scans.length && images < MAX_IMAGES) {
      const rendered = await renderPages(supabase, doc, scans.slice(0, MAX_IMAGES - images)).catch(() => [])
      for (const img of rendered) {
        blocks.push({ type: 'text', text: `--- ${doc.file_name}, page ${img.page} (scan) ---` })
        blocks.push({ type: 'image', source: { type: 'base64', media_type: img.media, data: img.data } })
        images++
      }
    }
  }
  return blocks
}

// Returns the list of things it filled in (empty if nothing was missing or
// nothing was found). documentIds: just the new files; omit to use all.
export async function autofillDeal(supabase: SupabaseClient, dealId: string, documentIds?: string[]): Promise<string[]> {
  const { data: deal } = await supabase.from('deals').select('*').eq('id', dealId).maybeSingle()
  if (!deal) return []
  const missing = missingFields(deal as Deal)
  // Nothing to fill — don't spend anything.
  if (!Object.values(missing).some(Boolean)) return []

  let query = supabase.from('documents').select('*').eq('deal_id', dealId).order('uploaded_at', { ascending: false })
  if (documentIds?.length) query = query.in('id', documentIds)
  const { data: docs } = await query
  const blocks = await material(supabase, (docs ?? []) as DocumentRecord[])
  if (!blocks.length) return []

  const response = await new Anthropic().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: zodOutputFormat(AutofillSchema) },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `These are the first pages of documents a borrower sent a commercial loan broker. The deal is filed as "${deal.company_name}"${deal.contact_name ? ` (contact: ${deal.contact_name})` : ''}. Identify the borrower's business from the documents. Copy names, websites, phones and addresses exactly as printed; never guess. Ignore banks, lenders, brokers, accountants and the broker's own details (JED Capital).`,
          },
          ...blocks,
        ],
      },
    ],
  })
  await logUsage({ feature: 'deal-autofill', model: MODEL, dealId, usage: response.usage, supabase })
  const found = response.parsed_output as Autofill | null
  if (!found) return []

  const update: Record<string, string> = {}
  const changed: string[] = []
  const sure = (f: Autofill['website']) => (f.value && f.printed ? f.value.trim() : null)

  const name = sure(found.business_name)
  if (missing.name && name && !isPlaceholderName(name)) {
    update.company_name = name
    changed.push(`name → ${name}${found.business_name.source ? ` (${found.business_name.source})` : ''}`)
  }
  if (missing.industry && found.industry && found.industry !== 'Other') {
    update.industry = found.industry
    changed.push(`industry → ${found.industry}`)
  }
  const website = sure(found.website)
  if (missing.website && website) {
    update.website = website
    changed.push(`website → ${website}`)
  }
  if (missing.description && found.what_it_does) {
    const dba = sure(found.dba)
    const address = sure(found.address)
    update.description = [found.what_it_does, dba ? `DBA ${dba}.` : null, address ? `Address: ${address}.` : null].filter(Boolean).join(' ')
    changed.push('description')
  }
  const phone = sure(found.phone)
  if (missing.phone && phone) {
    update.contact_phone = phone
    changed.push(`phone → ${phone}`)
  }
  const email = sure(found.email)
  if (missing.email && email && !/jed-capital/i.test(email)) {
    update.contact_email = email
    changed.push(`email → ${email}`)
  }
  if (missing.contact && found.owner_names[0]) {
    update.contact_name = found.owner_names[0]
    changed.push(`contact → ${found.owner_names[0]}`)
  }
  if (!changed.length) return []

  await supabase.from('deals').update(update).eq('id', dealId)
  await supabase.from('deal_updates').insert({
    deal_id: dealId,
    entry_date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
    note: `Filled in from the documents: ${changed.join('; ')}.`,
    source: 'ai',
  })
  return changed
}
