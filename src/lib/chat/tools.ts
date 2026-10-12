import 'server-only'
import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { DocumentRecord } from '@/lib/types'
import { buildDealContext } from './context'
import { getDocText, renderPages } from './doc-text'

// Ask AI's tools: read the deal's documents itself (search, then open just
// the pages it needs), and look things up anywhere in the CRM. Read-only.
// Built to be cheap: text first, page images only for scans and forms, and
// hard caps on how much one question can read.

export type ToolBudget = { imagesLeft: number; charsLeft: number }

export const TOOL_LIMITS = {
  quick: { images: 12, chars: 120_000, rounds: 8 },
  deep: { images: 30, chars: 300_000, rounds: 14 },
}

const SEARCH_HITS = 12
const PAGES_PER_READ = 8
const IMAGES_PER_READ = 6

export const CHAT_TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: 'search_documents',
    description:
      "Search the text of a deal's uploaded documents (tax returns, statements, appraisals, agreements…) for words or numbers. Returns the best-matching pages with a snippet, so you know which pages to open with read_pages. Scanned documents have no text — they are listed so you can open their pages as images. Defaults to the current deal.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords, e.g. "shareholder percentage K-1" or "ending balance".' },
        deal_id: { type: ['string', 'null'], description: 'Another deal to search; null for the current deal.' },
      },
      required: ['query', 'deal_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_pages',
    description:
      'Open specific pages of a document. Returns the page text, or page images when as_images is true (always for scanned pages). Use images for tax forms, applications and other filled-in forms when exact values matter — the text alone loses which number belongs to which box. Read only the pages you need.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'The document id from the deal context or a search result.' },
        pages: { type: 'string', description: `Page numbers like "1" or "9,10,15-16" (max ${PAGES_PER_READ} pages).` },
        as_images: { type: 'boolean', description: `true to see the pages as images (max ${IMAGES_PER_READ}).` },
      },
      required: ['document_id', 'pages', 'as_images'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_deals',
    description: 'Find deals anywhere in the CRM by company, contact, industry or words in the description. Returns id, name, status, contact and ask.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name or words to look for; empty string lists the most recently updated active deals.' },
        include_closed: { type: 'boolean', description: 'Also include dead / closed / old deals.' },
      },
      required: ['query', 'include_closed'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_deal',
    description: 'Everything the CRM knows about one deal (status, contact, underwriting summary, lenders sent to and their replies, documents, updates, emails).',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { deal_id: { type: 'string' } },
      required: ['deal_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_lenders',
    description:
      "Search the lender list by name, lending type, mandate notes, asset types, industries or geography. Returns each lender's program basics and contact.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'e.g. "ABL", "Texas", "construction", or a lender name.' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_lender',
    description: 'One lender in full: program, contacts, and every deal we sent them with its status.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { lender_id: { type: 'string' } },
      required: ['lender_id'],
      additionalProperties: false,
    },
  },
  { type: 'web_search_20260209', name: 'web_search', max_uses: 2 },
]

const SearchInput = z.object({ query: z.string(), deal_id: z.string().nullable() })
const ReadInput = z.object({ document_id: z.string(), pages: z.string(), as_images: z.boolean() })
const FindDealsInput = z.object({ query: z.string(), include_closed: z.boolean() })
const IdInput = (key: string) => z.object({ [key]: z.string().uuid() })
const FindLendersInput = z.object({ query: z.string() })

type Ctx = { supabase: SupabaseClient; dealId: string | null; budget: ToolBudget }
type Result = { content: string | Anthropic.Beta.BetaToolResultBlockParam['content']; status: string; isError?: boolean }

function parsePages(spec: string, max: number) {
  const out: number[] = []
  for (const part of spec.split(/[,\s]+/).filter(Boolean)) {
    const [a, b] = part.split('-').map((x) => parseInt(x, 10))
    if (!Number.isFinite(a)) continue
    for (let p = a; p <= (Number.isFinite(b) ? b : a) && out.length < max; p++) if (!out.includes(p)) out.push(p)
  }
  return out
}

