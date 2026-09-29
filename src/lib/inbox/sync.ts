import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getValidAccessToken,
  listInboxMessagesSince,
  getMessageAttachments,
  type InboxMessage,
} from '@/lib/outlook/graph'
import { classifyEmail, isAutomatedSender } from './classify'
import { OUTCOME_LABELS, type EmailClassification } from './classify-schema'

// Deal-worthy attachment types; everything else (calendar invites, vCards,
// signature images that aren't marked inline) is ignored.
const KEEP_EXT = /\.(pdf|xlsx|xls|csv|docx|doc|png|jpe?g|txt|eml)$/i
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
const FIRST_RUN_LOOKBACK_DAYS = 3
const EARLY_STAGES = ['new', 'in_review', 'underwritten', 'matched']

export type SyncSummary = {
  processed: number
  newDeals: number
  dealUpdates: number
  lenderReplies: number
  other: number
  errors: number
  moreWaiting: boolean
}

function isBillingError(err: unknown) {
  const text = err instanceof Error ? err.message.toLowerCase() : ''
  return text.includes('credit balance') || text.includes('usage limit') || text.includes('spend limit')
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

// Reads new inbox mail since the last run, has Claude decide what each
// email is, and acts on it: new deals are created (with their attachments
// uploaded), follow-ups are logged on the existing deal, and lender replies
// are logged on the deal they answer. Every email is recorded once in
// inbox_messages so nothing is processed twice. Works with either a
// signed-in client (manual run) or the admin client (scheduled run).
export async function runInboxSync(supabase: SupabaseClient, maxMessages = 25): Promise<SyncSummary> {
  const summary: SyncSummary = {
    processed: 0,
    newDeals: 0,
    dealUpdates: 0,
    lenderReplies: 0,
    other: 0,
    errors: 0,
    moreWaiting: false,
  }

  const { data: state } = await supabase.from('inbox_sync_state').select('*').eq('id', 1).single()
  const since =
    state?.last_synced_at ??
    new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  await supabase
    .from('inbox_sync_state')
    .update({ last_run_at: new Date().toISOString(), last_run_status: 'running', last_error: null })
    .eq('id', 1)

  try {
    const { accessToken, accountEmail } = await getValidAccessToken(supabase)
    const messages = await listInboxMessagesSince(accessToken, since, maxMessages)
    summary.moreWaiting = messages.length === maxMessages

    // Context the classifier and the actions need, loaded once per run.
    const [{ data: already }, { data: deals }, { data: lenders }, { data: contacts }, { data: threads }] =
      await Promise.all([
        supabase
          .from('inbox_messages')
          .select('graph_message_id')
          .in('graph_message_id', messages.map((m) => m.id).concat('none')),
        supabase
          .from('deals')
          .select('id, company_name, contact_name, status')
          .not('status', 'in', '(closed,dead,old)'),
        supabase.from('lenders').select('id, name, contact_email, mandate_notes'),
        supabase.from('lender_contacts').select('lender_id, email'),
        supabase
          .from('deal_matches')
          .select('deal_id, lender_id, outlook_conversation_id')
          .not('outlook_conversation_id', 'is', null),
      ])

    const seen = new Set((already ?? []).map((r) => r.graph_message_id))
    const activeDeals = (deals ?? []).map((d, i) => ({ ...d, ref: `D${i + 1}` }))
    const dealByRef = new Map(activeDeals.map((d) => [d.ref, d]))
    const dealById = new Map((deals ?? []).map((d) => [d.id, d]))
    const lenderById = new Map((lenders ?? []).map((l) => [l.id, l]))

    const lenderByEmail = new Map<string, string>()
    for (const l of lenders ?? []) if (l.contact_email) lenderByEmail.set(l.contact_email.toLowerCase(), l.id)
    for (const c of contacts ?? []) if (c.email) lenderByEmail.set(c.email.toLowerCase(), c.lender_id)

    const threadByConversation = new Map(
      (threads ?? []).map((t) => [t.outlook_conversation_id as string, { dealId: t.deal_id, lenderId: t.lender_id }])
    )

    let lastReceived: string | null = null

    for (const message of messages) {
      lastReceived = message.receivedDateTime
      if (seen.has(message.id)) continue

      const record = {
        graph_message_id: message.id,
        conversation_id: message.conversationId,
        from_email: message.from,
        subject: message.subject,
        received_at: message.receivedDateTime,
      }

      // The mailbox's own messages and obvious robots never cost an AI call.
      if (message.from === accountEmail.toLowerCase() || isAutomatedSender(message.from)) {
        await supabase.from('inbox_messages').insert({
          ...record,
          classification: 'other',
          action_taken: 'Skipped (automated or own message)',
        })
        summary.other++
        summary.processed++
        continue
      }

      try {
        const thread = threadByConversation.get(message.conversationId) ?? null
        const senderLenderId = lenderByEmail.get(message.from) ?? null
        const attachments = message.hasAttachments ? await getMessageAttachments(accessToken, message.id) : []

        const classification = await classifyEmail(
          message,
          attachments.map((a) => a.name),
          {
            activeDeals: activeDeals.map((d) => ({ ref: d.ref, company_name: d.company_name, contact_name: d.contact_name })),
            senderLenderName: senderLenderId ? (lenderById.get(senderLenderId)?.name ?? null) : null,
            threadDealCompany: thread ? (dealById.get(thread.dealId)?.company_name ?? null) : null,
            threadLenderName: thread ? (lenderById.get(thread.lenderId)?.name ?? null) : null,
          },
          supabase
        )

        const outcome = await act({
          supabase,
          message,
          classification,
          attachments,
          thread,
          senderLenderId,
          dealByRef,
          dealById,
          lenderById,
        })

        await supabase.from('inbox_messages').insert({ ...record, ...outcome.record })
        summary[outcome.counter]++
        summary.processed++
      } catch (err) {
        // Out of credit / over the spend limit: stop without recording, so
        // these emails are retried on the next run instead of lost.
        if (isBillingError(err)) throw err
        await supabase.from('inbox_messages').insert({
          ...record,
          classification: 'error',
          action_taken: err instanceof Error ? err.message.slice(0, 500) : 'Processing failed',
        })
        summary.errors++
        summary.processed++
      }
    }

    await supabase
      .from('inbox_sync_state')
      .update({
        last_synced_at: lastReceived ?? state?.last_synced_at ?? since,
        last_run_status: `Processed ${summary.processed}: ${summary.newDeals} new deals, ${summary.dealUpdates} deal follow-ups, ${summary.lenderReplies} lender replies, ${summary.other} other${summary.errors ? `, ${summary.errors} errors` : ''}${summary.moreWaiting ? ' (more waiting)' : ''}`,
      })
      .eq('id', 1)

    return summary
  } catch (err) {
    await supabase
      .from('inbox_sync_state')
      .update({ last_run_status: 'failed', last_error: err instanceof Error ? err.message : 'Sync failed' })
      .eq('id', 1)
    throw err
  }
}

type Deal = { id: string; company_name: string; contact_name: string | null; status: string }
type Lender = { id: string; name: string; contact_email: string | null; mandate_notes: string | null }
type Counter = 'newDeals' | 'dealUpdates' | 'lenderReplies' | 'other'

async function act({
  supabase,
  message,
  classification,
  attachments,
  thread,
  senderLenderId,
  dealByRef,
  dealById,
  lenderById,
}: {
  supabase: SupabaseClient
  message: InboxMessage
  classification: EmailClassification
  attachments: Awaited<ReturnType<typeof getMessageAttachments>>
  thread: { dealId: string; lenderId: string } | null
  senderLenderId: string | null
  dealByRef: Map<string, Deal & { ref: string }>
  dealById: Map<string, Deal>
  lenderById: Map<string, Lender>
}): Promise<{ counter: Counter; record: Record<string, unknown> }> {
  const sender = message.fromName || message.from

  // A reply inside a thread the CRM itself started is a lender reply no
  // matter what the model thought.
  const kind = thread ? 'lender_reply' : classification.kind

  if (kind === 'lender_reply') {
    const reply = classification.lender_reply
    const dealId = thread?.dealId ?? (reply?.deal_ref ? dealByRef.get(reply.deal_ref)?.id : undefined) ?? null
    const lenderId = thread?.lenderId ?? senderLenderId
    const lender = lenderId ? lenderById.get(lenderId) : undefined
    const outcomeLabel = reply ? OUTCOME_LABELS[reply.outcome] : 'Replied'
    const summaryText = reply?.summary ?? classification.reason

    if (!dealId) {
      return {
        counter: 'lenderReplies',
        record: {
          classification: 'lender_reply',
          lender_id: lenderId,
          summary: summaryText,
          action_taken: "Couldn't tell which deal this is about — review manually",
        },
      }
    }

    const note = [
      `Lender reply — ${lender?.name ?? sender}: ${outcomeLabel}. ${summaryText}`,
      reply?.requested_items.length ? `Asked for: ${reply.requested_items.join('; ')}.` : null,
    ]
      .filter(Boolean)
      .join(' ')
    await supabase.from('deal_updates').insert({ deal_id: dealId, entry_date: today(), note, source: 'email' })

    // A lender answering means the deal went out.
    const deal = dealById.get(dealId)
    if (deal && EARLY_STAGES.includes(deal.status)) {
      await supabase.from('deals').update({ status: 'submitted' }).eq('id', dealId)
    }

    const actions = ['Logged on deal']
    if (reply?.mandate_notes && lender) {
      const stamped = `[${today()} from email] ${reply.mandate_notes}`
      await supabase
        .from('lenders')
        .update({ mandate_notes: lender.mandate_notes ? `${lender.mandate_notes}\n${stamped}` : stamped })
        .eq('id', lender.id)
      actions.push('added to lender mandate notes')
    }

    return {
      counter: 'lenderReplies',
      record: {
        classification: 'lender_reply',
        deal_id: dealId,
        lender_id: lenderId,
        summary: `${outcomeLabel}: ${summaryText}`,
        action_taken: actions.join(', '),
      },
    }
  }

  if (kind === 'new_deal' && classification.new_deal) {
    const d = classification.new_deal
    const existing = d.existing_deal_ref ? dealByRef.get(d.existing_deal_ref) : undefined

    let dealId: string
    let counter: Counter
    if (existing) {
      dealId = existing.id
      counter = 'dealUpdates'
    } else {
      const { data: created, error } = await supabase
        .from('deals')
        .insert({
          company_name: d.company_name,
          contact_name: d.contact_name,
          contact_email: d.contact_email ?? message.from,
          contact_phone: d.contact_phone,
          industry: d.industry,
          loan_type: d.loan_type,
          deal_type: d.ask,
          description: d.description,
          status: 'new',
          source_message_id: message.id,
        })
        .select('id')
        .single()
      if (error || !created) throw new Error(`Could not create deal: ${error?.message ?? 'unknown error'}`)
      dealId = created.id
      counter = 'newDeals'
    }

    let saved = 0
    for (const a of attachments) {
      if (!KEEP_EXT.test(a.name) || a.size > MAX_ATTACHMENT_BYTES) continue
      const storagePath = `${dealId}/${Date.now()}-${a.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const bytes = Buffer.from(a.contentBytes, 'base64')
      const { error: uploadError } = await supabase.storage
        .from('borrower-documents')
        .upload(storagePath, bytes, { contentType: a.contentType })
      if (uploadError) continue
      await supabase.from('documents').insert({
        deal_id: dealId,
        file_name: a.name,
        storage_path: storagePath,
        file_size: bytes.byteLength,
        content_type: a.contentType,
      })
      saved++
    }

    const docsText = saved ? ` ${saved} document${saved === 1 ? '' : 's'} attached.` : ''
    await supabase.from('deal_updates').insert({
      deal_id: dealId,
      entry_date: today(),
      note: existing
        ? `Follow-up email from ${sender}: "${message.subject}".${docsText} ${d.description}`
        : `Auto-imported from email from ${sender}: "${message.subject}".${docsText}`,
      source: 'email',
    })

    return {
      counter,
      record: {
        classification: 'new_deal',
        deal_id: dealId,
        summary: d.description,
        action_taken: existing
          ? `Added to existing deal${docsText}`
          : `Created deal "${d.company_name}"${docsText}`,
      },
    }
  }

  return {
    counter: 'other',
    record: { classification: 'other', summary: classification.reason, action_taken: 'No action' },
  }
}
