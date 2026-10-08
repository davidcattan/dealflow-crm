import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getValidAccessToken,
  listConnections,
  listInboxMessagesSince,
  listSentMessagesSince,
  type SentMessage,
  getInboxMessage,
  getInboxStatus,
  getMessageAttachments,
  type InboxMessage,
} from '@/lib/outlook/graph'
import { classifyEmail, isAutomatedSender } from './classify'
import { OUTCOME_LABELS, type EmailClassification } from './classify-schema'
import { recordSubmission } from '@/lib/deals/submissions'
import { detectSentDrafts } from '@/lib/outlook/sent-tracking'
import { notify } from '@/lib/notifications'
import { addresses } from '@/lib/deals/duplicates'
import { ownText } from '@/lib/outlook/own-text'
import { mailboxLabel, mailboxOwner } from '@/lib/outlook/mailbox-label'
import type { Snapshot } from '@/lib/snapshot/schema'
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
type Deal = { id: string; company_name: string; contact_name: string | null; status: string; hints?: string[] }

const INACTIVE = ['dead', 'closed', 'old']

// Other names a deal goes by — property addresses, the companies/trusts in
// its snapshot, the contact's email — so an email that mentions any of
// them can be tied to the deal even if it never says the deal's name.
function dealHints(d: {
  status: string
  contact_email?: string | null
  description?: string | null
  notes?: string | null
  deal_type?: string | null
  snapshot?: unknown
}): string[] {
  if (INACTIVE.includes(d.status)) return []
  const snap = d.snapshot as Snapshot | null | undefined
  const entityNames = (snap?.entities ?? [])
    .map((e) => e.name.split(/\s+[—–(]|\s+-\s+/)[0].trim())
    .filter((n) => n.length >= 5 && !/personal|guarantor|^subject property/i.test(n))
  const text = [d.description, d.notes, d.deal_type, ...(snap?.entities ?? []).map((e) => e.name)].join(' ')
  const hints = [...addresses(text), ...entityNames, d.contact_email ?? ''].filter(Boolean)
  return [...new Set(hints)].slice(0, 6)
}

// Distinctive words of a deal name ("2nd Round Pick Holdings" → 2nd,
// round, pick). Generic words don't count.
const NAME_FILLER = new Set(['inc', 'llc', 'ltd', 'co', 'corp', 'company', 'holdings', 'group', 'the', 'and', 'of', 'services', 'solutions', 'capital', 'partners', 'enterprises', 'international', 'usa', 'america'])
function nameTokens(name: string) {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !NAME_FILLER.has(t) && (t.length >= 3 || /\d/.test(t)))
}

// Free backup when the AI can't place an email: a deal whose address,
// related company names, or own name (all its distinctive words, in any
// order — "Alchemist Dealer" finds "Dealer Alchemist") appears in the
// email. Only a single clear match counts.
function findDealByText(deals: (Deal & { ref: string })[], text: string): (Deal & { ref: string }) | null {
  const lower = text.toLowerCase()
  const words = new Set(lower.split(/[^a-z0-9]+/).filter(Boolean))
  const emailAddresses = addresses(text)
  const hits = deals.filter((d) => {
    const byHint = (d.hints ?? []).some((h) => {
      const hint = h.toLowerCase()
      if (/^\d/.test(hint)) return emailAddresses.has(hint)
      return hint.length >= 8 && lower.includes(hint)
    })
    if (byHint) return true
    if (INACTIVE.includes(d.status)) return false
    const tokens = nameTokens(d.company_name)
    return tokens.length >= 2 ? tokens.every((t) => words.has(t)) : tokens.length === 1 && tokens[0].length >= 7 && words.has(tokens[0])
  })
  return hits.length === 1 ? hits[0] : null
}
type Lender = { id: string; name: string; contact_email: string | null; mandate_notes: string | null; website?: string | null }

// Words that don't identify a lender ("Fairview Commercial Lending" → "fairview").
const LENDER_FILLER = /\b(the|commercial|lending|lender|lenders|capital|funding|finance|financial|credit|partners|group|holdings|bank|llc|inc|co|corp|company|business|advisors?)\b/g

