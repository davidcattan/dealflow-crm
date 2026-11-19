import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getInboxMessage, getValidAccessToken, listConnections } from '@/lib/outlook/graph'

export const maxDuration = 300

// One-off: fetches the full text (from Outlook, no AI — free) of emails that
// were filed on a deal before email bodies were stored.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ?truncated=1: instead, re-fetch deal emails stored before bodies were
  // kept in full (cut at 8,000 characters — a forwarded thread lost its
  // oldest part, often the original ask).
  const truncated = new URL(request.url).searchParams.get('truncated') === '1'
  let rows: { id: string; graph_message_id: string; mailbox: string | null }[] = []
  if (truncated) {
    for (let from = 0; ; from += 500) {
      const { data, error } = await supabase
        .from('inbox_messages')
        .select('id, graph_message_id, mailbox, body_text')
        .not('deal_id', 'is', null)
        .not('body_text', 'is', null)
        .order('received_at', { ascending: false })
        .range(from, from + 499)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      rows.push(...(data ?? []).filter((r) => String(r.body_text).length >= 7990))
      if ((data ?? []).length < 500 || rows.length >= 200) break
    }
    rows = rows.slice(0, 200)
  } else {
    const { data, error } = await supabase
      .from('inbox_messages')
      .select('id, graph_message_id, mailbox')
      .not('deal_id', 'is', null)
      .is('body_text', null)
      .limit(200)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    rows = data ?? []
  }

  // Message ids belong to one mailbox; old rows don't say which, so try each.
  const connections = await listConnections(supabase)
  const tokens = new Map<string, string>()
  const tokenFor = async (id: string) => {
    if (!tokens.has(id)) tokens.set(id, (await getValidAccessToken(supabase, id)).accessToken)
    return tokens.get(id)!
  }
  let filled = 0
  const failed: string[] = []
  for (const row of rows) {
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
