'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { buildKeyFacts, type KeyFacts } from '@/lib/deals/key-facts'
import { friendlyAiError } from '@/lib/ai-errors'

const MIGRATION = 'Run migration 044_key_facts.sql in Supabase first.'

// The AI reads the deal again (a few cents).
export async function refreshKeyFacts(dealId: string) {
  try {
    await buildKeyFacts(await createClient(), dealId)
    revalidatePath(`/deals/${dealId}`)
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    return { error: /key_facts/.test(msg) ? MIGRATION : friendlyAiError(err, 'Couldn’t read the deal') }
  }
}

// Your own edit: kept (and wins) when the AI refreshes.
export async function saveKeyFact(dealId: string, oldLabel: string | null, label: string, value: string) {
  const l = label.trim()
  const v = value.trim()
  if (!l || !v) return { error: 'Fill in both.' }
  const supabase = await createClient()
  const { data: deal, error } = await supabase.from('deals').select('key_facts').eq('id', dealId).single()
  if (error) return { error: error.message.includes('key_facts') ? MIGRATION : error.message }
  const kf = ((deal?.key_facts as KeyFacts | null) ?? { facts: [], missing: [] }) as KeyFacts
  const key = (oldLabel ?? l).toLowerCase()
  const fact = { label: l, value: v, source: 'Entered by you', pinned: true }
  const i = kf.facts.findIndex((f) => f.label.toLowerCase() === key)
  const facts = i >= 0 ? kf.facts.map((f, j) => (j === i ? fact : f)) : [...kf.facts, fact]
  const missing = kf.missing.filter((m) => m.toLowerCase() !== l.toLowerCase())
  await supabase.from('deals').update({ key_facts: { ...kf, facts, missing } }).eq('id', dealId)
  revalidatePath(`/deals/${dealId}`)
  return { ok: true }
}

export async function removeKeyFact(dealId: string, label: string) {
  const supabase = await createClient()
  const { data: deal } = await supabase.from('deals').select('key_facts').eq('id', dealId).single()
  const kf = (deal?.key_facts as KeyFacts | null) ?? null
  if (!kf) return { ok: true }
  await supabase
    .from('deals')
    .update({ key_facts: { ...kf, facts: kf.facts.filter((f) => f.label.toLowerCase() !== label.toLowerCase()) } })
    .eq('id', dealId)
  revalidatePath(`/deals/${dealId}`)
  return { ok: true }
}
