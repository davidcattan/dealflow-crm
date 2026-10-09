import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/usage'
import { notify } from '@/lib/notifications'
import { formatCompactCurrency } from '@/lib/format'
import {
  LENDING_TYPE_CATEGORIES,
  ASSET_TYPE_CATEGORIES,
  INDUSTRY_CATEGORIES,
  GEOGRAPHY_CATEGORIES,
} from '@/lib/lenders/categories'
import { LenderCallNotesSchema, type LenderCallNotes } from './schema'
import type { CallSuggestion } from './process'

// Calls filed on a lender instead of a deal — mostly intro calls where a
// new lender explains what they do. The notes suggest updates to the
// lender's profile (loan sizes, types, regions, contacts) so the CRM can
// match them to the right deals; nothing changes until someone ticks it.

const MODEL = 'claude-opus-5-5'
const MONEY_FIELDS = ['min_loan_amount', 'max_loan_amount', 'min_revenue', 'min_ebitda'] as const
const LIST_OPTIONS: Record<string, readonly string[]> = {
  asset_types: ASSET_TYPE_CATEGORIES,
  industries: INDUSTRY_CATEGORIES,
  geographies: GEOGRAPHY_CATEGORIES,
}
const FIELD_LABELS: Record<string, string> = {
  min_loan_amount: 'Min loan',
  max_loan_amount: 'Max loan',
  min_revenue: 'Min revenue',
  min_ebitda: 'Min EBITDA',
  lending_type: 'Lending type',
  asset_types: 'Asset types',
  industries: 'Industries',
  geographies: 'Regions',
  website: 'Website',
}

export async function summarizeLenderCall(supabase: SupabaseClient, callId: string, lenderId: string, transcript: string) {
  const [{ data: lender }, { data: contacts }] = await Promise.all([
    supabase.from('lenders').select('*').eq('id', lenderId).single(),
    supabase.from('lender_contacts').select('name, title, email, phone').eq('lender_id', lenderId),
  ])
  if (!lender) throw new Error('Lender not found')
  const money = (n: number | null) => (n === null ? '—' : formatCompactCurrency(n))

  const profile = [
    `LENDER: ${lender.name}`,
    `Lending type: ${lender.lending_type ?? '—'} | Loan size: ${money(lender.min_loan_amount)} – ${money(lender.max_loan_amount)}`,
    `Min revenue: ${money(lender.min_revenue)} | Min EBITDA: ${money(lender.min_ebitda)}`,
    `Asset types: ${lender.asset_types?.join(', ') || 'any'} | Industries: ${lender.industries?.join(', ') || 'any'} | Regions: ${lender.geographies?.join(', ') || 'nationwide'}`,
    lender.mandate_notes ? `Mandate notes: ${lender.mandate_notes}` : null,
    `Contacts on file: ${(contacts ?? []).map((c) => [c.name, c.title, c.email].filter(Boolean).join(' / ')).join('; ') || 'none'}`,
  ]
    .filter(Boolean)
    .join('\n')

  const prompt = `You are the note-taker for JED Capital Group, a commercial loan brokerage (David and Eli Cattan). Below is the transcript of a call one of them recorded on speaker with this lender — often an intro call where the lender explains what they lend on. Speakers are labeled A, B, C…; work out who is the broker and who is the lender.

CURRENT LENDER PROFILE IN THE CRM:
${profile}

TRANSCRIPT:
${transcript.slice(0, 120_000)}

Write the call notes. Stick to what was actually said — never invent numbers, names or criteria; leave out anything the audio was unclear on. Only suggest profile changes that differ from what's already on file.
Allowed values — lending_type (one of): ${LENDING_TYPE_CATEGORIES.join(', ')}
asset_types: ${ASSET_TYPE_CATEGORIES.join(', ')}
industries: ${INDUSTRY_CATEGORIES.join(', ')}
geographies: ${GEOGRAPHY_CATEGORIES.join(', ')}, or Nationwide`

  const response = await new Anthropic().messages.parse({
    model: MODEL,
    max_tokens: 6000,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(LenderCallNotesSchema) },
  })
  await logUsage({ feature: 'call-notes', model: MODEL, usage: response.usage, supabase })
  const notes = response.parsed_output
  if (!notes) throw new Error('Couldn’t write the call notes')

  await supabase.from('deal_calls').update({ status: 'done', result: notes, updated_at: new Date().toISOString() }).eq('id', callId)
  await notify(supabase, { kind: 'deal_update', title: `Call notes ready: ${lender.name}`, body: notes.title, lenderId })
}

