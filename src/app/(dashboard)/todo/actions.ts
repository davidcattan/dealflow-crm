'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isTeamMember } from '@/lib/team'
import { DEAL_STATUSES, type DealStatus } from '@/lib/types'

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

// "Mark as dead" from a To do row. Returns the old status so Undo can put
// it back.
export async function markDealDead(dealId: string) {
  const supabase = await createClient()
  const { data } = await supabase.from('deals').select('status').eq('id', dealId).single()
  const { error } = await supabase.from('deals').update({ status: 'dead' }).eq('id', dealId)
  if (error) return { error: error.message }
  revalidatePath('/todo')
  revalidatePath('/pipeline')
  revalidatePath('/deals')
  return { ok: true, prev: (data?.status as DealStatus | undefined) ?? 'new' }
}

export async function restoreDealStatus(dealId: string, status: DealStatus) {
  if (!DEAL_STATUSES.includes(status)) return
  const supabase = await createClient()
  await supabase.from('deals').update({ status }).eq('id', dealId)
  revalidatePath('/todo')
  revalidatePath('/pipeline')
  revalidatePath('/deals')
}