function lenderCore(text: string) {
  return text.toLowerCase().replace(/&/g, ' and ').replace(LENDER_FILLER, ' ').replace(/[^a-z0-9]/g, '')
}

function domainOf(emailOrUrl: string | null | undefined) {
  if (!emailOrUrl) return null
  const host = emailOrUrl.includes('@') ? emailOrUrl.split('@')[1] : emailOrUrl.replace(/^https?:\/\//i, '').split('/')[0]
  return host?.toLowerCase().replace(/^www\./, '') || null
}

// Which lender sent this email when the address isn't a saved contact:
// same email/website domain as a lender, or the domain's name matches the
// lender's name ("fairviewlending.com" → "Fairview Commercial Lending").
// Only a single clear match counts.
export function findLenderBySender(
  lenders: Lender[],
  contacts: { lender_id: string; email: string | null }[],
  sender: string
): string | null {
  const domain = domainOf(sender)
  if (!domain || GENERIC_DOMAINS.has(domain)) return null
  const byDomain = new Set<string>()
  for (const l of lenders) {
    if (domainOf(l.contact_email) === domain || domainOf(l.website) === domain) byDomain.add(l.id)
  }
  for (const c of contacts) if (domainOf(c.email) === domain) byDomain.add(c.lender_id)
  if (byDomain.size === 1) return [...byDomain][0]
  if (byDomain.size > 1) return null
  const core = lenderCore(domain.split('.')[0])
  if (core.length < 4) return null
  const byName = lenders.filter((l) => {
    const c = lenderCore(l.name)
    return c.length >= 4 && (c === core || core.startsWith(c) || c.startsWith(core))
  })
  return byName.length === 1 ? byName[0].id : null
}

// What a lender's reply means for its status on the deal, from the stored
// "Outcome: summary" text (or plain wording for older records).
export function statusFromReplySummary(summary: string | null): SubmissionStatus | undefined {
  const s = (summary ?? '').toLowerCase()
  if (s.startsWith('term sheet')) return 'term_sheet'
  if (s.startsWith('declined') || /not (a loan|a fit|interested|something)|\bpass(ing)? on\b|\bdeclin|won'?t be able|unable to/.test(s)) return 'declined'
  if (s.startsWith('needs more info')) return 'needs_more_info'
  if (s.startsWith('interested')) return 'interested'
  return undefined
}

type Context = {
  accessToken: string
  accountEmail: string
  deals: (Deal & { ref: string })[]
  dealByRef: Map<string, Deal & { ref: string }>
  dealById: Map<string, Deal>
  lenderById: Map<string, Lender>
  lenderByEmail: Map<string, string>
  lenders: Lender[]
  contacts: { lender_id: string; email: string | null }[]
  threadByConversation: Map<string, { dealId: string; lenderId: string }>
  dealByConversation: Map<string, string>
  dealByContactEmail: Map<string, string>
}

function isBillingError(err: unknown) {
  const text = err instanceof Error ? err.message.toLowerCase() : ''
  return text.includes('credit balance') || text.includes('usage limit') || text.includes('spend limit')
}

// Free-mail domains never mean "same firm".
const GENERIC_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'proton.me'])

