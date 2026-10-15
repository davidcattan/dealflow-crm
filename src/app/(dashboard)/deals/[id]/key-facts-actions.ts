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

// The email or call a key fact came from, to show right there.
export async function getFactSource(dealId: string, kind: 'email' | 'call', id: string) {
  const supabase = await createClient()
  if (kind === 'email') {
    const { data } = await supabase.from('inbox_messages').select('subject, from_email, received_at, summary, body_text, classification').eq('id', id).eq('deal_id', dealId).maybeSingle()
    if (!data) return null
    const { ownText } = await import('@/lib/outlook/own-text')
    return {
      title: `${data.classification === 'sent' ? 'Email we sent' : `Email from ${data.from_email}`} · ${String(data.received_at).slice(0, 10)} · ${data.subject ?? ''}`,
      text: data.body_text ? ownText(String(data.body_text)).slice(0, 8000) : (data.summary ?? ''),
    }
  }
  const { data } = await supabase.from('deal_calls').select('created_at, result, transcript').eq('id', id).eq('deal_id', dealId).maybeSingle()
  if (!data) return null
  const r = data.result as { title?: string; summary?: string; key_points?: string[] } | null
  return {
    title: `Call · ${String(data.created_at).slice(0, 10)}${r?.title ? ` · ${r.title}` : ''}`,
    text: r ? [r.summary, ...(r.key_points ?? []).map((k) => `• ${k}`)].filter(Boolean).join('\n') : String(data.transcript ?? '').slice(0, 8000),
  }
}
