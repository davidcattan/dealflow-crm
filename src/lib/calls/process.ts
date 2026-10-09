import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/usage'
import { notify } from '@/lib/notifications'
import { recordSubmission } from '@/lib/deals/submissions'
import { SUBMISSION_LABELS, type SubmissionStatus } from '@/lib/deals/submission-status'
import { LOAN_TYPE_CATEGORIES } from '@/lib/deals/categories'
import { CallNotesSchema, type CallNotes } from './schema'
import { summarizeLenderCall, applyLenderCallSuggestions } from './lender-call'

// Recorded calls: audio -> transcript (AssemblyAI, ~1¢/min) -> notes,
// next steps and suggested updates (Claude, a few cents). Suggested
// updates are only applied when someone ticks them.

export const ASSEMBLY = 'https://api.assemblyai.com/v2/transcript'
export const MODEL = 'claude-opus-5-5'

function assemblyKey() {
  const key = process.env.ASSEMBLYAI_API_KEY
  if (!key) throw new Error('Call transcription isn’t set up yet — add ASSEMBLYAI_API_KEY in Vercel.')
  return key
}

async function fail(supabase: SupabaseClient, callId: string, message: string) {
  await supabase.from('deal_calls').update({ status: 'error', error: message, updated_at: new Date().toISOString() }).eq('id', callId)
}

