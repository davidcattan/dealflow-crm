import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/usage'
import type { InboxMessage } from '@/lib/outlook/graph'
import { EmailClassificationSchema, TriageSchema, type EmailClassification } from './classify-schema'

// Two-stage reading, agreed with David to keep inbox cost down:
// a cheap model sorts every email; only ones that might be a deal or a
// lender reply (usually a small share of an inbox) are re-read by a
// stronger model, which does the extraction that actually changes the CRM.
// Sonnet since Oct 2026 (David's call, ~half Opus's cost) — if emails start
// getting misfiled, switch INBOX_MODEL back to 'claude-opus-5-5'.
export const TRIAGE_MODEL = 'claude-haiku-4-5-20251001'
export const INBOX_MODEL = 'claude-sonnet-5-5'

const TRIAGE_INSTRUCTIONS = `You are doing a quick first-pass sort of a debt broker's inbox. Decide whether this email could be:
- new_deal: someone presenting a financing request for a specific business, or sending more info/documents about one
- lender_reply: a lender or funder responding about a deal submitted to them
- other: clearly neither (newsletters, marketing, notifications, scheduling, personal mail)

When in doubt between other and one of the first two, choose the first two — a second, more careful reader checks everything you flag. Only choose other when you are confident.`

async function triageEmail(emailText: string, contextHint: string, supabase: SupabaseClient) {
  const client = new Anthropic()
  const structured = await client.messages.parse({
    model: TRIAGE_MODEL,
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: ['--- Email ---', emailText.slice(0, 4000), '', contextHint, '', TRIAGE_INSTRUCTIONS].join('\n'),
      },
    ],
    output_config: { format: zodOutputFormat(TriageSchema) },
  })
  await logUsage({ feature: 'inbox-triage', model: TRIAGE_MODEL, usage: structured.usage, supabase })
  return structured.parsed_output
}

function isBillingError(err: unknown) {
  const text = err instanceof Error ? err.message.toLowerCase() : ''
  return text.includes('credit balance') || text.includes('usage limit') || text.includes('spend limit')
}

const INSTRUCTIONS = `You are sorting the inbox of an asset-based lending debt broker. For the email below (after this CRM context), decide what it is and extract what the CRM needs.

- new_deal: a borrower, another broker, or a referral partner presenting a financing request for a specific business (often with financials, tax returns or a loan package attached), or sending more information about one. If the company is already in the deal list (any status, including old), set existing_deal_ref to its D#.
  The deal's contact fields are always the BORROWER (the business owner/officer), never the person who sent the email if they are a broker or referral partner. Brokers often list the borrower's name and phone in the body — use those. Put the broker's own name, firm, email and phone in referred_by instead.
- lender_reply: a lender or funder responding about a deal that was submitted to them (interest, questions, document requests, term sheet, or a pass).
- other: anything else — newsletters, a lender's marketing blast about its own programs, notifications, scheduling, internal or personal mail.

Only use facts stated in the email. Never invent a company, amount or contact. If it is ambiguous whether this is a real deal, choose other.`

export type ClassifyContext = {
  deals: { ref: string; company_name: string; contact_name: string | null; status: string; hints?: string[] }[]
  senderLenderName: string | null
  threadDealCompany: string | null
  threadLenderName: string | null
  // Set when the sender is a colleague (same email domain as the connected
  // mailbox) — their emails are never lender replies.
  internalFirmDomain?: string | null
  // The colleague forwarded someone else's email (judge the forwarded part).
  forwardedByColleague?: boolean
  // The sender is a referral partner that sends many different deals.
  referralPartner?: string | null
  // The partner also lends on small deals (e.g. Simply Capital).
  referralPartnerAlsoLends?: boolean
}

