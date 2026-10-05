'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { toArray } from '@/lib/form-utils'
import { parseCompactCurrency } from '@/lib/format'

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? '').trim()
  return str.length > 0 ? str : null
}

export async function updateLender(formData: FormData) {
  const id = String(formData.get('lender_id') ?? '')
  if (!id) return

  const status = String(formData.get('status') ?? 'active')
  const caresAboutProfit = String(formData.get('cares_about_profit') ?? '')
  const supabase = await createClient()

  await supabase
    .from('lenders')
    .update({
      name: String(formData.get('name') ?? '').trim(),
      contact_name: emptyToNull(formData.get('contact_name')),
      contact_email: emptyToNull(formData.get('contact_email')),
      contact_phone: emptyToNull(formData.get('contact_phone')),
      website: emptyToNull(formData.get('website')),
      lending_type: emptyToNull(formData.get('lending_type')),
      cares_about_profit:
        caresAboutProfit === 'yes' ? true : caresAboutProfit === 'no' ? false : null,
      min_loan_amount: parseCompactCurrency(formData.get('min_loan_amount')),
      max_loan_amount: parseCompactCurrency(formData.get('max_loan_amount')),
      min_revenue: parseCompactCurrency(formData.get('min_revenue')),
      min_ebitda: parseCompactCurrency(formData.get('min_ebitda')),
      asset_types: toArray(formData.get('asset_types')),
      industries: toArray(formData.get('industries')),
      geographies: toArray(formData.get('geographies')),
      mandate_notes: emptyToNull(formData.get('mandate_notes')),
      status: status === 'inactive' ? 'inactive' : 'active',
    })
    .eq('id', id)

  revalidatePath(`/lenders/${id}`)
  revalidatePath('/lenders')
}

export async function deleteLender(formData: FormData) {
  const id = String(formData.get('lender_id') ?? '')
  if (!id) return

  const supabase = await createClient()
  await supabase.from('lenders').delete().eq('id', id)

  revalidatePath('/lenders')
  redirect('/lenders')
}

type ContactInput = { name: string; title: string; email: string; phone: string; cc: boolean }

function clean(c: ContactInput) {
  const t = (v: string) => v.trim() || null
  return { name: t(c.name), title: t(c.title), email: t(c.email)?.toLowerCase() ?? null, phone: t(c.phone), cc_on_emails: c.cc }
}

// The lender's main contact lives on the lender row (used as "To" on
// submission emails); extra contacts live in lender_contacts.
export async function addLenderContact(lenderId: string, input: ContactInput) {
  const c = clean(input)
  if (!lenderId || (!c.email && !c.phone && !c.name)) return { error: 'Add at least a name, email or phone.' }
  const supabase = await createClient()
  const { data: lender } = await supabase.from('lenders').select('contact_email, contact_phone, contact_name').eq('id', lenderId).single()
  // First contact on a lender with none becomes the primary.
  if (lender && !lender.contact_email && !lender.contact_phone && !lender.contact_name) {
    await supabase.from('lenders').update({ contact_name: c.name, contact_email: c.email, contact_phone: c.phone }).eq('id', lenderId)
  }
  await supabase.from('lender_contacts').insert({ lender_id: lenderId, ...c })
  revalidatePath(`/lenders/${lenderId}`)
  return { ok: true }
}

export async function updateLenderContact(lenderId: string, contactId: string, input: ContactInput) {
  const c = clean(input)
  const supabase = await createClient()
  if (contactId === 'primary') {
    await supabase.from('lenders').update({ contact_name: c.name, contact_email: c.email, contact_phone: c.phone }).eq('id', lenderId)
  } else {
    const { data: before } = await supabase.from('lender_contacts').select('email').eq('id', contactId).single()
    await supabase.from('lender_contacts').update(c).eq('id', contactId)
    // Keep the lender's primary in step if this contact is the primary.
    const { data: lender } = await supabase.from('lenders').select('contact_email').eq('id', lenderId).single()
    if (before?.email && lender?.contact_email && before.email.toLowerCase() === lender.contact_email.toLowerCase()) {
      await supabase.from('lenders').update({ contact_name: c.name, contact_email: c.email, contact_phone: c.phone }).eq('id', lenderId)
    }
  }
  revalidatePath(`/lenders/${lenderId}`)
  return { ok: true }
}

export async function deleteLenderContact(lenderId: string, contactId: string) {
  const supabase = await createClient()
  const { data: lender } = await supabase.from('lenders').select('contact_email').eq('id', lenderId).single()
  let wasPrimary = contactId === 'primary'
  if (contactId !== 'primary') {
    const { data: row } = await supabase.from('lender_contacts').select('email').eq('id', contactId).single()
    wasPrimary = Boolean(row?.email && lender?.contact_email && row.email.toLowerCase() === lender.contact_email.toLowerCase())
    await supabase.from('lender_contacts').delete().eq('id', contactId)
  }
  if (wasPrimary) {
    // Promote the next contact with an email, or clear the primary.
    const { data: next } = await supabase
      .from('lender_contacts')
      .select('name, email, phone')
      .eq('lender_id', lenderId)
      .not('email', 'is', null)
      .order('created_at')
      .limit(1)
      .maybeSingle()
    await supabase
      .from('lenders')
      .update({ contact_name: next?.name ?? null, contact_email: next?.email ?? null, contact_phone: next?.phone ?? null })
      .eq('id', lenderId)
  }
  revalidatePath(`/lenders/${lenderId}`)
}

export async function makePrimaryContact(lenderId: string, contactId: string) {
  const supabase = await createClient()
  const [{ data: lender }, { data: row }] = await Promise.all([
    supabase.from('lenders').select('contact_name, contact_email, contact_phone').eq('id', lenderId).single(),
    supabase.from('lender_contacts').select('*').eq('id', contactId).single(),
  ])
  if (!lender || !row) return
  // Keep the old primary as a regular contact if it isn't one already.
  if (lender.contact_email || lender.contact_phone) {
    const { data: dup } = lender.contact_email
      ? await supabase.from('lender_contacts').select('id').eq('lender_id', lenderId).ilike('email', lender.contact_email).maybeSingle()
      : { data: null }
    if (!dup) {
      await supabase.from('lender_contacts').insert({
        lender_id: lenderId,
        name: lender.contact_name,
        email: lender.contact_email,
        phone: lender.contact_phone,
      })
    }
  }
  await supabase.from('lenders').update({ contact_name: row.name, contact_email: row.email, contact_phone: row.phone }).eq('id', lenderId)
  // The primary is the "To" — no need to also CC them.
  await supabase.from('lender_contacts').update({ cc_on_emails: false }).eq('id', contactId)
  revalidatePath(`/lenders/${lenderId}`)
}

export async function setContactCc(lenderId: string, contactId: string, cc: boolean) {
  const supabase = await createClient()
  await supabase.from('lender_contacts').update({ cc_on_emails: cc }).eq('id', contactId)
  revalidatePath(`/lenders/${lenderId}`)
}
