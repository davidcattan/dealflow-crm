import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getValidAccessToken,
  listInboxMessagesSince,
  getInboxMessage,
  getInboxStatus,
  getMessageAttachments,
  type InboxMessage,
} from '@/lib/outlook/graph'
import { classifyEmail, isAutomatedSender } from './classify'
import { OUTCOME_LABELS, type EmailClassification } from './classify-schema'
import { recordSubmission } from '@/lib/deals/submissions'
import type { SubmissionStatus } from '@/lib/deals/submission-status'

// Deal-worthy attachment types; everything else (calendar invites, vCards,
// signature images that aren't marked inline) is ignored.
const KEEP_EXT = /\.(pdf|xlsx|xls|csv|docx|doc|png|jpe?g|txt|eml)$/i
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
const FIRST_RUN_LOOKBACK_DAYS = 3
// A lender replying means the deal went out — including deals that had been
// shelved as Old (the first real run showed lenders still working those).
const ADVANCE_ON_LENDER_REPLY = ['new', 'in_review', 'underwritten', 'matched', 'old']
// What a lender's reply means for that lender's status on the deal.
const OUTCOME_TO_SUBMISSION: Record<string, SubmissionStatus | undefined> = {
  interested: 'interested',
  needs_more_info: 'needs_more_info',
  term_sheet: 'term_sheet',
  declined: 'declined',
  other: undefined,
}

export type SyncSummary = {
  processed: number
  newDeals: number
  dealUpdates: number
  lenderReplies: number
  other: number
  errors: number
  moreWaiting: boolean
}

type Counter = 'newDeals' | 'dealUpdates' | 'lenderReplies' | 'other' | 'errors'
type Deal = { id: string; company_name: string; contact_name: string | null; status: string }
type Lender = { id: string; name: string; contact_email: string | null; mandate_notes: string | null }

type Context = {
  accessToken: string
  accountEmail: string
  deals: (Deal & { ref: string })[]
  dealByRef: Map<string, Deal & { ref: string }>
  dealById: Map<string, Deal>
  lenderById: Map<string, Lender>
  lenderByEmail: Map<string, string>
  threadByConversation: Map<string, { dealId: string; lenderId: string }>
}

