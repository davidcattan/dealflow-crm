import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getValidAccessToken, createOutlookDraft } from '@/lib/outlook/graph'
import { jedSignatureHtml } from '@/lib/outlook/jed-signature'
import { prospectEmail } from '@/lib/prospects/email'
import type { Prospect } from '@/lib/prospects/types'

export const maxDuration = 120

// Puts the approved cold email for each chosen prospect into the signed-in
// person's Outlook Drafts folder (their own mailbox if connected). Nothing is
// sent and there's no AI — the inbox sync marks them Emailed once you send.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ids } = (await request.json().catch(() => ({}))) as { ids?: string[] }
  if (!Array.isArray(ids) || !ids.length) return NextResponse.json({ error: 'Pick at least one person.' }, { status: 400 })
  if (ids.length > 25) return NextResponse.json({ error: 'At most 25 at a time — Outlook is happier that way.' }, { status: 400 })

  const { data: rows, error } = await supabase.from('prospects').select('*').in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Their own mailbox if they connected one, else the newest.
  const { data: mine } = await supabase
    .from('outlook_connections')
    .select('id')
    .eq('connected_by', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  try {
    const { accessToken, accountEmail } = await getValidAccessToken(supabase, mine?.id ?? null)
    const signatureHtml = jedSignatureHtml(accountEmail)
    const senderName = accountEmail.split('@')[0].replace(/^\w/, (c) => c.toUpperCase())
    const made: string[] = []
    const skipped: string[] = []
    for (const p of (rows ?? []) as Prospect[]) {
      if (p.status === 'do_not_contact' || p.status === 'not_interested') {
        skipped.push(`${p.company_display || p.company} (${p.status.replace(/_/g, ' ')})`)
        continue
      }
      const { subject, body } = prospectEmail(p)
      await createOutlookDraft({
        accessToken,
        to: { name: [p.first_name, p.last_name].filter(Boolean).join(' ') || null, email: p.email },
        subject,
        body: signatureHtml ? body : `${body}\n${senderName}\nJED Capital Group`,
        attachments: [],
        signatureHtml,
      })
      made.push(p.company_display || p.company)
    }
    return NextResponse.json({ ok: true, created: made.length, skipped, mailbox: accountEmail })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not create the drafts' }, { status: 500 })
  }
}
