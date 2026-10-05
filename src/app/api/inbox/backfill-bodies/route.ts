import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getInboxMessage, getValidAccessToken, listConnections } from '@/lib/outlook/graph'

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
    .select('id, graph_message_id, mailbox')
    .not('deal_id', 'is', null)
    .is('body_text', null)
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Message ids belong to one mailbox; old rows don't say which, so try each.
  const connections = await listConnections(supabase)
  const tokens = new Map<string, string>()
  const tokenFor = async (id: string) => {
    if (!tokens.has(id)) tokens.set(id, (await getValidAccessToken(supabase, id)).accessToken)
    return tokens.get(id)!
  }
  let filled = 0
  const failed: string[] = []
  for (const row of rows ?? []) {
    const ordered = [...connections].sort((a) => (row.mailbox && a.account_email.toLowerCase() === String(row.mailbox).toLowerCase() ? -1 : 0))
    let done = false
    for (const c of ordered) {
      try {
        const message = await getInboxMessage(await tokenFor(c.id), row.graph_message_id)
        await supabase.from('inbox_messages').update({ body_text: message.bodyText }).eq('id', row.id)
        filled++
        done = true
        break
      } catch {
        // Not in this mailbox (or deleted) — try the next one.
      }
    }
    if (!done) failed.push(row.id)
  }
  return NextResponse.json({ filled, failed: failed.length })
}
