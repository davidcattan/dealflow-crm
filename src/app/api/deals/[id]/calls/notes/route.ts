import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { summarizeTypedNotes } from '@/lib/calls/process'

export const maxDuration = 120

// Notes typed during a call (when it couldn't be recorded). Plain save: a
// note on the deal (free). Organize: the AI turns them into call notes with
// suggested updates, like a recorded call (a few cents).
export async function POST(request: Request, ctx: RouteContext<'/api/deals/[id]/calls/notes'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { text, callWith, lenderId, lenderName, date, organize } = (await request.json()) as {
    text?: string
    callWith?: 'borrower' | 'lender' | 'broker' | null
    lenderId?: string | null
    lenderName?: string | null
    date?: string | null
    organize?: boolean
  }
  const notes = (text ?? '').trim()
  if (!notes) return NextResponse.json({ error: 'Nothing written yet.' }, { status: 400 })
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10)

  if (!organize) {
    const { data: deal } = await supabase.from('deals').select('contact_name, company_name').eq('id', id).single()
    const who =
      callWith === 'borrower'
        ? ` with ${deal?.contact_name || deal?.company_name || 'the borrower'}`
        : callWith === 'lender'
          ? ` with ${lenderName || 'the lender'}`
          : callWith === 'broker'
            ? ' with the referral partner'
            : ''
    const { error } = await supabase.from('deal_updates').insert({
      deal_id: id,
      entry_date: day,
      note: `📝 Call notes${who}:\n${notes}`,
      lender_id: callWith === 'lender' ? (lenderId ?? null) : null,
      source: 'manual',
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    revalidatePath(`/deals/${id}`)
    return NextResponse.json({ ok: true })
  }

  const { data: call, error } = await supabase
    .from('deal_calls')
    .insert({
      deal_id: id,
      storage_path: 'typed-notes', // no recording
      transcript: notes,
      status: 'summarizing',
      created_by: user.id,
      created_at: new Date(`${day}T${new Date().toISOString().slice(11)}`).toISOString(),
      call_with: callWith ?? null,
      lender_id: callWith === 'lender' ? (lenderId ?? null) : null,
    })
    .select('id')
    .single()
  if (error || !call) return NextResponse.json({ error: error?.message ?? 'Couldn’t save the notes' }, { status: 500 })
  await summarizeTypedNotes(supabase, call.id)
  revalidatePath(`/deals/${id}`)
  return NextResponse.json({ ok: true, id: call.id })
}