function moneyLabel(value: string) {
  const n = Number(value.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? formatCompactCurrency(n) : value
}

export function lenderCallSuggestions(notes: LenderCallNotes): CallSuggestion[] {
  const out: CallSuggestion[] = []
  notes.lender_changes.forEach((c, i) => {
    const label =
      c.field === 'add_to_mandate_notes'
        ? `Add to mandate notes: ${c.value}`
        : `${FIELD_LABELS[c.field]} → ${(MONEY_FIELDS as readonly string[]).includes(c.field) ? moneyLabel(c.value) : c.value}`
    out.push({ key: `lender:${i}`, label, detail: c.why })
  })
  notes.new_contacts.forEach((c, i) => {
    out.push({
      key: `contact:${i}`,
      label: `Add contact: ${[c.name, c.title].filter(Boolean).join(', ')}`,
      detail: [c.email, c.phone].filter(Boolean).join(' · ') || undefined,
    })
  })
  return out
}

export async function applyLenderCallSuggestions(
  supabase: SupabaseClient,
  call: { id: string; lender_id: string; result: unknown; applied: unknown; created_at: string },
  keys: string[]
) {
  const notes = call.result as LenderCallNotes
  const already = new Set((call.applied as string[]) ?? [])
  const lenderId = call.lender_id
  const { data: lender } = await supabase.from('lenders').select('*').eq('id', lenderId).single()
  if (!lender) throw new Error('Lender not found')
  const day = String(call.created_at).slice(0, 10)
  let applied = 0

  for (const key of keys) {
    if (already.has(key)) continue
    const [kind, index] = key.split(':')
    if (kind === 'lender') {
      const c = notes.lender_changes[Number(index)]
      if (!c) continue
      let update: Record<string, unknown> | null = null
      if ((MONEY_FIELDS as readonly string[]).includes(c.field)) {
        const n = Math.round(Number(c.value.replace(/[^0-9.]/g, '')))
        if (Number.isFinite(n) && n >= 0) update = { [c.field]: n }
      } else if (c.field === 'lending_type') {
        if ((LENDING_TYPE_CATEGORIES as readonly string[]).includes(c.value)) update = { lending_type: c.value }
      } else if (c.field in LIST_OPTIONS) {
        const wanted = c.value.split(',').map((v) => v.trim())
        // "Nationwide" = no regional restriction (an empty list).
        if (c.field === 'geographies' && wanted.some((v) => /nationwide/i.test(v))) update = { geographies: [] }
        else {
          const valid = wanted.filter((v) => LIST_OPTIONS[c.field].includes(v))
          if (valid.length) update = { [c.field]: valid }
        }
      } else if (c.field === 'website') {
        update = { website: c.value }
      } else if (c.field === 'add_to_mandate_notes') {
        const line = `${day} (call): ${c.value}`
        update = { mandate_notes: lender.mandate_notes ? `${lender.mandate_notes}\n${line}` : line }
        lender.mandate_notes = update.mandate_notes
      }
      if (!update) continue
      await supabase.from('lenders').update(update).eq('id', lenderId)
    } else if (kind === 'contact') {
      const c = notes.new_contacts[Number(index)]
      if (!c) continue
      await supabase.from('lender_contacts').insert({
        lender_id: lenderId,
        name: c.name,
        title: c.title,
        email: c.email?.toLowerCase() ?? null,
        phone: c.phone,
      })
    } else continue
    already.add(key)
    applied++
  }

  await supabase.from('deal_calls').update({ applied: [...already], updated_at: new Date().toISOString() }).eq('id', call.id)
  return { applied, missing: [] as string[] }
}
