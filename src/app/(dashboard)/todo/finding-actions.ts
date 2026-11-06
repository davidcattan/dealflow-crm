'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { Person } from '@/lib/inbox/findings'

const close = (status: 'added' | 'dismissed') => ({ status, resolved_at: new Date().toISOString() })

export async function dismissEmailFinding(id: string): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient()
  const { error } = await supabase.from('email_findings').update(close('dismissed')).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/todo')
  return { ok: true }
}

// New lender / new contact: saved to the CRM. Requests, follow-ups and
// possible deals just come off the list.
export async function addEmailFinding(id: string): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: f, error: readError } = await supabase.from('email_findings').select('*').eq('id', id).maybeSingle()
  if (readError || !f) return { error: readError?.message ?? 'That item is gone.' }
  const people = (f.people ?? []) as Person[]

  let lenderId = f.lender_id as string | null
  if (f.kind === 'new_lender') {
    const firm = String(f.firm ?? '').trim()
    if (!firm) return { error: 'No firm name on this one.' }
    // Someone may have added it since: never make a second record.
    const { data: same } = await supabase.from('lenders').select('id').ilike('name', firm.replace(/[\\%_]/g, '\\$&')).limit(1)
    lenderId = same?.[0]?.id ?? null
    if (!lenderId) {
      const first = people[0]
      const { data: created, error } = await supabase
        .from('lenders')
        .insert({
          name: firm,
          status: 'active',
          is_lender: true,
          contact_name: first?.name ?? null,
          contact_email: first?.email ?? null,
          contact_phone: first?.phone ?? null,
          mandate_notes: `[${new Date().toISOString().slice(0, 10)} from email] ${f.detail ?? ''}`.trim(),
          created_by: user?.id ?? null,
        })
        .select('id')
        .single()
      if (error) return { error: error.message }
      lenderId = created.id as string
    }
  }

  if ((f.kind === 'new_lender' || f.kind === 'new_contact') && lenderId) {
    const { data: existing } = await supabase.from('lender_contacts').select('name, email').eq('lender_id', lenderId)
    const known = new Set((existing ?? []).flatMap((c) => [c.name?.toLowerCase(), c.email?.toLowerCase()]).filter(Boolean))
    const fresh = people.filter((p) => !known.has(p.name.toLowerCase()) && !(p.email && known.has(p.email.toLowerCase())))
    if (fresh.length) {
      const { error } = await supabase
        .from('lender_contacts')
        .insert(fresh.map((p) => ({ lender_id: lenderId, name: p.name, title: p.title ?? null, email: p.email ?? null, phone: p.phone ?? null })))
      if (error) return { error: error.message }
    }
  }

  const { error } = await supabase.from('email_findings').update({ ...close('added'), lender_id: lenderId }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/todo')
  revalidatePath('/lenders')
  return { ok: true }
}
