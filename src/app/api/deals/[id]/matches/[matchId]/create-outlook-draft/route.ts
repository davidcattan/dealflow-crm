import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getValidAccessToken, createOutlookDraft, type DraftAttachment } from '@/lib/outlook/graph'
import { friendlyAiError } from '@/lib/ai-errors'
import type { DocumentRecord } from '@/lib/types'

export const maxDuration = 60

// Creates a real Outlook draft (in the connected mailbox's Drafts folder)
// from a match's already-generated subject/body, with the deal's documents
// attached. Nothing is sent — no AI call here either, so this is free
// beyond the one-time Outlook connection.
export async function POST(_request: Request, ctx: RouteContext<'/api/deals/[id]/matches/[matchId]/create-outlook-draft'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: dealId, matchId } = await ctx.params

  const { data: match } = await supabase
    .from('deal_matches')
    .select('id, lender_id, draft_subject, draft_body')
    .eq('id', matchId)
    .eq('deal_id', dealId)
    .single()
  if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  if (!match.draft_subject || !match.draft_body) {
    return NextResponse.json({ error: 'No drafted email on this match yet — select it or wait for matching to draft one.' }, { status: 400 })
  }

  const [{ data: lender }, { data: contacts }, { data: documents }] = await Promise.all([
    supabase.from('lenders').select('name, contact_name, contact_email').eq('id', match.lender_id).single(),
    supabase.from('lender_contacts').select('name, email').eq('lender_id', match.lender_id),
    supabase.from('documents').select('*').eq('deal_id', dealId),
  ])
  if (!lender) return NextResponse.json({ error: 'Lender not found' }, { status: 404 })

  const primaryContact =
    (contacts ?? []).find((c) => c.email) ??
    (lender.contact_email ? { name: lender.contact_name, email: lender.contact_email } : null)
  if (!primaryContact?.email) {
    return NextResponse.json({ error: `${lender.name} has no contact email on file.` }, { status: 400 })
  }

  try {
    const { accessToken } = await getValidAccessToken()

    const attachments: DraftAttachment[] = []
    for (const doc of (documents ?? []) as DocumentRecord[]) {
      const { data: file } = await supabase.storage.from('borrower-documents').download(doc.storage_path)
      if (!file) continue
      const buffer = Buffer.from(await file.arrayBuffer())
      attachments.push({
        name: doc.file_name,
        contentType: doc.content_type || 'application/octet-stream',
        contentBytes: buffer.toString('base64'),
      })
    }

    const result = await createOutlookDraft({
      accessToken,
      to: { name: primaryContact.name, email: primaryContact.email },
      subject: match.draft_subject,
      body: match.draft_body,
      attachments,
    })

    await supabase
      .from('deal_matches')
      .update({
        outlook_draft_created_at: new Date().toISOString(),
        // Replies keep this id, so the inbox sync can tie them back here.
        outlook_conversation_id: result.conversationId,
      })
      .eq('id', matchId)
    // If this lender is already on the deal's "sent to" list, link the thread there too.
    await supabase
      .from('deal_submissions')
      .update({ outlook_conversation_id: result.conversationId })
      .eq('deal_id', dealId)
      .eq('lender_id', match.lender_id)
      .is('outlook_conversation_id', null)

    return NextResponse.json({ ok: true, webLink: result.webLink, skippedAttachments: result.skipped })
  } catch (err) {
    return NextResponse.json({ error: friendlyAiError(err, 'Could not create the Outlook draft') }, { status: 500 })
  }
}
