'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isTeamMember } from '@/lib/team'

export async function addTodo(input: { text: string; assignee: string; dealId: string | null; dueDate: string | null }) {
  const text = input.text.trim()
  if (!text) return { error: 'Write what needs doing.' }
  if (!isTeamMember(input.assignee)) return { error: 'Pick who it’s for.' }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { error } = await supabase.from('todos').insert({
    text,
    assignee: input.assignee,
    deal_id: input.dealId || null,
    due_date: input.dueDate || null,
    created_by: user?.id ?? null,
  })
  if (error) return { error: error.message.includes('todos') ? 'Run the 037 SQL in Supabase first.' : error.message }
  revalidatePath('/todo')
  if (input.dealId) revalidatePath(`/deals/${input.dealId}`)
  return { ok: true }
}

export async function setTodoDone(id: string, done: boolean) {
  const supabase = await createClient()
  await supabase.from('todos').update({ done_at: done ? new Date().toISOString() : null }).eq('id', id)
  revalidatePath('/todo')
}

export async function deleteTodo(id: string) {
  const supabase = await createClient()
  await supabase.from('todos').delete().eq('id', id)
  revalidatePath('/todo')
}

// Whose deal it is — 'David', 'Eli', or null for both.
export async function setDealOwner(dealId: string, owner: string | null) {
  if (owner !== null && !isTeamMember(owner)) return { error: 'Unknown person.' }
  const supabase = await createClient()
  const { error } = await supabase.from('deals').update({ owner }).eq('id', dealId)
  if (error) return { error: error.message.includes('owner') ? 'Run the 037 SQL in Supabase first.' : error.message }
  revalidatePath('/todo')
  revalidatePath(`/deals/${dealId}`)
  return { ok: true }
}

// Hide a deal's current next step until something new happens on the deal.
export async function dismissStep(dealId: string, text: string | null) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('deals')
    .update({ step_dismissed: text, step_dismissed_at: text ? new Date().toISOString() : null })
    .eq('id', dealId)
  if (error) return { error: error.message.includes('step_dismissed') ? 'Run migration 045_step_dismiss.sql in Supabase first.' : error.message }
  revalidatePath('/todo')
  return { ok: true }
}

// Lender follow-ups: log that we nudged a lender some other way (a call, a
// text), which restarts its 3-day clock, or stop reminding about it.
export async function logLenderFollowUp(dealId: string, lenderId: string, lenderName: string, how: 'followed_up' | 'stop') {
  const { FOLLOWED_UP_NOTE, STOP_NOTE, etDate } = await import('@/lib/deals/follow-ups')
  const supabase = await createClient()
  const note =
    how === 'stop'
      ? `${STOP_NOTE} for ${lenderName} (no answer).`
      : `${FOLLOWED_UP_NOTE} ${lenderName} (call or message).`
  const { error } = await supabase
    .from('deal_updates')
    .insert({ deal_id: dealId, lender_id: lenderId, entry_date: etDate(new Date()), note, source: 'manual' })
  if (error) return { error: error.message }
  if (how === 'followed_up') {
    await supabase
      .from('deal_submissions')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('deal_id', dealId)
      .eq('lender_id', lenderId)
  }
  revalidatePath('/todo')
  revalidatePath(`/deals/${dealId}`)
  return { ok: true }
}
