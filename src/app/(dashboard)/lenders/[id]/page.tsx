import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LenderDetail } from './lender-detail'
import type { Lender, LenderContact } from '@/lib/types'
import { CallsPanel, type CallRow } from '../../deals/[id]/calls-panel'
import { lenderCallSuggestions } from '@/lib/calls/lender-call'
import type { LenderCallNotes } from '@/lib/calls/schema'

export default async function LenderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const [{ data: lender }, { data: contacts }, { data: callRows }] = await Promise.all([
    supabase.from('lenders').select('*').eq('id', id).single(),
    supabase
      .from('lender_contacts')
      .select('*')
      .eq('lender_id', id)
      .order('created_at', { ascending: true }),
    // Calls filed on this lender (not on a deal). Empty until migration 030.
    supabase
      .from('deal_calls')
      .select('id, status, created_at, duration_seconds, transcript, result, applied, error')
      .eq('lender_id', id)
      .is('deal_id', null)
      .order('created_at', { ascending: false }),
  ])

  if (!lender) notFound()

  const calls: CallRow[] = (callRows ?? []).map((c) => ({
    ...(c as Omit<CallRow, 'suggestions'>),
    applied: (c.applied as string[] | null) ?? [],
    suggestions: c.result ? lenderCallSuggestions(c.result as LenderCallNotes) : [],
  }))

  return (
    <div className="space-y-8">
      <LenderDetail lender={lender as Lender} contacts={(contacts ?? []) as LenderContact[]} />
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Calls{calls.length ? ` (${calls.length})` : ''}</h2>
        <p className="mb-4 mt-1 text-xs text-slate-500">
          Intro calls and general calls with this lender. The notes suggest updates to their profile — loan sizes, what
          they lend on, regions, contacts. (Calls about a specific deal go on that deal.)
        </p>
        <CallsPanel
          calls={calls}
          target={{ uploadUrl: `/api/lenders/${id}/calls`, pathPrefix: `calls/lender-${id}/` }}
          hint="Put the call on speaker, then hit record."
        />
      </section>
    </div>
  )
}