function firmDomain(sender: string, accountEmail: string): string | null {
  const domain = accountEmail.split('@')[1]
  if (!domain || GENERIC_DOMAINS.has(domain)) return null
  return sender.endsWith(`@${domain}`) ? domain : null
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

// Everything the classifier and the actions need, loaded once per run.
// Includes every deal (not just active ones), so replies and follow-ups on
// deals marked Old still land on the right deal.
async function loadContext(supabase: SupabaseClient, connectionId?: string | null): Promise<Context> {
  const { accessToken, accountEmail } = await getValidAccessToken(supabase, connectionId)
  const [{ data: deals }, { data: lenders }, { data: contacts }, { data: matchThreads }, { data: submissionThreads }] =
    await Promise.all([
      supabase
        .from('deals')
        .select('id, company_name, contact_name, contact_email, status, description, notes, deal_type, snapshot')
        .order('created_at', { ascending: false }),
      supabase.from('lenders').select('id, name, contact_email, mandate_notes, website'),
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
  // Threads whose emails were already filed on a deal (inbound or sent).
  const { data: filedThreads } = await supabase
    .from('inbox_messages')
    .select('conversation_id, deal_id')
    .not('deal_id', 'is', null)
    .not('conversation_id', 'is', null)
    .order('received_at', { ascending: false })
    .limit(3000)

  const refDeals = (deals ?? []).map((d, i) => ({
    id: d.id as string,
    company_name: d.company_name as string,
    contact_name: d.contact_name as string | null,
    status: d.status as string,
    hints: dealHints(d),
    ref: `D${i + 1}`,
  }))
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
    lenders: (lenders ?? []) as Lender[],
    contacts: (contacts ?? []) as { lender_id: string; email: string | null }[],
    threadByConversation: new Map(
      threads.map((t) => [t.outlook_conversation_id as string, { dealId: t.deal_id, lenderId: t.lender_id }])
    ),
    dealByConversation: new Map((filedThreads ?? []).map((t) => [t.conversation_id as string, t.deal_id as string])),
    dealByContactEmail: new Map(
      (deals ?? [])
        .filter((d) => d.contact_email && !INACTIVE.includes(d.status))
        .map((d) => [String(d.contact_email).toLowerCase(), d.id as string])
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
    const internalDomain = firmDomain(message.from, ctx.accountEmail)
    const thread = ctx.threadByConversation.get(message.conversationId) ?? null
    let senderLenderId = ctx.lenderByEmail.get(message.from) ?? null
    if (!senderLenderId && !internalDomain) {
      // New person at a known lender: recognize the lender and save them
      // as a contact so their next email matches instantly.
      senderLenderId = findLenderBySender(ctx.lenders, ctx.contacts, message.from)
      if (senderLenderId) {
        await supabase.from('lender_contacts').insert({ lender_id: senderLenderId, email: message.from, name: message.fromName || null })
        ctx.lenderByEmail.set(message.from, senderLenderId)
        ctx.contacts.push({ lender_id: senderLenderId, email: message.from })
      }
    }
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
          hints: d.hints,
        })),
        senderLenderName: senderLenderId ? (ctx.lenderById.get(senderLenderId)?.name ?? null) : null,
        internalFirmDomain: internalDomain,
        threadDealCompany: thread ? (ctx.dealById.get(thread.dealId)?.company_name ?? null) : null,
        threadLenderName: thread ? (ctx.lenderById.get(thread.lenderId)?.name ?? null) : null,
      },
      supabase
    )

    return await act({ supabase, ctx, message, classification, attachments, thread, senderLenderId, internal: Boolean(internalDomain) })
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

function baseRecord(message: InboxMessage, mailbox?: string) {
  return {
    graph_message_id: message.id,
    internet_message_id: message.internetMessageId,
    ...(mailbox ? { mailbox } : {}),
    conversation_id: message.conversationId,
    from_email: message.from,
    subject: message.subject,
    received_at: message.receivedDateTime,
  }
}

