'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { teamMemberOf } from '@/lib/team'
import { COMPANY_FIELDS, OWNER_FIELDS, type Owner, type Profile } from '@/lib/profile/schema'

type Stored = Profile & { read?: string[] }

const blank = () => ({ value: null, status: 'missing' as const, source: null, note: null })

async function load(dealId: string) {
  const supabase = await createClient()
  const [{ data }, { data: auth }] = await Promise.all([
    supabase.from('deals').select('borrower_profile').eq('id', dealId).maybeSingle(),
    supabase.auth.getUser(),
  ])
  const who = teamMemberOf(auth.user?.email) ?? 'us'
  return { supabase, profile: (data?.borrower_profile ?? null) as Stored | null, who }
}

async function save(supabase: Awaited<ReturnType<typeof createClient>>, dealId: string, profile: Stored) {
  const { error } = await supabase.from('deals').update({ borrower_profile: profile }).eq('id', dealId)
  if (error) return { error: error.message.includes('borrower_profile') ? 'Run migration 038_borrower_profile.sql in Supabase first.' : error.message }
  revalidatePath(`/deals/${dealId}`)
  return { ok: true }
}

// Typing a value in yourself makes it confirmed. owner = index, or null for
// the company. Never accepts anything shaped like an SSN.
export async function setProfileField(dealId: string, owner: number | null, key: string, value: string) {
  const v = value.trim()
  if (/\b\d{3}-?\d{2}-?\d{4}\b/.test(v) && owner !== null) return { error: 'Social Security numbers aren’t stored in the CRM.' }
  const { supabase, profile, who } = await load(dealId)
  const p: Stored = profile ?? { company: Object.fromEntries(COMPANY_FIELDS.map(([k]) => [k, blank()])) as Profile['company'], owners: [], related_entities: [], warnings: [] }
  const cell = v ? { value: v, status: 'confirmed' as const, source: `Entered by ${who}`, note: null } : blank()
  if (owner === null) {
    if (!COMPANY_FIELDS.some(([k]) => k === key)) return { error: 'Unknown field' }
    p.company = { ...p.company, [key]: cell }
  } else {
    if (!OWNER_FIELDS.some(([k]) => k === key) || !p.owners[owner]) return { error: 'Unknown field' }
    p.owners = p.owners.map((o, i) => (i === owner ? { ...o, [key]: cell } : o))
  }
  return save(supabase, dealId, p)
}

export async function addProfileOwner(dealId: string) {
  const { supabase, profile } = await load(dealId)
  const p: Stored = profile ?? { company: Object.fromEntries(COMPANY_FIELDS.map(([k]) => [k, blank()])) as Profile['company'], owners: [], related_entities: [], warnings: [] }
  p.owners = [...p.owners, Object.fromEntries(OWNER_FIELDS.map(([k]) => [k, blank()])) as Owner]
  return save(supabase, dealId, p)
}

export async function removeProfileOwner(dealId: string, owner: number) {
  const { supabase, profile } = await load(dealId)
  if (!profile) return { ok: true }
  profile.owners = profile.owners.filter((_, i) => i !== owner)
  return save(supabase, dealId, profile)
}