export async function classifyEmail(
  message: InboxMessage,
  attachmentNames: string[],
  context: ClassifyContext,
  supabase: SupabaseClient
): Promise<EmailClassification> {
  const client = new Anthropic()

  // About this one email (changes every time).
  const emailNotes = [
    context.threadDealCompany
      ? context.threadLenderName
        ? `This email is in the thread where deal "${context.threadDealCompany}" was submitted to lender "${context.threadLenderName}".`
        : `This email is in a thread already filed on deal "${context.threadDealCompany}".`
      : null,
    context.senderLenderName ? `The sender is a known lender in the CRM: ${context.senderLenderName}.` : null,
    context.internalFirmDomain && context.forwardedByColleague
      ? `A colleague at the user's own brokerage firm (@${context.internalFirmDomain}) FORWARDED this email. Judge it by the forwarded email, as if its original sender had sent it to the user: a business, borrower or broker presenting a financing request or sending documents/info is new_deal (set existing_deal_ref if that company is already in the list). The contact is the original sender or the business owner, never the colleague. Never classify it as lender_reply — a forwarded lender response about a deal in the list is new_deal with existing_deal_ref set. Anything else is other.`
      : context.internalFirmDomain
      ? `The sender is a colleague at the user's own brokerage firm (@${context.internalFirmDomain}) — NOT a lender. Never classify their email as lender_reply. If it is about a deal in the list (e.g. asking a borrower for documents), classify it as new_deal with existing_deal_ref set and describe what was asked or done; otherwise other.`
      : null,
    context.referralPartner && context.referralPartnerAlsoLends
      ? `The sender is ${context.referralPartner}, who BOTH refers deals to the team and lends on small deals ($300–500K) himself. If the email presents a business that needs financing, it is a new deal (put "${context.referralPartner}" in referred_by; the contact is the business owner, never ${context.referralPartner}). If it is about a deal the team sent him as a lender — asking for documents, approving, declining, offering terms — it is a lender_reply on that deal. Never match a new company to an existing deal just because ${context.referralPartner} sent it.`
      : context.referralPartner
      ? `The sender is ${context.referralPartner}, a referral partner that sends the team MANY DIFFERENT deals — not a borrower and not a lender. The email is about the company it names (e.g. a subject like "Introducing Eli — <Company>"). It is a new deal unless that same company is already in the list; never match it to another deal just because ${context.referralPartner} sent it or because the deal's contact email is theirs. The deal's contact is the business owner named in the file — never ${context.referralPartner} and never Eli Cattan or David Cattan (they are the loan officers being introduced). Put "${context.referralPartner}" plus any file number and submitter in referred_by.`
      : null,
  ].filter(Boolean)

  // The deal list is the same for every email in a check, so it's cached:
  // the 2nd, 3rd… email in a run pay a tenth for it.
  const dealList =
    context.deals.length > 0
      ? `Deals in the CRM (status in brackets; "old" deals may still be live). "also:" lists the deal's property addresses, related companies/trusts and contact email — an email mentioning any of those is about that deal:\n${context.deals
          .map(
            (d) =>
              `${d.ref}: ${d.company_name}${d.contact_name ? ` (contact: ${d.contact_name})` : ''} [${d.status}]${
                d.hints?.length ? ` — also: ${d.hints.join('; ')}` : ''
              }`
          )
          .join('\n')}`
      : 'There are no deals in the CRM.'

  const emailText = [
    `From: ${message.fromName ? `${message.fromName} <${message.from}>` : message.from}`,
    `Received: ${message.receivedDateTime}`,
    `Subject: ${message.subject}`,
    attachmentNames.length > 0 ? `Attachments: ${attachmentNames.join(', ')}` : 'Attachments: none',
    '',
    message.bodyText.slice(0, 6000),
  ].join('\n')

  // Replies inside a thread the CRM started always get the full read. For
  // everything else the cheap pass decides first. If that pass fails for
  // any reason other than billing, fall through to the full read rather
  // than risk dropping a real deal.
  if (!context.threadDealCompany) {
    const hint = context.senderLenderName ? `The sender is a known lender: ${context.senderLenderName}.` : ''
    try {
      const triage = await triageEmail(emailText, hint, supabase)
      if (triage?.kind === 'other') {
        return { kind: 'other', reason: triage.reason, new_deal: null, lender_reply: null }
      }
    } catch (err) {
      if (isBillingError(err)) throw err
      console.error('Inbox triage failed, using full read', err)
    }
  }

  // A rare malformed answer ("Failed to parse structured output") is
  // retried once instead of leaving the email unread.
  const read = () => client.messages.parse({
    model: INBOX_MODEL,
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: ['--- CRM context ---', dealList, '', INSTRUCTIONS].join('\n'), cache_control: { type: 'ephemeral' } },
          {
            type: 'text',
            text: [
              emailNotes.length ? `--- About this email ---\n${emailNotes.join('\n\n')}\n` : null,
              '--- Email ---',
              emailText,
              '',
              'Classify this email following the instructions above.',
            ]
              .filter((x) => x !== null)
              .join('\n'),
          },
        ],
      },
    ],
    output_config: { effort: 'medium', format: zodOutputFormat(EmailClassificationSchema) },
  })
  const structured = await read().catch((err) => {
    if (err instanceof Error && /Failed to parse structured output/.test(err.message)) return read()
    throw err
  })

  await logUsage({ feature: 'inbox-classify', model: INBOX_MODEL, usage: structured.usage, supabase })

  if (!structured.parsed_output) throw new Error('Could not classify the email')
  return structured.parsed_output
}

// Obvious automated senders never need an AI call.
export function isAutomatedSender(address: string) {
  return /(^|[._-])(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|alerts?)@/i.test(address)
}
