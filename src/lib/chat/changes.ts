import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordSubmission } from '@/lib/deals/submissions'
import { SUBMISSION_LABELS, SUBMISSION_STATUSES, type SubmissionStatus } from '@/lib/deals/submission-status'

// Changes Ask AI can PROPOSE. Nothing is written until a person clicks
// "Do it" on the card in the chat (Nov 23, 2026: David wants to talk to the
// CRM like he talks to Claude — "log that", "they're out", "too small for
// Dan" — and have it stick). Every change is plain database work, no AI.

export const CHANGE_KINDS = [
  'set_lender_status',
  'log_lender_touch',
  'add_lender_contact',
  'save_lender_fact',
  'add_lender_to_deal',
  'add_deal_note',
  'add_lender',
  'merge_lenders',
  'save_team_rule',
] as const

const id = z.string().uuid()
const text = z.string().trim().min(1).max(2000)
const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v) => v ?? null)

export const ChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set_lender_status'), summary: text, deal_id: id, lender_id: id, status: z.enum(SUBMISSION_STATUSES), note: opt(z.string()) }),
  z.object({
    kind: z.literal('log_lender_touch'),
    summary: text,
    lender_id: id,
    deal_id: opt(id),
    contact_name: opt(z.string()),
    channel: z.enum(['linkedin', 'call', 'email', 'text', 'meeting']),
    linkedin_status: opt(z.enum(['request_sent', 'connected', 'messaged', 'replied'])),
    note: text,
  }),
  z.object({
    kind: z.literal('add_lender_contact'),
    summary: text,
    lender_id: id,
    contact_name: text,
    title: opt(z.string()),
    email: opt(z.string()),
    phone: opt(z.string()),
    linkedin_url: opt(z.string()),
    note: opt(z.string()),
  }),
  z.object({
    kind: z.literal('save_lender_fact'),
    summary: text,
    lender_id: id,
    note: text,
    min_loan: opt(z.number().positive()),
    max_loan: opt(z.number().positive()),
    min_ebitda: opt(z.number().positive()),
  }),
  z.object({ kind: z.literal('add_lender_to_deal'), summary: text, deal_id: id, lender_id: id, status: opt(z.enum(SUBMISSION_STATUSES)), note: opt(z.string()) }),
  z.object({ kind: z.literal('add_deal_note'), summary: text, deal_id: id, note: text }),
  z.object({ kind: z.literal('add_lender'), summary: text, lender_name: text, lending_type: opt(z.string()), website: opt(z.string()), note: opt(z.string()) }),
  z.object({ kind: z.literal('merge_lenders'), summary: text, lender_id: id, other_lender_id: id }),
  z.object({ kind: z.literal('save_team_rule'), summary: text, note: text }),
])
export type Change = z.infer<typeof ChangeSchema>

// The model fills a flat object (every field present, unused ones null);
// keep only what this kind uses.
export function parseProposedChange(input: unknown): Change {
  const raw = Object.fromEntries(Object.entries((input ?? {}) as Record<string, unknown>).filter(([, v]) => v !== null && v !== ''))
  return ChangeSchema.parse(raw)
}

function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}
function shortDate() {
  const [, m, d] = today().split('-')
  return `${Number(m)}/${Number(d)}`
}

async function lenderName(supabase: SupabaseClient, lenderId: string) {
  const { data } = await supabase.from('lenders').select('name').eq('id', lenderId).maybeSingle()
  if (!data) throw new Error('That lender is no longer in the CRM.')
  return data.name as string
}

async function note(supabase: SupabaseClient, dealId: string, lenderId: string | null, body: string, userId: string | null) {
  await supabase.from('deal_updates').insert({ deal_id: dealId, lender_id: lenderId, entry_date: today(), note: body, source: 'manual', created_by: userId })
}

// Tables that point at a lender, for merging two lender records into one.
const LENDER_TABLES = ['lender_contacts', 'inbox_messages', 'deal_updates', 'notifications', 'email_findings', 'deal_calls', 'lender_documents', 'documents']

