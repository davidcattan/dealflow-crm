import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/usage'
import type { InboxMessage } from '@/lib/outlook/graph'
import { EmailClassificationSchema, type EmailClassification } from './classify-schema'

// One place to change the model for inbox reading. This runs on every
// incoming email, so it's the single biggest lever on the sync's cost.
export const INBOX_MODEL = 'claude-opus-5'

const INSTRUCTIONS = `You are sorting the inbox of an asset-based lending debt broker. For the email above, decide what it is and extract what the CRM needs.

- new_deal: a borrower, another broker, or a referral partner presenting a financing request for a specific business (often with financials, tax returns or a loan package attached), or sending more information about one. If the company is already in the active deal list, set existing_deal_ref to its D#.
- lender_reply: a lender or funder responding about a deal that was submitted to them (interest, questions, document requests, term sheet, or a pass).
- other: anything else — newsletters, a lender's marketing blast about its own programs, notifications, scheduling, internal or personal mail.

Only use facts stated in the email. Never invent a company, amount or contact. If it is ambiguous whether this is a real deal, choose other.`

export type ClassifyContext = {
  activeDeals: { ref: string; company_name: string; contact_name: string | null }[]
  senderLenderName: string | null
  threadDealCompany: string | null
  threadLenderName: string | null
}

export async function classifyEmail(
  message: InboxMessage,
  attachmentNames: string[],
  context: ClassifyContext,
  supabase: SupabaseClient
): Promise<EmailClassification> {
  const client = new Anthropic()

  const contextLines = [
    context.threadDealCompany
      ? `This email is in the thread where deal "${context.threadDealCompany}" was submitted to lender "${context.threadLenderName ?? 'unknown'}".`
      : null,
    context.senderLenderName ? `The sender is a known lender in the CRM: ${context.senderLenderName}.` : null,
    context.activeDeals.length > 0
      ? `Active deals in the CRM:\n${context.activeDeals
          .map((d) => `${d.ref}: ${d.company_name}${d.contact_name ? ` (contact: ${d.contact_name})` : ''}`)
          .join('\n')}`
      : 'There are no active deals in the CRM.',
  ].filter(Boolean)

  const emailText = [
    `From: ${message.fromName ? `${message.fromName} <${message.from}>` : message.from}`,
    `Received: ${message.receivedDateTime}`,
    `Subject: ${message.subject}`,
    attachmentNames.length > 0 ? `Attachments: ${attachmentNames.join(', ')}` : 'Attachments: none',
    '',
    message.bodyText.slice(0, 6000),
  ].join('\n')

  const structured = await client.messages.parse({
    model: INBOX_MODEL,
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: [
          '--- Email ---',
          emailText,
          '',
          '--- CRM context ---',
          contextLines.join('\n\n'),
          '',
          INSTRUCTIONS,
        ].join('\n'),
      },
    ],
    output_config: { format: zodOutputFormat(EmailClassificationSchema) },
  })

  await logUsage({ feature: 'inbox-classify', model: INBOX_MODEL, usage: structured.usage, supabase })

  if (!structured.parsed_output) throw new Error('Could not classify the email')
  return structured.parsed_output
}

// Obvious automated senders never need an AI call.
export function isAutomatedSender(address: string) {
  return /(^|[._-])(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|alerts?)@/i.test(address)
}