// Sends the uploaded audio off to be transcribed — one job per piece
// (a recording that was interrupted and continued has several).
export async function startTranscription(supabase: SupabaseClient, callId: string) {
  const { data: call } = await supabase.from('deal_calls').select('*').eq('id', callId).single()
  if (!call) throw new Error('Call not found')
  try {
    const paths = [call.storage_path as string, ...(((call.extra_paths as string[] | undefined) ?? []))]
    const jobIds: string[] = []
    for (const path of paths) {
      const { data: signed, error } = await supabase.storage.from('borrower-documents').createSignedUrl(path, 60 * 60 * 6)
      if (error || !signed) throw new Error('Couldn’t read the recording')
      const res = await fetch(ASSEMBLY, {
        method: 'POST',
        headers: { authorization: assemblyKey(), 'content-type': 'application/json' },
        body: JSON.stringify({ audio_url: signed.signedUrl, speaker_labels: true }),
      })
      const body = (await res.json()) as { id?: string; error?: string }
      if (!res.ok || !body.id) throw new Error(body.error ?? `Transcription service error (${res.status})`)
      jobIds.push(body.id)
    }
    await supabase
      .from('deal_calls')
      .update({
        status: 'transcribing',
        transcript_job_id: jobIds[0],
        ...(jobIds.length > 1 ? { transcript_job_ids: jobIds } : {}),
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', callId)
  } catch (err) {
    await fail(supabase, callId, err instanceof Error ? err.message : 'Couldn’t start transcription')
  }
}

type Transcript = {
  status?: string
  error?: string
  text?: string
  audio_duration?: number
  utterances?: { speaker: string; text: string }[] | null
}

// Moves a call along: checks the transcript, then writes the notes.
// Safe to call repeatedly (the page polls it while a call is processing).
export async function advanceCall(supabase: SupabaseClient, callId: string) {
  const { data: call } = await supabase.from('deal_calls').select('*').eq('id', callId).single()
  if (!call) throw new Error('Call not found')
  if (call.status === 'uploaded') return startTranscription(supabase, callId)
  // Notes-writing that died partway (e.g. a timeout): try it again.
  if (call.status === 'summarizing' && Date.now() - new Date(call.updated_at).getTime() > 6 * 60_000) {
    await supabase.from('deal_calls').update({ status: 'transcribing', updated_at: new Date().toISOString() }).eq('id', callId).eq('status', 'summarizing')
    call.status = 'transcribing'
  }
  if (call.status !== 'transcribing') return

  const jobIds = ((call.transcript_job_ids as string[] | undefined) ?? []).length
    ? (call.transcript_job_ids as string[])
    : [call.transcript_job_id as string]
  const parts: Transcript[] = []
  for (const jobId of jobIds) {
    const res = await fetch(`${ASSEMBLY}/${jobId}`, { headers: { authorization: assemblyKey() } })
    parts.push((await res.json()) as Transcript)
  }
  const failed = parts.find((p) => p.status === 'error')
  if (failed) return fail(supabase, callId, failed.error ?? 'Transcription failed')
  if (parts.some((p) => p.status !== 'completed')) return

  // Pieces of a continued recording are joined in order.
  const transcript = parts
    .map((body) =>
      body.utterances?.length ? body.utterances.map((u) => `Speaker ${u.speaker}: ${u.text}`).join('\n') : (body.text ?? '')
    )
    .filter((t) => t.trim())
    .join('\n\n[Recording paused here and continued — speaker letters may change after this point]\n\n')
  const audioSeconds = parts.reduce((n, p) => n + (p.audio_duration ?? 0), 0)
  // Claim the summarizing step so two polls can't both run it.
  const { data: claimed } = await supabase
    .from('deal_calls')
    .update({
      status: 'summarizing',
      transcript,
      duration_seconds: call.duration_seconds ?? (audioSeconds ? Math.round(audioSeconds) : null),
      updated_at: new Date().toISOString(),
    })
    .eq('id', callId)
    .eq('status', 'transcribing')
    .select('id')
  if (!claimed?.length) return
  if (!transcript.trim()) return fail(supabase, callId, 'No speech was picked up. Was the call on speaker?')

  try {
    // A call filed on a lender (e.g. an intro call) rather than a deal.
    if (!call.deal_id) return await summarizeLenderCall(supabase, call.id, call.lender_id, transcript)
    await summarizeCall(supabase, call.id, call.deal_id, transcript, {
      callWith: call.call_with ?? null,
      lenderId: call.lender_id ?? null,
    })
  } catch (err) {
    await fail(supabase, callId, err instanceof Error ? err.message : 'Couldn’t write the call notes')
  }
}

async function summarizeCall(
  supabase: SupabaseClient,
  callId: string,
  dealId: string,
  transcript: string,
  who: { callWith: string | null; lenderId: string | null }
) {
  const [{ data: deal }, { data: subs }, { data: updates }, { data: lender }] = await Promise.all([
    supabase.from('deals').select('company_name, contact_name, loan_type, deal_type, notes, status').eq('id', dealId).single(),
    supabase.from('deal_submissions').select('status, lenders(name)').eq('deal_id', dealId),
    supabase.from('deal_updates').select('entry_date, note').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(10),
    who.lenderId ? supabase.from('lenders').select('name').eq('id', who.lenderId).maybeSingle() : Promise.resolve({ data: null }),
  ])
  if (!deal) throw new Error('Deal not found')
  const lenderName = (l: unknown) => ((Array.isArray(l) ? l[0] : l) as { name?: string } | null)?.name ?? '?'

  const context = [
    `DEAL: ${deal.company_name}`,
    `Borrower contact: ${deal.contact_name ?? '—'} | Loan type: ${deal.loan_type ?? '—'} | Ask: ${deal.deal_type ?? '—'}`,
    deal.notes ? `Notes: ${deal.notes}` : null,
    `Lenders this deal was sent to: ${
      (subs ?? []).map((s) => `${lenderName(s.lenders)} (${SUBMISSION_LABELS[s.status as SubmissionStatus] ?? s.status})`).join('; ') || 'none yet'
    }`,
    updates?.length ? `Recent updates:\n${updates.map((u) => `- ${u.entry_date ?? ''} ${u.note}`).join('\n')}` : null,
    who.callWith === 'borrower'
      ? `\nTHE BROKER SAYS THIS CALL WAS WITH: the borrower (${deal.contact_name ?? deal.company_name}).`
      : who.callWith === 'lender'
        ? `\nTHE BROKER SAYS THIS CALL WAS WITH: the lender "${lender?.name ?? 'unknown'}" — use exactly that name in lender_updates.`
        : who.callWith === 'broker'
          ? '\nTHE BROKER SAYS THIS CALL WAS WITH: the referral partner / broker who sent the deal.'
          : null,
  ]
    .filter(Boolean)
    .join('\n')

  const prompt = `You are the note-taker for JED Capital Group, a commercial loan brokerage (David and Eli Cattan). Below is the transcript of a phone/Teams/Zoom call one of them recorded on speaker about this deal. Speakers are labeled A, B, C… — work out from context who is the broker, the borrower and any lender.

${context}

TRANSCRIPT:
${transcript.slice(0, 120_000)}

Write the call notes. Stick to what was actually said — never invent numbers, names or commitments. If the audio was unclear on something, leave it out rather than guess. Loan type changes must be one of: ${LOAN_TYPE_CATEGORIES.join(', ')}.`

  const client = new Anthropic()
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 6000,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(CallNotesSchema) },
  })
  await logUsage({ feature: 'call-notes', model: MODEL, dealId, usage: response.usage, supabase })
  const notes = response.parsed_output
  if (!notes) throw new Error('Couldn’t write the call notes')

  await supabase.from('deal_calls').update({ status: 'done', result: notes, updated_at: new Date().toISOString() }).eq('id', callId)

  // The summary goes on the deal right away (nothing to approve there).
  const today = new Date().toISOString().slice(0, 10)
  await insertCallUpdate(supabase, callId, {
    deal_id: dealId,
    entry_date: today,
    note: summaryNote(notes),
    source: 'call',
  })
  await notify(supabase, {
    kind: 'deal_update',
    title: `Call notes ready: ${deal.company_name}`,
    body: notes.title,
    dealId,
  })
}

