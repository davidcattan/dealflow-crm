import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createOutlookDraft, getValidAccessToken } from '@/lib/outlook/graph'
import { jedSignatureHtml, trimToSignOff } from '@/lib/outlook/jed-signature'

// Puts a short "here's what we still need" email in the user's Outlook
// Drafts (never sends). No AI — the list comes from the deal's request list.
export async function POST(request: Request, ctx: RouteContext<'/api/deals/[id]/request-email'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { to, subject, body, connectionId, logNote } = (await request.json().catch(() => ({}))) as {
    to?: { name?: string | null; email?: string }
    subject?: string
    body?: string
    connectionId?: string | null
    // What to write in the deal's updates (default: "Drafted a request email…").
    logNote?: string
  }
  if (!to?.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.email)) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  if (!body?.trim()) return NextResponse.json({ error: 'The email is empty' }, { status: 400 })

  try {
    const { accessToken, accountEmail, connectionId: used } = await getValidAccessToken(supabase, connectionId)
    // Sign off with that mailbox's saved signature (Settings), else the first name.
    const { data: conn } = await supabase.from('outlook_connections').select('email_signature').eq('id', used).maybeSingle()
    const first = accountEmail.split('@')[0].split(/[._-]/)[0]
    const signature = conn?.email_signature?.trim() || first.charAt(0).toUpperCase() + first.slice(1)
    // The sender's real JED signature if it's David's or Eli's mailbox.
    const signatureHtml = jedSignatureHtml(accountEmail)
    const draft = await createOutlookDraft({
      accessToken,
      to: { name: to.name ?? null, email: to.email },
      subject: subject?.trim() || 'A few items to move forward',
      body: signatureHtml ? trimToSignOff(body.trim()) : `${body.trim()}\n${signature}`,
      attachments: [],
      signatureHtml,
    })
    await supabase.from('deal_updates').insert({
      deal_id: id,
      entry_date: new Date().toISOString().slice(0, 10),
      note: logNote?.trim()
        ? `${logNote.trim()} (draft in ${accountEmail.split('@')[0]}'s Outlook).`
        : `Drafted a request email to ${to.name || to.email} in ${accountEmail.split('@')[0]}'s Outlook: "${subject?.trim() || 'A few items to move forward'}".`,
      source: 'manual',
    })
    return NextResponse.json({ ok: true, webLink: draft.webLink })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Couldn’t create the draft' }, { status: 500 })
  }
}
