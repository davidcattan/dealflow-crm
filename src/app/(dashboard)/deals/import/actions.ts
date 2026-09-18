'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { parseDealWorkbook } from '@/lib/deal-import'

export type ImportResult =
  | { created: number; updatesAdded: number; error?: undefined }
  | { error: string }
  | undefined

export async function importDeals(
  _prevState: ImportResult,
  formData: FormData
): Promise<ImportResult> {
  const file = formData.get('file') as File | null
  if (!file || file.size === 0) {
    return { error: 'No file selected.' }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const parsedDeals = await parseDealWorkbook(buffer)

  if (parsedDeals.length === 0) {
    return {
      error:
        'No rows found. Make sure row 1 has headers like Rep Name, Date, Deal Name, Deal Activity, Contact Name, Email/Phone, Type, Update, Notes.',
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let created = 0
  const newUpdates: {
    deal_id: string
    entry_date: string | null
    note: string
    source: string
  }[] = []

  for (const deal of parsedDeals) {
    const payload: Record<string, unknown> = {
      company_name: deal.companyName,
      contact_name: deal.contactName,
      contact_email: deal.contactEmail,
      contact_phone: deal.contactPhone,
      deal_type: deal.dealType,
      rep_name: deal.repName,
      activity_score: deal.activityScore,
      notes: deal.notes,
      status: 'in_review',
      created_by: user?.id ?? null,
    }
    if (deal.createdAt) {
      payload.created_at = deal.createdAt
    }

    const { data: inserted, error } = await supabase
      .from('deals')
      .insert(payload)
      .select('id')
      .single()

    if (error || !inserted) continue
    created++

    for (const update of deal.updates) {
      newUpdates.push({
        deal_id: inserted.id,
        entry_date: update.entryDate,
        note: update.note,
        source: 'import',
      })
    }
  }

  let updatesAdded = 0
  if (newUpdates.length > 0) {
    const { data, error } = await supabase
      .from('deal_updates')
      .insert(newUpdates)
      .select('id')
    if (!error) updatesAdded = data?.length ?? 0
  }

  revalidatePath('/deals')
  revalidatePath('/pipeline')
  return { created, updatesAdded }
}