// An update a call adds to the deal, tagged with the call so deleting the
// call removes it (falls back to untagged before migration 033).
async function insertCallUpdate(supabase: SupabaseClient, callId: string, row: Record<string, unknown>) {
  const { error } = await supabase.from('deal_updates').insert({ ...row, call_id: callId })
  if (error) await supabase.from('deal_updates').insert(row)
}

// Removes a call, its audio, and the updates it added to the deal.
// Status / detail changes someone applied from it stay.
export async function deleteCall(supabase: SupabaseClient, callId: string) {
  const { data: call } = await supabase.from('deal_calls').select('*').eq('id', callId).single()
  if (!call) return
  const paths = [call.storage_path as string, ...(((call.extra_paths as string[] | undefined) ?? []))].filter(Boolean)
  if (paths.length) await supabase.storage.from('borrower-documents').remove(paths)

  // Updates from before they were tagged with the call: match by text.
  const notes = call.result as CallNotes | null
  if (call.deal_id && notes) {
    const { data: rows } = await supabase.from('deal_updates').select('id, note').eq('deal_id', call.deal_id).eq('source', 'call')
    const lenderNotes = (notes.lender_updates ?? []).map((u) => `On a call: ${u.note}`)
    const ids = (rows ?? [])
      .filter((r) => String(r.note).startsWith(`📞 ${notes.title}:`) || lenderNotes.some((n) => String(r.note).startsWith(n)))
      .map((r) => r.id as string)
    if (ids.length) await supabase.from('deal_updates').delete().in('id', ids)
  }
  // Tagged updates go with the call (on delete cascade).
  await supabase.from('deal_calls').delete().eq('id', callId)
}

export type CallNotesEdit = Pick<CallNotes, 'title' | 'summary' | 'key_points' | 'next_steps'>

function summaryNote(n: CallNotesEdit) {
  return [`📞 ${n.title}: ${n.summary}`, ...n.key_points.map((p) => `• ${p}`)].join('\n')
}

// Saves edits to a call's notes and keeps its summary in Updates matching.
export async function editCallNotes(supabase: SupabaseClient, callId: string, edit: CallNotesEdit) {
  const { data: call } = await supabase.from('deal_calls').select('*').eq('id', callId).single()
  if (!call?.result) throw new Error('These call notes aren’t ready yet')
  const before = call.result as CallNotes
  const clean: CallNotesEdit = {
    title: edit.title.trim() || before.title,
    summary: edit.summary.trim(),
    key_points: edit.key_points.map((p) => p.trim()).filter(Boolean),
    next_steps: edit.next_steps.map((x) => ({ ...x, text: x.text.trim() })).filter((x) => x.text),
  }
  await supabase
    .from('deal_calls')
    .update({ result: { ...before, ...clean }, updated_at: new Date().toISOString() })
    .eq('id', callId)

  if (call.deal_id) {
    // The summary update: tagged with the call, or (older) matched by title.
    const { data: rows } = await supabase.from('deal_updates').select('id, note, call_id').eq('deal_id', call.deal_id).eq('source', 'call')
    const row =
      (rows ?? []).find((r) => r.call_id === callId && String(r.note).startsWith('📞')) ??
      (rows ?? []).find((r) => String(r.note).startsWith(`📞 ${before.title}:`))
    if (row) await supabase.from('deal_updates').update({ note: summaryNote(clean) }).eq('id', row.id)
  }
  return call.deal_id ? `/deals/${call.deal_id}` : `/lenders/${call.lender_id}`
}

// Suggested updates as a flat list, each with a stable key.
export type CallSuggestion = { key: string; label: string; detail?: string }

