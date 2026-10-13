'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

const MIGRATION = 'Run migration 042_deal_contacts.sql in Supabase first.'
export type ContactInput = { name: string; title?: string | null; email?: string | null; phone?: string | null; notes?: string | null }

const clean = (c: ContactInput) => ({
  name: c.name.trim(),
  title: c.title?.trim() || null,
  email: c.email?.trim().toLowerCase() || null,
  phone: c.phone?.trim() || null,
  notes: c.notes?.trim() || null,
})
const bad = (c: ContactInput) =>
  !c.name.trim() ? 'Enter a name.' : c.email?.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim()) ? 'That email doesn’t look right.' : null

export async function addDealContact(dealId: string, input: ContactInput) {
  const err = bad(input)
  if (err) return { error: err }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { error } = await supabase.from('deal_contacts').insert({ deal_id: dealId, ...clean(input), created_by: user?.id ?? null })
  if (error) return { error: error.message.includes('deal_contacts') ? MIGRATION : error.message }
  revalidatePath(`/deals/${dealId}`)
  return { ok: true }
}

export async function updateDealContact(dealId: string, contactId: string, input: ContactInput) {
  const err = bad(input)
  if (err) return { error: err }
  const supabase = await createClient()
  const { error } = await supabase.from('deal_contacts').update(clean(input)).eq('id', contactId).eq('deal_id', dealId)
  if (error) return { error: error.message }
  revalidatePath(`/deals/${dealId}`)
  return { ok: true }
}

export async function removeDealContact(dealId: string, contactId: string) {
  const supabase = await createClient()
  await supabase.from('deal_contacts').delete().eq('id', contactId).eq('deal_id', dealId)
  revalidatePath(`/deals/${dealId}`)
  return { ok: true }
}

// Make this person the deal's main contact; the old main contact moves
// into the list (so nobody is lost).
export async function makeMainContact(dealId: string, contactId: string) {
  const supabase = await createClient()
  const [{ data: deal }, { data: c }] = await Promise.all([
    supabase.from('deals').select('contact_name, contact_email, contact_phone').eq('id', dealId).single(),
    supabase.from('deal_contacts').select('*').eq('id', contactId).eq('deal_id', dealId).single(),
  ])
  if (!deal || !c) return { error: 'Contact not found' }
  if (deal.contact_name || deal.contact_email || deal.contact_phone) {
    await supabase.from('deal_contacts').insert({
      deal_id: dealId,
      name: deal.contact_name || deal.contact_email || 'Previous contact',
      email: deal.contact_email,
      phone: deal.contact_phone,
    })
  }
  await supabase.from('deals').update({ contact_name: c.name, contact_email: c.email, contact_phone: c.phone }).eq('id', dealId)
  await supabase.from('deal_contacts').delete().eq('id', contactId)
  revalidatePath(`/deals/${dealId}`)
  return { ok: true }
}