function clip(text: string, ctx: Ctx, max: number) {
  const room = Math.min(max, ctx.budget.charsLeft)
  const out = text.length > room ? `${text.slice(0, room)}\n…[cut — reading limit for this question]` : text
  ctx.budget.charsLeft -= out.length
  return out
}

async function dealDocs(supabase: SupabaseClient, dealId: string) {
  const { data } = await supabase.from('documents').select('*').eq('deal_id', dealId).order('uploaded_at', { ascending: false })
  // Same file uploaded twice: keep one.
  const seen = new Set<string>()
  return ((data ?? []) as DocumentRecord[]).filter((d) => {
    const key = `${d.file_name.toLowerCase()}|${d.file_size}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function searchDocuments(ctx: Ctx, query: string, dealId: string | null): Promise<Result> {
  const target = dealId ?? ctx.dealId
  if (!target) return { content: 'Open a deal first, or pass a deal_id from find_deals.', status: 'No deal to search', isError: true }
  const docs = (await dealDocs(ctx.supabase, target)).slice(0, 80)
  const terms = query.toLowerCase().split(/[^a-z0-9$%.,-]+/).filter((t) => t.length > 1)
  const hits: { score: number; line: string }[] = []
  const scannedDocs: string[] = []
  // A few at a time — first search on a deal pulls the text out of each file.
  for (let i = 0; i < docs.length; i += 6) {
    const batch = docs.slice(i, i + 6)
    const texts = await Promise.all(batch.map((d) => getDocText(ctx.supabase, d)))
    batch.forEach((doc, j) => {
      const t = texts[j]
      if (!t) return
      if (t.scanned.length === t.pageCount && t.pageCount > 0) {
        scannedDocs.push(`[${doc.id}] ${doc.file_name} — ${t.pageCount} scanned page${t.pageCount === 1 ? '' : 's'}`)
        return
      }
      t.pages.forEach((page, p) => {
        const lower = page.toLowerCase()
        const name = doc.file_name.toLowerCase()
        let score = 0
        for (const term of terms) if (lower.includes(term) || name.includes(term)) score += lower.split(term).length - 1 + (name.includes(term) ? 2 : 0) + 3
        if (!score) return
        const first = terms.map((term) => lower.indexOf(term)).filter((x) => x >= 0).sort((a, b) => a - b)[0] ?? 0
        const snippet = page.slice(Math.max(0, first - 120), first + 220).replace(/\s+/g, ' ').trim()
        hits.push({ score, line: `[${doc.id}] ${doc.file_name} — p.${p + 1}/${t.pageCount}${t.scanned.includes(p + 1) ? ' (scan)' : ''}: …${snippet}…` })
      })
    })
  }
  hits.sort((a, b) => b.score - a.score)
  const lines = hits.slice(0, SEARCH_HITS).map((h) => h.line)
  const text = [
    lines.length ? `Best matches for "${query}":\n${lines.join('\n')}` : `No text matches for "${query}" in ${docs.length} document(s).`,
    scannedDocs.length ? `\nScanned (no text — open with read_pages as_images):\n${scannedDocs.join('\n')}` : '',
  ].join('\n')
  return { content: clip(text, ctx, 8000), status: `Searched ${docs.length} document${docs.length === 1 ? '' : 's'} for “${query}”` }
}

async function readPages(ctx: Ctx, documentId: string, spec: string, asImages: boolean): Promise<Result> {
  const { data: doc } = await ctx.supabase.from('documents').select('*').eq('id', documentId).maybeSingle()
  if (!doc) return { content: 'No document with that id.', status: 'Document not found', isError: true }
  const d = doc as DocumentRecord
  const text = await getDocText(ctx.supabase, d)
  if (!text) return { content: `Couldn’t open ${d.file_name}.`, status: `Couldn’t open ${d.file_name}`, isError: true }
  const pages = parsePages(spec, PAGES_PER_READ).filter((p) => p >= 1 && p <= Math.max(1, text.pageCount))
  if (!pages.length) return { content: `${d.file_name} has ${text.pageCount} page(s).`, status: `Checked ${d.file_name}`, isError: true }

  const wantImages = pages.filter((p) => asImages || text.scanned.includes(p)).slice(0, Math.min(IMAGES_PER_READ, ctx.budget.imagesLeft))
  const blocks: Exclude<Anthropic.Beta.BetaToolResultBlockParam['content'], string | undefined> = []
  const textPages = pages.filter((p) => !wantImages.includes(p) && !(asImages || text.scanned.includes(p)))
  if (textPages.length) {
    const body = textPages.map((p) => `--- ${d.file_name}, page ${p} of ${text.pageCount} ---\n${text.pages[p - 1] || '(blank)'}`).join('\n\n')
    blocks.push({ type: 'text', text: clip(body, ctx, 40_000) })
  }
  if (wantImages.length) {
    const images = await renderPages(ctx.supabase, d, wantImages)
    ctx.budget.imagesLeft -= images.length
    for (const img of images) {
      blocks.push({ type: 'text', text: `--- ${d.file_name}, page ${img.page} of ${text.pageCount} (image) ---` })
      blocks.push({ type: 'image', source: { type: 'base64', media_type: img.media, data: img.data } })
    }
  }
  const skipped = pages.filter((p) => !textPages.includes(p) && !wantImages.includes(p))
  if (skipped.length) blocks.push({ type: 'text', text: `Not shown (image limit for this question reached): pages ${skipped.join(', ')}.` })
  return { content: blocks, status: `Read ${d.file_name}, page${pages.length === 1 ? '' : 's'} ${pages.join(', ')}${wantImages.length ? ' (as images)' : ''}` }
}

const like = (q: string) => `%${q.replace(/[%_,()]/g, ' ').trim()}%`

async function findDeals(ctx: Ctx, query: string, includeClosed: boolean): Promise<Result> {
  let q = ctx.supabase
    .from('deals')
    .select('id, company_name, status, contact_name, contact_email, industry, loan_type, deal_type, owner, updated_at')
    .order('updated_at', { ascending: false })
    .limit(25)
  if (query.trim()) {
    const p = like(query)
    q = q.or(`company_name.ilike.${p},contact_name.ilike.${p},contact_email.ilike.${p},industry.ilike.${p},description.ilike.${p},notes.ilike.${p},deal_type.ilike.${p}`)
  }
  if (!includeClosed) q = q.not('status', 'in', '(dead,closed,old)')
  const { data } = await q
  const rows = (data ?? []) as Record<string, unknown>[]
  const text = rows.length
    ? rows
        .map((r) => `[${r.id}] ${r.company_name} — ${r.status}${r.owner ? `, ${r.owner}'s` : ''} | contact: ${r.contact_name ?? '—'} | ${r.industry ?? ''} ${r.loan_type ?? ''} | ask: ${r.deal_type ?? '—'} | updated ${String(r.updated_at).slice(0, 10)}`)
        .join('\n')
    : `No deals match "${query}".`
  return { content: clip(text, ctx, 8000), status: query ? `Looked up deals matching “${query}”` : 'Looked at the pipeline' }
}

async function getDeal(ctx: Ctx, dealId: string): Promise<Result> {
  const deal = await buildDealContext(ctx.supabase, dealId).catch(() => null)
  if (!deal) return { content: 'No deal with that id.', status: 'Deal not found', isError: true }
  return { content: clip(deal.text, ctx, 25_000), status: `Opened ${deal.dealName}` }
}

const money = (n: unknown) => (n == null ? null : `$${Number(n).toLocaleString('en-US')}`)

async function findLenders(ctx: Ctx, query: string): Promise<Result> {
  const p = like(query)
  const { data } = await ctx.supabase
    .from('lenders')
    .select('id, name, lending_type, min_loan_amount, max_loan_amount, geographies, asset_types, industries, contact_name, contact_email, status')
    .or(`name.ilike.${p},lending_type.ilike.${p},mandate_notes.ilike.${p},contact_name.ilike.${p}`)
    .limit(30)
  // Arrays (geography, assets, industries) are matched here.
  const { data: all } = await ctx.supabase.from('lenders').select('id, name, lending_type, min_loan_amount, max_loan_amount, geographies, asset_types, industries, contact_name, contact_email, status').limit(1000)
  const ql = query.toLowerCase()
  const extra = (all ?? []).filter((l) => [...(l.geographies ?? []), ...(l.asset_types ?? []), ...(l.industries ?? [])].some((x: string) => x.toLowerCase().includes(ql)))
  const rows = [...(data ?? []), ...extra.filter((e) => !(data ?? []).some((d) => d.id === e.id))].slice(0, 30)
  const text = rows.length
    ? rows
        .map(
          (l) =>
            `[${l.id}] ${l.name}${l.status === 'inactive' ? ' (inactive)' : ''} — ${l.lending_type ?? '—'} | ${[money(l.min_loan_amount), money(l.max_loan_amount)].filter(Boolean).join('–') || 'size n/a'} | ${(l.geographies ?? []).join(', ') || 'geo n/a'} | contact: ${[l.contact_name, l.contact_email].filter(Boolean).join(' ') || '—'}`
        )
        .join('\n')
    : `No lenders match "${query}".`
  return { content: clip(text, ctx, 10_000), status: `Searched lenders for “${query}”` }
}

async function getLender(ctx: Ctx, lenderId: string): Promise<Result> {
  const [{ data: l }, { data: subs }] = await Promise.all([
    ctx.supabase.from('lenders').select('*').eq('id', lenderId).maybeSingle(),
    ctx.supabase.from('deal_submissions').select('status, sent_on, last_activity_at, deals(company_name)').eq('lender_id', lenderId),
  ])
  if (!l) return { content: 'No lender with that id.', status: 'Lender not found', isError: true }
  const name = (d: unknown) => ((Array.isArray(d) ? d[0] : d) as { company_name?: string } | null)?.company_name ?? '?'
  const text = [
    `${l.name} — ${l.lending_type ?? '—'} (${l.status})`,
    `Size: ${[money(l.min_loan_amount), money(l.max_loan_amount)].filter(Boolean).join('–') || 'n/a'} | Min revenue ${money(l.min_revenue) ?? 'n/a'} | Min EBITDA ${money(l.min_ebitda) ?? 'n/a'}`,
    `Assets: ${(l.asset_types ?? []).join(', ') || '—'} | Industries: ${(l.industries ?? []).join(', ') || '—'} | Geographies: ${(l.geographies ?? []).join(', ') || '—'}`,
    `Contact: ${[l.contact_name, l.contact_email, l.contact_phone].filter(Boolean).join(', ') || '—'} | Website: ${l.website ?? '—'}`,
    l.mandate_notes ? `Mandate notes: ${l.mandate_notes}` : null,
    `Deals sent to them:\n${(subs ?? []).map((s) => `- ${name(s.deals)}: ${s.status} (sent ${s.sent_on ?? '—'}, last activity ${String(s.last_activity_at ?? '').slice(0, 10)})`).join('\n') || 'None.'}`,
  ]
    .filter(Boolean)
    .join('\n')
  return { content: clip(text, ctx, 10_000), status: `Opened ${l.name}` }
}

// Runs one tool call. Never throws — errors come back as an error result.
export async function runChatTool(ctx: Ctx, block: Anthropic.Beta.BetaToolUseBlock): Promise<Result> {
  try {
    switch (block.name) {
      case 'search_documents': {
        const i = SearchInput.parse(block.input)
        return await searchDocuments(ctx, i.query, i.deal_id)
      }
      case 'read_pages': {
        const i = ReadInput.parse(block.input)
        return await readPages(ctx, i.document_id, i.pages, i.as_images)
      }
      case 'find_deals': {
        const i = FindDealsInput.parse(block.input)
        return await findDeals(ctx, i.query, i.include_closed)
      }
      case 'get_deal':
        return await getDeal(ctx, IdInput('deal_id').parse(block.input).deal_id as string)
      case 'find_lenders':
        return await findLenders(ctx, FindLendersInput.parse(block.input).query)
      case 'get_lender':
        return await getLender(ctx, IdInput('lender_id').parse(block.input).lender_id as string)
      default:
        return { content: `Unknown tool ${block.name}`, status: 'Unknown tool', isError: true }
    }
  } catch (err) {
    const msg = err instanceof z.ZodError ? 'Invalid input — check the parameters and try again.' : err instanceof Error ? err.message : 'Tool failed'
    return { content: msg, status: `${block.name} failed`, isError: true }
  }
}
