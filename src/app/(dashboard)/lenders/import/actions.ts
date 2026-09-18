'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { parseLenderWorkbook, groupLenderRows } from '@/lib/lender-import'

export type ImportResult =
  | { created: number; updated: number; contactsAdded: number; error?: undefined }
  | { error: string }
  | undefined

export async function importLenders(
  _prevState: ImportResult,
  formData: FormData
): Promise<ImportResult> {
  const file = formData.get('file') as File | null
  if (!file || file.size === 0) {
    return { error: 'No file selected.' }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const rows = await parseLenderWorkbook(buffer)

  if (rows.length === 0) {
    return {
      error:
        'No rows found. Make sure row 1 has headers like Name, Company, Email, Type, Min Check Size, Minimum Revenue, Minimum EBITDA, Care About Profit?, Notes.',
    }
  }

  const groups = groupLenderRows(rows)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: existingLenders }, { data: existingContacts }] = await Promise.all([
    supabase.from('lenders').select('id, name'),
    supabase.from('lender_contacts').select('lender_id, email'),
  ])

  const lenderIdByName = new Map(
    (existingLenders ?? []).map((l) => [l.name.toLowerCase(), l.id as string])
  )
  const existingContactKeys = new Set(
    (existingContacts ?? [])
      .filter((c) => c.email)
      .map((c) => `${c.lender_id}:${(c.email ?? '').toLowerCase()}`)
  )

  let created = 0
  let updated = 0
  const newContacts: { lender_id: string; name: string | null; email: string | null }[] = []

  for (const group of groups) {
    const key = group.company.toLowerCase()
    const existingId = lenderIdByName.get(key)

    const payload = {
      name: group.company,
      lending_type: group.lendingType,
      min_loan_amount: group.minLoanAmount,
      min_revenue: group.minRevenue,
      min_ebitda: group.minEbitda,
      cares_about_profit: group.caresAboutProfit,
      mandate_notes: group.mandateNotes,
      contact_name: group.contacts[0]?.name ?? null,
      contact_email: group.contacts[0]?.email ?? null,
    }

    let lenderId: string | null = null

    if (existingId) {
      const { error } = await supabase.from('lenders').update(payload).eq('id', existingId)
      if (!error) {
        lenderId = existingId
        updated++
      }
    } else {
      const { data: inserted, error } = await supabase
        .from('lenders')
        .insert({ ...payload, created_by: user?.id ?? null })
        .select('id')
        .single()
      if (!error && inserted) {
        lenderId = inserted.id
        created++
      }
    }

    if (!lenderId) continue

    for (const contact of group.contacts) {
      if (!contact.name && !contact.email) continue
      const key = `${lenderId}:${(contact.email ?? '').toLowerCase()}`
      if (contact.email && existingContactKeys.has(key)) continue
      newContacts.push({ lender_id: lenderId, name: contact.name, email: contact.email })
    }
  }

  let contactsAdded = 0
  if (newContacts.length > 0) {
    const { data, error } = await supabase.from('lender_contacts').insert(newContacts).select('id')
    if (!error) contactsAdded = data?.length ?? 0
  }

  revalidatePath('/lenders')
  return { created, updated, contactsAdded }
}