export function callSuggestions(notes: CallNotes): CallSuggestion[] {
  const out: CallSuggestion[] = []
  notes.lender_updates.forEach((u, i) => {
    out.push({
      key: `lender:${i}`,
      label:
        u.status === 'no_change'
          ? `Log on ${u.lender_name}: ${u.note}`
          : `${u.lender_name} → ${SUBMISSION_LABELS[u.status]}`,
      detail: u.status === 'no_change' ? undefined : u.note,
    })
  })
  notes.deal_changes.forEach((c, i) => {
    const label =
      c.field === 'add_to_notes'
        ? `Add to deal notes: ${c.value}`
        : `${{ contact_name: 'Contact name', contact_email: 'Contact email', contact_phone: 'Contact phone', loan_type: 'Loan type' }[c.field]} → ${c.value}`
    out.push({ key: `deal:${i}`, label, detail: c.why })
  })
  return out
}

// Applies the ticked suggestions. Returns how many were applied, and any
// lender it couldn't find in the CRM.
export async function applyCallSuggestions(supabase: SupabaseClient, callId: string, keys: string[]) {
  const { data: call } = await supabase.from('deal_calls').select('*').eq('id', callId).single()
  if (!call?.result) throw new Error('These call notes aren’t ready yet')
  if (!call.deal_id) return applyLenderCallSuggestions(supabase, call, keys)
  const notes = call.result as CallNotes
  const already = new Set((call.applied as string[]) ?? [])
  const dealId = call.deal_id as string
  const day = String(call.created_at).slice(0, 10)
  let applied = 0
  const missing: string[] = []

  for (const key of keys) {
    if (already.has(key)) continue
    const [kind, index] = key.split(':')
    if (kind === 'lender') {
      const u = notes.lender_updates[Number(index)]
      if (!u) continue
      // The lender picked before recording, when it's the only one discussed.
      const picked = call.lender_id && notes.lender_updates.length === 1 ? (call.lender_id as string) : null
      const lenderId = picked ?? (await findLender(supabase, dealId, u.lender_name))
      if (!lenderId) {
        missing.push(u.lender_name)
        continue
      }
      if (u.status !== 'no_change') await recordSubmission(supabase, { dealId, lenderId, status: u.status, sentOn: day })
      await insertCallUpdate(supabase, callId, {
        deal_id: dealId,
        lender_id: lenderId,
        entry_date: day,
        note: `On a call: ${u.note}${u.status !== 'no_change' ? ` (status → ${SUBMISSION_LABELS[u.status]})` : ''}`,
        source: 'call',
      })
    } else if (kind === 'deal') {
      const c = notes.deal_changes[Number(index)]
      if (!c) continue
      if (c.field === 'add_to_notes') {
        const { data: deal } = await supabase.from('deals').select('notes').eq('id', dealId).single()
        const line = `${day}: ${c.value}`
        await supabase.from('deals').update({ notes: deal?.notes ? `${deal.notes}\n${line}` : line }).eq('id', dealId)
      } else if (c.field === 'loan_type') {
        if (!(LOAN_TYPE_CATEGORIES as readonly string[]).includes(c.value)) continue
        await supabase.from('deals').update({ loan_type: c.value }).eq('id', dealId)
      } else {
        await supabase.from('deals').update({ [c.field]: c.value }).eq('id', dealId)
      }
    } else continue
    already.add(key)
    applied++
  }

  await supabase.from('deal_calls').update({ applied: [...already], updated_at: new Date().toISOString() }).eq('id', callId)
  return { applied, missing }
}

// The lender named on the call: one on this deal first, then any in the CRM.
async function findLender(supabase: SupabaseClient, dealId: string, name: string) {
  const want = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
  if (!want) return null
  const core = want.split(' ')[0]
  const { data: subs } = await supabase.from('deal_submissions').select('lender_id, lenders(name)').eq('deal_id', dealId)
  for (const s of subs ?? []) {
    const n = (((Array.isArray(s.lenders) ? s.lenders[0] : s.lenders) as { name?: string } | null)?.name ?? '').toLowerCase()
    if (n && (n.includes(want) || want.includes(n) || n.split(' ')[0] === core)) return s.lender_id as string
  }
  const { data: rows } = await supabase.from('lenders').select('id, name').ilike('name', `%${want}%`).limit(2)
  if (rows?.length === 1) return rows[0].id as string
  const { data: loose } = await supabase.from('lenders').select('id, name').ilike('name', `${core}%`).limit(2)
  return loose?.length === 1 ? (loose[0].id as string) : null
}
