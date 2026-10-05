import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getInboxMessage, getValidAccessToken } from '@/lib/outlook/graph'

export const maxDuration = 300

// One-off: fetches the full text (from Outlook, no AI — free) of emails that
// were filed on a deal before email bodies were stored.
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rows, error } = await supabase
    .from('inbox_messages')
    .select('id, graph_message_id')
    .not('deal_id', 'is', null)
    .is('body_text', null)
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { accessToken } = await getValidAccessToken(supabase)
  let filled = 0
  const failed: string[] = []
  for (const row of rows ?? []) {
    try {
      const message = await getInboxMessage(accessToken, row.graph_message_id)
      await supabase.from('inbox_messages').update({ body_text: message.bodyText }).eq('id', row.id)
      filled++
    } catch {
      // Deleted or moved out of reach in Outlook — leave the summary.
      failed.push(row.id)
    }
  }
  return NextResponse.json({ filled, failed: failed.length })
}
