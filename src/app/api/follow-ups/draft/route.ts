import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getValidAccessToken, createOutlookDraft, graphFetch } from '@/lib/outlook/graph'
import { jedSignatureHtml } from '@/lib/outlook/jed-signature'
import { writeFollowUpEmail } from '@/lib/deals/follow-up-email'

export const maxDuration = 60

// Puts a short follow-up to a lender in the signed-in person's Outlook
// Drafts: a reply-all on the last email in the thread when it's in their
// mailbox, otherwise a new email to the person we last wrote to. Nothing is
// sent and there's no AI; the inbox sync logs it once it goes out, which
// restarts the follow-up clock.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { dealId, lenderId, followUpsSent } = (await request.json().catch(() => ({}))) as {
    dealId?: string
    lenderId?: string
    followUpsSent?: number
  }
  if (!dealId || !lenderId) return NextResponse.json({ error: 'Missing deal or lender' }, { status: 400 })

  const [{ data: deal }, { data: lender }, { data: contacts }, { data: thread }, { data: mine }] = await Promise.all([
    supabase.from('deals').select('company_name').eq('id', dealId).single(),
    supabase.from('lenders').select('name, contact_name, contact_email').eq('id', lenderId).single(),
    supabase.from('lender_contacts').select('name, email').eq('lender_id', lenderId),
    supabase
      .from('inbox_messages')
      .select('graph_message_id, mailbox, subject, from_email, to_emails, classification, received_at')
      .eq('deal_id', dealId)
      .eq('lender_id', lenderId)
      .in('classification', ['sent', 'lender_reply'])
      .order('received_at', { ascending: false })
      .limit(10),
    supabase
      .from('outlook_connections')
      .select('id')
      .eq('connected_by', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (!deal || !lender) return NextResponse.json({ error: 'Deal or lender not found' }, { status: 404 })

  // Who to greet: the lender person on the last email, if we know them.
  const last = thread?.[0]
  const theirEmail =
    (last?.classification === 'lender_reply' ? last.from_email : last?.to_emails?.split(',')[0]?.trim()) ||
    lender.contact_email ||
    contacts?.find((c) => c.email)?.email ||
    null
  const person =
    contacts?.find((c) => c.email && theirEmail && c.email.toLowerCase() === theirEmail.toLowerCase())?.name ??
    (lender.contact_email && theirEmail && lender.contact_email.toLowerCase() === theirEmail.toLowerCase() ? lender.contact_name : null)
  const first = person?.trim().split(/\s+/)[0]
  const greeting = `Hi${first ? ` ${first}` : ''},`
  // Written by the AI from what we originally sent this lender (about
  // 0.1-0.3¢); a plain template if that fails. Ends with "Thanks,".
  const text =
    (await writeFollowUpEmail(supabase, {
      dealId,
      lenderId,
      dealName: deal.company_name,
      lenderName: lender.name,
      greeting,
      followUpsSent: followUpsSent ?? 0,
    })) ??
    ((followUpsSent ?? 0) >= 1
      ? `${greeting}\n\nCircling back on ${deal.company_name}. Is this something you'd like to pursue? If it's not a fit, no problem, just let me know so I can update the client.\n\nThanks,`
      : `${greeting}\n\nWanted to follow up on ${deal.company_name}. Any initial thoughts? Happy to jump on a quick call or send anything else you need.\n\nThanks,`)

  try {
    const { accessToken, accountEmail } = await getValidAccessToken(supabase, mine?.id ?? null)
    const sender = accountEmail.split('@')[0].split(/[._-]/)[0].replace(/^\w/, (c) => c.toUpperCase())

    // Reply-all in the same thread when the last email is in this mailbox.
    const inMyMailbox = thread?.find((m) => m.graph_message_id && m.mailbox?.toLowerCase() === accountEmail.toLowerCase())
    if (inMyMailbox) {
      const draft = await graphFetch(`/me/messages/${inMyMailbox.graph_message_id}/createReplyAll`, accessToken, {
        method: 'POST',
        body: JSON.stringify({ comment: `${text}\n${sender}` }),
      })
      return NextResponse.json({ ok: true, webLink: draft.webLink ?? null, mailbox: accountEmail, threaded: true })
    }

    if (!theirEmail) return NextResponse.json({ error: `No email on file for ${lender.name}.` }, { status: 400 })
    const signatureHtml = jedSignatureHtml(accountEmail)
    const subject = last?.subject ? (/^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`) : `${deal.company_name} – follow up`
    const draft = await createOutlookDraft({
      accessToken,
      to: { name: person, email: theirEmail },
      subject,
      body: signatureHtml ? text : `${text}\n${sender}`,
      attachments: [],
      signatureHtml,
    })
    return NextResponse.json({ ok: true, webLink: draft.webLink, mailbox: accountEmail, threaded: false })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not create the draft' }, { status: 500 })
  }
}
