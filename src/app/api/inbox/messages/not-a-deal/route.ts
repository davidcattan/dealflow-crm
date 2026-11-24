import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

// Someone looked at emails on "needs filing" and they don't belong on any
// deal: mark them so they stop counting (the dashboard notice goes away).
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(300) }).safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'No emails picked' }, { status: 400 })

  const { data: rows } = await supabase.from('inbox_messages').select('id, action_taken').in('id', parsed.data.ids).is('deal_id', null)
  for (const r of rows ?? []) {
    const before = String(r.action_taken ?? '')
    if (/Not about a deal/.test(before)) continue
    await supabase
      .from('inbox_messages')
      .update({ action_taken: [before, 'Not about a deal (checked by hand)'].filter(Boolean).join(', ') })
      .eq('id', r.id)
  }
  return NextResponse.json({ ok: true, marked: (rows ?? []).length })
}