function isBillingError(err: unknown) {
  const text = err instanceof Error ? err.message.toLowerCase() : ''
  return text.includes('credit balance') || text.includes('usage limit') || text.includes('spend limit')
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

// Everything the classifier and the actions need, loaded once per run.
// Includes every deal (not just active ones), so replies and follow-ups on
// deals marked Old still land on the right deal.
async function loadContext(supabase: SupabaseClient): Promise<Context> {
  const { accessToken, accountEmail } = await getValidAccessToken(supabase)
  const [{ data: deals }, { data: lenders }, { data: contacts }, { data: matchThreads }, { data: submissionThreads }] =
    await Promise.all([
      supabase.from('deals').select('id, company_name, contact_name, status').order('created_at', { ascending: false }),
      supabase.from('lenders').select('id, name, contact_email, mandate_notes'),
      supabase.from('lender_contacts').select('lender_id, email'),
      supabase
        .from('deal_matches')
        .select('deal_id, lender_id, outlook_conversation_id')
        .not('outlook_conversation_id', 'is', null),
      supabase
        .from('deal_submissions')
        .select('deal_id, lender_id, outlook_conversation_id')
        .not('outlook_conversation_id', 'is', null),
    ])
  const threads = [...(matchThreads ?? []), ...(submissionThreads ?? [])]

  const refDeals = (deals ?? []).map((d, i) => ({ ...d, ref: `D${i + 1}` }))
  const lenderByEmail = new Map<string, string>()
  for (const l of lenders ?? []) if (l.contact_email) lenderByEmail.set(l.contact_email.toLowerCase(), l.id)
  for (const c of contacts ?? []) if (c.email) lenderByEmail.set(c.email.toLowerCase(), c.lender_id)

  return {
    accessToken,
    accountEmail: accountEmail.toLowerCase(),
    deals: refDeals,
    dealByRef: new Map(refDeals.map((d) => [d.ref, d])),
    dealById: new Map(refDeals.map((d) => [d.id, d])),
    lenderById: new Map((lenders ?? []).map((l) => [l.id, l])),
    lenderByEmail,
    threadByConversation: new Map(
      threads.map((t) => [t.outlook_conversation_id as string, { dealId: t.deal_id, lenderId: t.lender_id }])
    ),
  }
}

// Classifies one email and acts on it. Returns what to record; throws only
// on billing errors (so the caller stops instead of losing emails).
async function processMessage(
  supabase: SupabaseClient,
  ctx: Context,
  message: InboxMessage
): Promise<{ counter: Counter; record: Record<string, unknown> }> {
  // The mailbox's own messages and obvious robots never cost an AI call.
  if (message.from === ctx.accountEmail || isAutomatedSender(message.from)) {
    return { counter: 'other', record: { classification: 'other', action_taken: 'Skipped (automated or own message)' } }
  }

  try {
    const thread = ctx.threadByConversation.get(message.conversationId) ?? null
    const senderLenderId = ctx.lenderByEmail.get(message.from) ?? null
    const attachments = message.hasAttachments ? await getMessageAttachments(ctx.accessToken, message.id) : []

    const classification = await classifyEmail(
      message,
      attachments.map((a) => a.name),
      {
        deals: ctx.deals.map((d) => ({
          ref: d.ref,
          company_name: d.company_name,
          contact_name: d.contact_name,
          status: d.status,
        })),
        senderLenderName: senderLenderId ? (ctx.lenderById.get(senderLenderId)?.name ?? null) : null,
        threadDealCompany: thread ? (ctx.dealById.get(thread.dealId)?.company_name ?? null) : null,
        threadLenderName: thread ? (ctx.lenderById.get(thread.lenderId)?.name ?? null) : null,
      },
      supabase
    )

    return await act({ supabase, ctx, message, classification, attachments, thread, senderLenderId })
  } catch (err) {
    if (isBillingError(err)) throw err
    return {
      counter: 'errors',
      record: {
        classification: 'error',
        action_taken: err instanceof Error ? err.message.slice(0, 500) : 'Processing failed',
      },
    }
  }
}

function baseRecord(message: InboxMessage) {
  return {
    graph_message_id: message.id,
    conversation_id: message.conversationId,
    from_email: message.from,
    subject: message.subject,
    received_at: message.receivedDateTime,
  }
}

// Reads new inbox mail since the last run, has Claude decide what each
// email is, and acts on it: new deals are created (with their attachments
// uploaded), follow-ups are logged on the existing deal, and lender replies
// are logged on the deal they answer. Every email is recorded once in
// inbox_messages, and progress is saved after each one, so a run that hits
// the time limit simply continues next time. Works with either a signed-in
// client (manual run) or the admin client (scheduled run).
// Everything received after this point hasn't been read by the CRM yet.
function readThrough(state: { last_synced_at: string | null } | null) {
  return (
    state?.last_synced_at ??
    new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  )
}

// Free (no AI): newest email in the inbox vs. how far the CRM has read.
export async function getSyncStatus(supabase: SupabaseClient) {
  const { data: state } = await supabase.from('inbox_sync_state').select('last_synced_at').eq('id', 1).single()
  const since = readThrough(state)
  const { accessToken } = await getValidAccessToken(supabase)
  const status = await getInboxStatus(accessToken, since)
  return { readThrough: since, hasRunBefore: Boolean(state?.last_synced_at), ...status }
}

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
  const since = readThrough(state)

  await supabase
    .from('inbox_sync_state')
    .update({ last_run_at: new Date().toISOString(), last_run_status: 'running', last_error: null })
    .eq('id', 1)

  try {
    const ctx = await loadContext(supabase)
    const messages = await listInboxMessagesSince(ctx.accessToken, since, maxMessages)
    summary.moreWaiting = messages.length === maxMessages

    const { data: already } = await supabase
      .from('inbox_messages')
      .select('graph_message_id')
      .in('graph_message_id', messages.map((m) => m.id).concat('none'))
    const seen = new Set((already ?? []).map((r) => r.graph_message_id))

    for (const message of messages) {
      if (!seen.has(message.id)) {
        const outcome = await processMessage(supabase, ctx, message)
        await supabase.from('inbox_messages').insert({ ...baseRecord(message), ...outcome.record })
        summary[outcome.counter]++
        summary.processed++
      }
      await supabase.from('inbox_sync_state').update({ last_synced_at: message.receivedDateTime }).eq('id', 1)
    }

    await supabase
      .from('inbox_sync_state')
      .update({
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

// Re-reads one already-recorded email (e.g. a lender reply that couldn't
// be matched to a deal before) and replaces its record with the new result.
export async function reprocessInboxMessage(supabase: SupabaseClient, inboxMessageId: string) {
  const { data: row } = await supabase
    .from('inbox_messages')
    .select('id, graph_message_id')
    .eq('id', inboxMessageId)
    .single()
  if (!row) throw new Error('Email record not found')

  const ctx = await loadContext(supabase)
  const message = await getInboxMessage(ctx.accessToken, row.graph_message_id)
  const outcome = await processMessage(supabase, ctx, message)

  await supabase
    .from('inbox_messages')
    .update({ deal_id: null, lender_id: null, summary: null, ...baseRecord(message), ...outcome.record })
    .eq('id', row.id)

  return outcome.record
}

async function saveAttachments(
  supabase: SupabaseClient,
  dealId: string,
  attachments: Awaited<ReturnType<typeof getMessageAttachments>>
) {
  // Threads often repeat the same files in every reply; skip anything this
  // deal already has (same name and size).
  const { data: existingDocs } = await supabase.from('documents').select('file_name, file_size').eq('deal_id', dealId)
  const have = new Set((existingDocs ?? []).map((d) => `${d.file_name}|${d.file_size}`))

  let saved = 0
  for (const a of attachments) {
    if (!KEEP_EXT.test(a.name) || a.size > MAX_ATTACHMENT_BYTES) continue
    const bytes = Buffer.from(a.contentBytes, 'base64')
    const key = `${a.name}|${bytes.byteLength}`
    if (have.has(key)) continue

    const storagePath = `${dealId}/${Date.now()}-${a.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
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
    have.add(key)
    saved++
  }
  return saved
}

async function act({
  supabase,
  ctx,
  message,
  classification,
  attachments,
  thread,
  senderLenderId,
}: {
  supabase: SupabaseClient
  ctx: Context
  message: InboxMessage
  classification: EmailClassification
  attachments: Awaited<ReturnType<typeof getMessageAttachments>>
  thread: { dealId: string; lenderId: string } | null
  senderLenderId: string | null
}): Promise<{ counter: Counter; record: Record<string, unknown> }> {
  const sender = message.fromName || message.from

  // A reply inside a thread the CRM itself started is a lender reply no
  // matter what the model thought.
  const kind = thread ? 'lender_reply' : classification.kind

  if (kind === 'lender_reply') {
    const reply = classification.lender_reply
    const dealId = thread?.dealId ?? (reply?.deal_ref ? ctx.dealByRef.get(reply.deal_ref)?.id : undefined) ?? null
    const lenderId = thread?.lenderId ?? senderLenderId
    const lender = lenderId ? ctx.lenderById.get(lenderId) : undefined
    const outcomeLabel = reply ? OUTCOME_LABELS[reply.outcome] : 'Replied'
    const summaryText = reply?.summary ?? classification.reason

    if (!dealId) {
      return {
        counter: 'lenderReplies',
        record: {
          classification: 'lender_reply',
        body_text: message.bodyText,
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
    await supabase
      .from('deal_updates')
      .insert({ deal_id: dealId, lender_id: lenderId, entry_date: today(), note, source: 'email' })

    const actions = ['Logged on deal']
    const deal = ctx.dealById.get(dealId)
    if (lenderId) {
      // Puts the lender on the deal's "Lenders sent to" list (or updates its
      // status there) and remembers this thread for future replies.
      const { movedFrom } = await recordSubmission(supabase, {
        dealId,
        lenderId,
        status: reply ? OUTCOME_TO_SUBMISSION[reply.outcome] : undefined,
        conversationId: message.conversationId,
      })
      ctx.threadByConversation.set(message.conversationId, { dealId, lenderId })
      actions.push(`lender status updated${reply && OUTCOME_TO_SUBMISSION[reply.outcome] ? ` to ${outcomeLabel}` : ''}`)
      if (movedFrom && deal) {
        actions.push(movedFrom === 'old' ? 'moved from Old back to Submitted' : 'moved to Submitted')
        deal.status = 'submitted'
      }
    } else if (deal && ADVANCE_ON_LENDER_REPLY.includes(deal.status)) {
      await supabase.from('deals').update({ status: 'submitted' }).eq('id', dealId)
      actions.push(deal.status === 'old' ? 'moved from Old back to Submitted' : 'moved to Submitted')
      deal.status = 'submitted'
    }

    if (reply?.mandate_notes && lender) {
      const stamped = `[${today()} from email] ${reply.mandate_notes}`
      lender.mandate_notes = lender.mandate_notes ? `${lender.mandate_notes}\n${stamped}` : stamped
      await supabase.from('lenders').update({ mandate_notes: lender.mandate_notes }).eq('id', lender.id)
      actions.push('added to lender mandate notes')
    }

    return {
      counter: 'lenderReplies',
      record: {
        classification: 'lender_reply',
        body_text: message.bodyText,
        deal_id: dealId,
        lender_id: lenderId,
        summary: `${outcomeLabel}: ${summaryText}`,
        action_taken: actions.join(', '),
      },
    }
  }

  if (kind === 'new_deal' && classification.new_deal) {
    const d = classification.new_deal
    const existing = d.existing_deal_ref ? ctx.dealByRef.get(d.existing_deal_ref) : undefined

    let dealId: string
    let counter: Counter
    const actions: string[] = []
    if (existing) {
      dealId = existing.id
      counter = 'dealUpdates'
      actions.push('Added to existing deal')
      // The borrower is still engaged, so an Old deal is active again.
      if (existing.status === 'old') {
        await supabase.from('deals').update({ status: 'in_review' }).eq('id', dealId)
        existing.status = 'in_review'
        actions.push('moved from Old back to In review')
      }
    } else {
      const { data: created, error } = await supabase
        .from('deals')
        .insert({
          company_name: d.company_name,
          contact_name: d.contact_name,
          // Only fall back to the sender when the sender IS the borrower —
          // a broker's email/phone must never become the deal contact.
          contact_email: d.contact_email ?? (d.sender_role === 'borrower' ? message.from : null),
          contact_phone: d.contact_phone,
          notes: d.referred_by ? `Referred by ${d.referred_by}` : null,
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
      actions.push(`Created deal "${d.company_name}"`)
      // Later emails in the same run can then match it instead of duplicating.
      const newDeal = { id: dealId, company_name: d.company_name, contact_name: d.contact_name, status: 'new', ref: `D${ctx.deals.length + 1}` }
      ctx.deals.push(newDeal)
      ctx.dealByRef.set(newDeal.ref, newDeal)
      ctx.dealById.set(dealId, newDeal)
    }

    const saved = await saveAttachments(supabase, dealId, attachments)
    const docsText = saved ? ` ${saved} new document${saved === 1 ? '' : 's'} attached.` : ''
    await supabase.from('deal_updates').insert({
      deal_id: dealId,
      entry_date: today(),
      note: existing
        ? `Follow-up email from ${sender}: "${message.subject}".${docsText} ${d.description}`
        : `Auto-imported from email from ${sender}${d.referred_by ? ` (broker/referral: ${d.referred_by})` : ''}: "${message.subject}".${docsText}`,
      source: 'email',
    })

    return {
      counter,
      record: {
        classification: 'new_deal',
        body_text: message.bodyText,
        deal_id: dealId,
        summary: d.description,
        action_taken: `${actions.join(', ')}.${docsText}`,
      },
    }
  }

  return {
    counter: 'other',
    record: { classification: 'other', summary: classification.reason, action_taken: 'No action' },
  }
}
