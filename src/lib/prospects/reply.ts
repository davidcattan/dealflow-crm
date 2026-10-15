import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { logUsage } from '@/lib/usage'
import type { Prospect } from './types'

// Cheapest model: sorting a short reply is simple — a fraction of a cent.
const MODEL = 'claude-haiku-5-5'

export const ProspectReplySchema = z.object({
  outcome: z
    .enum(['interested', 'not_interested', 'wrong_person', 'auto_reply', 'unclear'])
    .describe(
      'interested = open to talking, asks a question about financing, shares info, proposes a time, or says "maybe later/reach out in X months" with real interest. not_interested = declines, happy with current lender, asks to stop. wrong_person = says someone else handles this (may name them). auto_reply = out-of-office or other automatic reply. unclear = anything else.'
    ),
  summary: z.string().describe('One short sentence: what they said. Plain English.'),
  referral_name: z.string().describe('If they point to someone else, that person\'s name; otherwise "".'),
  referral_email: z.string().describe('That person\'s email if given; otherwise "".'),
  do_not_contact: z.boolean().describe('True only if they ask not to be emailed again / to be removed.'),
})
export type ProspectReply = z.infer<typeof ProspectReplySchema>

export async function readProspectReply(supabase: SupabaseClient, prospect: Prospect, subject: string, body: string): Promise<ProspectReply> {
  const client = new Anthropic()
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: `JED Capital Group (a debt advisory firm that arranges ABL facilities and senior secured term loans) cold-emailed ${[prospect.first_name, prospect.last_name].filter(Boolean).join(' ') || 'a contact'} (${prospect.title ?? 'title unknown'}) at ${prospect.company_display || prospect.company} about refinancing their existing facility${prospect.lender ? ` with ${prospect.lender}` : ''}. This is their reply. Sort it.

Subject: ${subject}

${body.slice(0, 4000)}`,
      },
    ],
    output_config: { effort: 'low', format: zodOutputFormat(ProspectReplySchema) },
  })
  await logUsage({ feature: 'prospect-reply', model: MODEL, dealId: null, usage: res.usage, supabase })
  if (!res.parsed_output) throw new Error('Could not read the prospect reply')
  return res.parsed_output
}