// Turns what an email did into an activity-feed entry (only emails that
// changed something or need a person).
async function notifyOutcome(
  supabase: SupabaseClient,
  ctx: Context,
  message: InboxMessage,
  record: Record<string, unknown>,
  mailbox?: string | null
) {
  const where = mailboxLabel(mailbox)
  const tag = where ? ` · ${where}` : ''
  const dealId = (record.deal_id as string | null | undefined) ?? null
  const lenderId = (record.lender_id as string | null | undefined) ?? null
  const dealName = dealId ? (ctx.dealById.get(dealId)?.company_name ?? 'a deal') : null
  const lenderName = lenderId ? (ctx.lenderById.get(lenderId)?.name ?? null) : null
  const sender = message.fromName || message.from
  const summary = (record.summary as string | null) ?? null
  const action = (record.action_taken as string | null) ?? ''

  switch (record.classification) {
    case 'new_deal':
      if (action.startsWith('Created deal')) {
        return notify(supabase, { kind: 'new_deal', title: `New deal: ${dealName}${tag}`, body: `From ${sender}. ${action} ${summary ?? ''}`.trim(), dealId })
      }
      return notify(supabase, { kind: 'deal_update', title: `Deal updated: ${dealName}${tag}`, body: `Email from ${sender}. ${action} ${summary ?? ''}`.trim(), dealId })
    case 'lender_reply':
      if (!dealId) {
        return notify(supabase, {
          kind: 'needs_review',
          title: `Lender reply needs a deal: ${lenderName ?? sender}${tag}`,
          body: `"${message.subject}" — couldn't tell which deal it's about. Open Settings → Inbox to retry or file it. ${summary ?? ''}`.trim(),
          lenderId,
        })
      }
      return notify(supabase, { kind: 'lender_reply', title: `${lenderName ?? sender} replied on ${dealName}${tag}`, body: `${summary ?? ''} (${action})`, dealId, lenderId })
    case 'error':
      return notify(supabase, { kind: 'needs_review', title: `Couldn't process an email from ${sender}${tag}`, body: `"${message.subject}" — ${action}. Retry it in Settings → Inbox.` })
    default:
      return
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

// Free (no AI): for each connected mailbox, its newest email vs. how far
// the CRM has read it.
export async function getSyncStatus(supabase: SupabaseClient) {
  const [{ data: state }, connections] = await Promise.all([
    supabase.from('inbox_sync_state').select('last_synced_at').eq('id', 1).single(),
    listConnections(supabase),
  ])
  const mailboxes = await Promise.all(
    connections.map(async (c) => {
      const since = readThrough({ last_synced_at: c.last_synced_at ?? null })
      try {
        const { accessToken } = await getValidAccessToken(supabase, c.id)
        return { id: c.id, account_email: c.account_email, readThrough: since, error: null, ...(await getInboxStatus(accessToken, since)) }
      } catch (err) {
        return {
          id: c.id,
          account_email: c.account_email,
          readThrough: since,
          error: err instanceof Error ? err.message : 'Could not reach this mailbox',
          newest: null,
          waiting: 0,
          waitingCapped: false,
        }
      }
    })
  )
  return {
    hasRunBefore: Boolean(state?.last_synced_at) || connections.some((c) => c.last_synced_at),
    waiting: mailboxes.reduce((n, m) => n + m.waiting, 0),
    waitingCapped: mailboxes.some((m) => m.waitingCapped),
    mailboxes,
  }
}

// Reads every connected mailbox. Each has its own progress; an email that
// reached more than one mailbox (same Internet Message-ID) is processed once.
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

  await supabase
    .from('inbox_sync_state')
    .update({ last_run_at: new Date().toISOString(), last_run_status: 'running', last_error: null })
    .eq('id', 1)

  const failures: string[] = []
  try {
    const connections = await listConnections(supabase)
    if (connections.length === 0) throw new Error('Outlook is not connected yet. Go to Settings and connect it first.')

    // First, notice CRM drafts that were sent since last time (free).
    try {
      await detectSentDrafts(supabase)
    } catch (err) {
      console.error('Sent-draft check failed', err)
    }

    for (const connection of connections) {
      try {
        await syncMailbox(supabase, connection, maxMessages, summary)
      } catch (err) {
        if (isBillingError(err)) throw err
        failures.push(`${connection.account_email}: ${err instanceof Error ? err.message : 'failed'}`)
      }
    }

    const latest = connections
      .map((c) => c.last_synced_at)
      .filter(Boolean)
      .sort()
      .pop()
    await supabase
      .from('inbox_sync_state')
      .update({
        ...(latest ? { last_synced_at: latest } : {}),
        last_run_status: `Processed ${summary.processed}: ${summary.newDeals} new deals, ${summary.dealUpdates} deal follow-ups, ${summary.lenderReplies} lender replies, ${summary.other} other${summary.errors ? `, ${summary.errors} errors` : ''}${summary.moreWaiting ? ' (more waiting)' : ''}`,
        last_error: failures.length ? failures.join(' | ') : null,
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

async function syncMailbox(
  supabase: SupabaseClient,
  connection: { id: string; account_email: string; last_synced_at?: string | null },
  maxMessages: number,
  summary: SyncSummary
) {
  const since = readThrough({ last_synced_at: connection.last_synced_at ?? null })
  const ctx = await loadContext(supabase, connection.id)
  const messages = await listInboxMessagesSince(ctx.accessToken, since, maxMessages)
  if (messages.length === maxMessages) summary.moreWaiting = true

  const internetIds = messages.map((m) => m.internetMessageId).filter((x): x is string => Boolean(x))
  const [{ data: byGraphId }, { data: byInternetId }] = await Promise.all([
    supabase.from('inbox_messages').select('graph_message_id').in('graph_message_id', messages.map((m) => m.id).concat('none')),
    supabase.from('inbox_messages').select('internet_message_id').in('internet_message_id', internetIds.concat('none')),
  ])
  const seen = new Set([
    ...(byGraphId ?? []).map((r) => r.graph_message_id as string),
    ...(byInternetId ?? []).map((r) => r.internet_message_id as string),
  ])

  for (const message of messages) {
    const already = seen.has(message.id) || (message.internetMessageId ? seen.has(message.internetMessageId) : false)
    if (!already) {
      const outcome = await processMessage(supabase, ctx, message)
      await supabase.from('inbox_messages').insert({ ...baseRecord(message, connection.account_email), ...outcome.record })
      await notifyOutcome(supabase, ctx, message, outcome.record, connection.account_email)
      if (message.internetMessageId) seen.add(message.internetMessageId)
      summary[outcome.counter]++
      summary.processed++
    }
    await supabase.from('outlook_connections').update({ last_synced_at: message.receivedDateTime }).eq('id', connection.id)
    connection.last_synced_at = message.receivedDateTime
  }

  // Then the Sent folder (free — no AI).
  try {
    await syncSentMailbox(supabase, ctx, connection, maxMessages, summary)
  } catch (err) {
    console.error('Sent-folder sync failed', connection.account_email, err)
  }
}


// Reads one mailbox's Sent folder and files emails on deals: sends to
// lenders put the lender on "Lenders sent to" (and are logged + shown in
// Activity); emails to borrowers are logged on their deal. Emails only
// between teammates are skipped. Matching: the thread, the recipient (deal
// contact), or the deal's address/company names in the email.
async function syncSentMailbox(
  supabase: SupabaseClient,
  ctx: Context,
  connection: { id: string; account_email: string; last_sent_synced_at?: string | null },
  maxMessages: number,
  summary: SyncSummary
) {
  // Needs migration 028 (the column exists, even if empty); otherwise skip.
  if (!('last_sent_synced_at' in connection)) return
  const since = connection.last_sent_synced_at ?? new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  const messages = await listSentMessagesSince(ctx.accessToken, since, maxMessages)
  if (messages.length === maxMessages) summary.moreWaiting = true

  const internetIds = messages.map((m) => m.internetMessageId).filter((x): x is string => Boolean(x))
  const { data: seenRows } = await supabase
    .from('inbox_messages')
    .select('internet_message_id')
    .in('internet_message_id', internetIds.concat('none'))
  const seen = new Set((seenRows ?? []).map((r) => r.internet_message_id as string))
  const firm = ctx.accountEmail.split('@')[1]

  for (const m of messages) {
    if (!(m.internetMessageId && seen.has(m.internetMessageId))) {
      await fileSentMessage(supabase, ctx, connection.account_email, m, firm)
      if (m.internetMessageId) seen.add(m.internetMessageId)
    }
    await supabase.from('outlook_connections').update({ last_sent_synced_at: m.sentDateTime }).eq('id', connection.id)
    connection.last_sent_synced_at = m.sentDateTime
  }
}

async function fileSentMessage(supabase: SupabaseClient, ctx: Context, mailbox: string, m: SentMessage, firm: string | undefined) {
  const external = m.to.filter((r) => !(firm && r.email.endsWith(`@${firm}`)) && r.email !== ctx.accountEmail)
  if (external.length === 0) return // teammates only

  // Lenders among the recipients (saving new people at known lenders).
  const lenderIds: string[] = []
  for (const r of external) {
    let id = ctx.lenderByEmail.get(r.email) ?? null
    if (!id) {
      id = findLenderBySender(ctx.lenders, ctx.contacts, r.email)
      if (id) {
        await supabase.from('lender_contacts').insert({ lender_id: id, email: r.email, name: r.name || null })
        ctx.lenderByEmail.set(r.email, id)
        ctx.contacts.push({ lender_id: id, email: r.email })
      }
    }
    if (id && !lenderIds.includes(id)) lenderIds.push(id)
  }

  const dealId =
    ctx.threadByConversation.get(m.conversationId)?.dealId ??
    ctx.dealByConversation.get(m.conversationId) ??
    external.map((r) => ctx.dealByContactEmail.get(r.email)).find(Boolean) ??
    findDealByText(ctx.deals, `${m.subject}\n${m.bodyText}`)?.id ??
    null

  // Nothing to do with a deal or a lender — e.g. personal mail.
  if (!dealId && lenderIds.length === 0) return

  const deal = dealId ? ctx.dealById.get(dealId) : undefined
  const names = external.map((r) => r.name || r.email).join(', ')
  const preview = ownText(m.bodyText).replace(/\s+/g, ' ').slice(0, 220)
  const actions: string[] = []
  const { data: recorded, error: recordError } = await supabase.from('inbox_messages').insert({
    graph_message_id: m.id,
    internet_message_id: m.internetMessageId,
    conversation_id: m.conversationId,
    mailbox,
    from_email: mailbox,
    to_emails: external.map((r) => r.email).join(', '),
    subject: m.subject,
    received_at: m.sentDateTime,
    classification: 'sent',
    deal_id: dealId,
    lender_id: lenderIds[0] ?? null,
    summary: preview || null,
    body_text: m.bodyText,
    action_taken: 'Filing…',
  }).select('id').single()
  // Couldn't record it (e.g. already recorded) — don't log anything twice.
  if (recordError || !recorded) return


  if (dealId) {
    if (lenderIds.length) {
      for (const lenderId of lenderIds) {
        const lender = ctx.lenderById.get(lenderId)
        await recordSubmission(supabase, { dealId, lenderId, conversationId: m.conversationId, sentOn: m.sentDateTime.slice(0, 10) })
        ctx.threadByConversation.set(m.conversationId, { dealId, lenderId })
        await supabase.from('deal_updates').insert({
          deal_id: dealId,
          lender_id: lenderId,
          entry_date: m.sentDateTime.slice(0, 10),
          note: `Email sent to ${lender?.name ?? 'lender'}: "${m.subject}".`,
          source: 'email',
        })
        await notify(supabase, {
          kind: 'sent',
          title: `Sent: ${deal?.company_name ?? 'deal'} → ${lender?.name ?? 'lender'}`,
          body: `"${m.subject}" — sent by ${mailboxOwner(mailbox) ?? 'your team'}.`,
          dealId,
          lenderId,
        })
      }
      actions.push(`Logged on deal; ${lenderIds.length} lender${lenderIds.length === 1 ? '' : 's'} on "Lenders sent to"`)
    } else {
      await supabase.from('deal_updates').insert({
        deal_id: dealId,
        entry_date: m.sentDateTime.slice(0, 10),
        note: `Email sent to ${names}: "${m.subject}".${preview ? ` ${preview}` : ''}`,
        source: 'email',
      })
      actions.push('Logged on deal')
    }
    ctx.dealByConversation.set(m.conversationId, dealId)
  } else {
    actions.push("Sent to a lender — couldn't tell which deal; add it to a deal if it belongs to one")
  }


  await supabase.from('inbox_messages').update({ action_taken: actions.join(', ') }).eq('id', recorded.id)
}

// Re-reads one already-recorded email (e.g. a lender reply that couldn't
// be matched to a deal before) and replaces its record with the new result.
export async function reprocessInboxMessage(supabase: SupabaseClient, inboxMessageId: string) {
  const { data: row } = await supabase
    .from('inbox_messages')
    .select('id, graph_message_id, mailbox')
    .eq('id', inboxMessageId)
    .single()
  if (!row) throw new Error('Email record not found')

  // Old records have no mailbox — they all came from the first one connected.
  const connections = await listConnections(supabase)
  const source = connections.find((c) => row.mailbox && c.account_email.toLowerCase() === String(row.mailbox).toLowerCase()) ?? connections[0]
  const ctx = await loadContext(supabase, source?.id)
  const message = await getInboxMessage(ctx.accessToken, row.graph_message_id)
  const outcome = await processMessage(supabase, ctx, message)

  await supabase
    .from('inbox_messages')
    .update({ deal_id: null, lender_id: null, summary: null, ...baseRecord(message, source?.account_email), ...outcome.record })
    .eq('id', row.id)
  await notifyOutcome(supabase, ctx, message, outcome.record, source?.account_email)

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
  internal,
}: {
  supabase: SupabaseClient
  ctx: Context
  message: InboxMessage
  classification: EmailClassification
  attachments: Awaited<ReturnType<typeof getMessageAttachments>>
  thread: { dealId: string; lenderId: string } | null
  senderLenderId: string | null
  internal: boolean
}): Promise<{ counter: Counter; record: Record<string, unknown> }> {
  const sender = message.fromName || message.from

  // A reply inside a thread the CRM itself started is a lender reply no
  // matter what the model thought.
  const kind = thread ? 'lender_reply' : classification.kind

  // Safety net: a colleague's email is never a lender reply. Log it on the
  // deal (if the model named one) as an internal note, with no status moves.
  if (internal && kind === 'lender_reply') {
    const ref = classification.lender_reply?.deal_ref
    const dealId = ref ? (ctx.dealByRef.get(ref)?.id ?? null) : null
    const summaryText = classification.lender_reply?.summary ?? classification.reason
    if (dealId) {
      await supabase.from('deal_updates').insert({
        deal_id: dealId,
        entry_date: today(),
        note: `Internal email from ${sender}: ${summaryText}`,
        source: 'email',
      })
    }
    return {
      counter: 'other',
      record: {
        classification: 'other',
        deal_id: dealId,
        body_text: dealId ? message.bodyText : null,
        summary: summaryText,
        action_taken: dealId ? 'Internal email — logged on deal' : 'Internal email — no action',
      },
    }
  }

  if (kind === 'lender_reply') {
    const reply = classification.lender_reply
    const dealId =
      thread?.dealId ??
      (reply?.deal_ref ? ctx.dealByRef.get(reply.deal_ref)?.id : undefined) ??
      findDealByText(ctx.deals, `${message.subject}\n${message.bodyText}`)?.id ??
      null
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
          summary: `${outcomeLabel}: ${summaryText}`,
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
    const existing =
      (d.existing_deal_ref ? ctx.dealByRef.get(d.existing_deal_ref) : undefined) ??
      findDealByText(ctx.deals, `${message.subject}\n${message.bodyText}`) ??
      undefined

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

// A person files an email on a deal by hand (no AI). Logs it on the deal,
// saves its attachments, and for a lender reply puts the lender on the
// deal's "Lenders sent to" list and remembers the thread so later replies
// match on their own.
export async function assignInboxMessageToDeal(supabase: SupabaseClient, inboxMessageId: string, dealId: string) {
  const { data: row } = await supabase
    .from('inbox_messages')
    .select('id, graph_message_id, mailbox, classification, from_email, to_emails, subject, summary, lender_id, conversation_id, body_text, deal_id')
    .eq('id', inboxMessageId)
    .single()
  if (!row) throw new Error('Email record not found')
  const { data: deal } = await supabase.from('deals').select('id, company_name').eq('id', dealId).single()
  if (!deal) throw new Error('Deal not found')

  const alreadyHere = row.deal_id === dealId
  const isLenderReply = row.classification === 'lender_reply'

  // Which lender: the one already recorded, else recognize it from the
  // sender's email (and save the sender as that lender's contact).
  const isSent = row.classification === 'sent'
  let lenderId = row.lender_id as string | null
  const lookupEmails = isSent ? String(row.to_emails ?? '').split(',').map((e) => e.trim()).filter(Boolean) : [row.from_email]
  if (!lenderId && (isLenderReply || isSent) && lookupEmails.length) {
    const [{ data: lenders }, { data: contacts }] = await Promise.all([
      supabase.from('lenders').select('id, name, contact_email, mandate_notes, website'),
      supabase.from('lender_contacts').select('lender_id, email'),
    ])
    for (const email of lookupEmails) {
      lenderId = findLenderBySender((lenders ?? []) as Lender[], contacts ?? [], email)
      if (lenderId) {
        if (!(contacts ?? []).some((c) => c.email?.toLowerCase() === email.toLowerCase()))
          await supabase.from('lender_contacts').insert({ lender_id: lenderId, email })
        break
      }
    }
  }
  const { data: lender } = lenderId
    ? await supabase.from('lenders').select('id, name').eq('id', lenderId).single()
    : { data: null }
  const who = lender?.name ?? row.from_email ?? 'someone'
  const summary = row.summary ? ` ${row.summary}` : ''

  if (!alreadyHere) {
    await supabase.from('deal_updates').insert({
      deal_id: dealId,
      lender_id: lender?.id ?? null,
      entry_date: today(),
      note: isLenderReply
        ? `Lender reply — ${who}:${summary}`
        : isSent
          ? `Email sent to ${lender?.name ?? row.to_emails ?? 'recipient'}: "${row.subject ?? ''}".`
          : `Email from ${who}: "${row.subject ?? ''}".${summary}`,
      source: 'email',
    })
  }

  const actions = [`Filed on deal by hand`]
  if ((isLenderReply || isSent) && lender) {
    await recordSubmission(supabase, {
      dealId,
      lenderId: lender.id,
      conversationId: row.conversation_id,
      status: isSent ? undefined : statusFromReplySummary(row.summary),
    })
    actions.push(`${lender.name} added to "Lenders sent to"`)
  }

  // Attachments and full text from Outlook (free) — best effort.
  let bodyText = row.body_text as string | null
  try {
    const connections = await listConnections(supabase)
    const source =
      connections.find((c) => row.mailbox && c.account_email.toLowerCase() === String(row.mailbox).toLowerCase()) ?? connections[0]
    if (source) {
      const { accessToken } = await getValidAccessToken(supabase, source.id)
      const message = await getInboxMessage(accessToken, row.graph_message_id)
      bodyText = bodyText ?? message.bodyText
      if (message.hasAttachments) {
        const saved = await saveAttachments(supabase, dealId, await getMessageAttachments(accessToken, message.id))
        if (saved) actions.push(`${saved} attachment${saved === 1 ? '' : 's'} saved`)
      }
    }
  } catch {
    // Email no longer reachable in Outlook — the log entry is still made.
  }

  await supabase
    .from('inbox_messages')
    .update({ deal_id: dealId, lender_id: lender?.id ?? null, body_text: bodyText, action_taken: actions.join(', ') })
    .eq('id', row.id)

  if (!alreadyHere) await notify(supabase, {
    kind: isLenderReply ? 'lender_reply' : 'deal_update',
    title: `${isLenderReply ? `${who} replied on ${deal.company_name}` : `Deal updated: ${deal.company_name}`}${
      mailboxLabel(row.mailbox as string | null, isSent) ? ` · ${mailboxLabel(row.mailbox as string | null, isSent)}` : ''
    }`,
    body: `${row.subject ? `"${row.subject}" — ` : ''}${row.summary ?? ''} (filed by hand)`,
    dealId,
    lenderId: lender?.id ?? null,
  })
  return actions.join(', ')
}