// Does the change. Returns a short line for the card ("Done: …").
export async function applyChange(supabase: SupabaseClient, change: Change, userId: string | null): Promise<string> {
  switch (change.kind) {
    case 'set_lender_status': {
      const name = await lenderName(supabase, change.lender_id)
      await recordSubmission(supabase, { dealId: change.deal_id, lenderId: change.lender_id, status: change.status })
      // Logged by hand, so the automatic status reader treats it as the team's word.
      await note(supabase, change.deal_id, change.lender_id, `Status changed to ${SUBMISSION_LABELS[change.status]}.${change.note ? ` ${change.note}` : ''}`, userId)
      return `${name} set to ${SUBMISSION_LABELS[change.status as SubmissionStatus]}`
    }
    case 'log_lender_touch': {
      const name = await lenderName(supabase, change.lender_id)
      let contactId: string | null = null
      let notes: string | null = null
      if (change.contact_name) {
        const { data: found } = await supabase
          .from('lender_contacts')
          .select('id, notes')
          .eq('lender_id', change.lender_id)
          .ilike('name', `%${change.contact_name.replace(/[%_]/g, ' ').trim()}%`)
          .limit(1)
          .maybeSingle()
        if (found) {
          contactId = found.id as string
          notes = found.notes as string | null
        } else {
          const { data: created } = await supabase.from('lender_contacts').insert({ lender_id: change.lender_id, name: change.contact_name }).select('id').single()
          contactId = (created?.id as string) ?? null
        }
      }
      if (contactId) {
        await supabase
          .from('lender_contacts')
          .update({
            last_touch: today(),
            notes: [notes, `${shortDate()}: ${change.note}`].filter(Boolean).join('\n'),
            ...(change.linkedin_status ? { linkedin_status: change.linkedin_status } : {}),
          })
          .eq('id', contactId)
      }
      if (change.deal_id) await note(supabase, change.deal_id, change.lender_id, `${change.contact_name ? `${change.contact_name} (${name})` : name}, ${change.channel}: ${change.note}`, userId)
      return `Logged on ${change.contact_name ?? name}`
    }
    case 'add_lender_contact': {
      const name = await lenderName(supabase, change.lender_id)
      const { error } = await supabase.from('lender_contacts').insert({
        lender_id: change.lender_id,
        name: change.contact_name,
        title: change.title,
        email: change.email,
        phone: change.phone,
        linkedin_url: change.linkedin_url,
        notes: change.note ? `${shortDate()}: ${change.note}` : null,
      })
      if (error) throw new Error(error.message)
      return `${change.contact_name} added to ${name}`
    }
    case 'save_lender_fact': {
      const { data: l } = await supabase.from('lenders').select('name, mandate_notes').eq('id', change.lender_id).maybeSingle()
      if (!l) throw new Error('That lender is no longer in the CRM.')
      const update: Record<string, unknown> = {
        mandate_notes: [l.mandate_notes, `[${today()} from the team] ${change.note}`].filter(Boolean).join('\n'),
      }
      if (change.min_loan) update.min_loan_amount = change.min_loan
      if (change.max_loan) update.max_loan_amount = change.max_loan
      if (change.min_ebitda) update.min_ebitda = change.min_ebitda
      await supabase.from('lenders').update(update).eq('id', change.lender_id)
      return `Saved on ${l.name}`
    }
    case 'add_lender_to_deal': {
      const name = await lenderName(supabase, change.lender_id)
      await recordSubmission(supabase, { dealId: change.deal_id, lenderId: change.lender_id, status: change.status ?? 'sent', sentOn: today() })
      await note(supabase, change.deal_id, change.lender_id, change.note ? `Sent to ${name}. ${change.note}` : `Deal sent to ${name}.`, userId)
      return `${name} added to "Lenders sent to"`
    }
    case 'add_deal_note': {
      await note(supabase, change.deal_id, null, change.note, userId)
      return 'Note added to the deal'
    }
    case 'add_lender': {
      const { data: existing } = await supabase.from('lenders').select('id').ilike('name', change.lender_name).maybeSingle()
      if (existing) throw new Error(`${change.lender_name} is already in the CRM.`)
      const { error } = await supabase.from('lenders').insert({
        name: change.lender_name,
        lending_type: change.lending_type,
        website: change.website,
        mandate_notes: change.note ? `[${today()} from the team] ${change.note}` : null,
        is_lender: true,
        status: 'active',
        created_by: userId,
      })
      if (error) throw new Error(error.message)
      return `${change.lender_name} added to lenders`
    }
    case 'merge_lenders': {
      // Keeps lender_id; moves everything from other_lender_id onto it.
      const [{ data: keep }, { data: other }] = await Promise.all([
        supabase.from('lenders').select('id, name, mandate_notes').eq('id', change.lender_id).maybeSingle(),
        supabase.from('lenders').select('id, name, mandate_notes').eq('id', change.other_lender_id).maybeSingle(),
      ])
      if (!keep || !other) throw new Error('One of those lenders is no longer in the CRM.')
      if (keep.id === other.id) throw new Error('That is the same lender.')
      // The same deal on both: the kept lender's row stays, the other's goes.
      for (const table of ['deal_submissions', 'deal_matches']) {
        const [{ data: mine }, { data: theirs }] = await Promise.all([
          supabase.from(table).select('id, deal_id').eq('lender_id', keep.id),
          supabase.from(table).select('id, deal_id').eq('lender_id', other.id),
        ])
        const myDeals = new Set((mine ?? []).map((r) => r.deal_id as string))
        const dupes = (theirs ?? []).filter((r) => myDeals.has(r.deal_id as string)).map((r) => r.id as string)
        if (dupes.length) await supabase.from(table).delete().in('id', dupes)
        await supabase.from(table).update({ lender_id: keep.id }).eq('lender_id', other.id)
      }
      for (const table of LENDER_TABLES) await supabase.from(table).update({ lender_id: keep.id }).eq('lender_id', other.id)
      await supabase
        .from('lenders')
        .update({ mandate_notes: [keep.mandate_notes, other.mandate_notes ? `[Merged from "${other.name}", ${today()}] ${other.mandate_notes}` : null].filter(Boolean).join('\n') })
        .eq('id', keep.id)
      const { error } = await supabase.from('lenders').delete().eq('id', other.id)
      if (error) throw new Error(`Moved everything to ${keep.name}, but couldn't remove ${other.name}: ${error.message}`)
      return `${other.name} merged into ${keep.name}`
    }
    case 'save_team_rule': {
      const { error } = await supabase.from('ai_team_rules').insert({ rule: change.note, created_by: userId })
      if (error) throw new Error('Run supabase/migrations/057_ai_team_rules.sql first.')
      return 'Saved — Ask AI will follow this from now on'
    }
  }
}

// What the team told Ask AI to always do (newest last), for its instructions.
export async function loadTeamRules(supabase: SupabaseClient) {
  const { data, error } = await supabase.from('ai_team_rules').select('rule').order('created_at').limit(100)
  if (error) return []
  return (data ?? []).map((r) => r.rule as string)
}
