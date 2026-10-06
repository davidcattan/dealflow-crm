import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { createClient } from '@/lib/supabase/server'
import { logUsage } from '@/lib/usage'
import { buildDocumentContent } from '@/lib/underwriting/build-content'
import { SnapshotSchema, type Snapshot } from './schema'
import { SNAPSHOT_RULES } from './prompt'
import type { DocumentRecord } from '@/lib/types'
import { loadDealEmails, emailsToText } from '@/lib/deals/deal-emails'

// Paid path: one call, reads the documents natively and returns the
// structured snapshot. No web research, so it costs far less than the
// research-report underwriting.
export async function runSnapshot(dealId: string, signal?: AbortSignal): Promise<Snapshot> {
  const supabase = await createClient()
  const [{ data: deal, error }, { data: documents }, emails] = await Promise.all([
    supabase.from('deals').select('*').eq('id', dealId).single(),
    supabase.from('documents').select('*').eq('deal_id', dealId).order('uploaded_at', { ascending: true }),
    loadDealEmails(supabase, dealId),
  ])
  if (error || !deal) throw new Error('Deal not found')

  const { blocks, skipped } = await buildDocumentContent(supabase, (documents ?? []) as DocumentRecord[])
  const header = [
    `Company / deal: ${deal.company_name}`,
    deal.industry ? `Industry: ${deal.industry}` : null,
    deal.description ? `Deal description (from the broker): ${deal.description}` : null,
    deal.notes ? `Broker notes: ${deal.notes}` : null,
    skipped.length ? `Note: these files could not be read and are not included: ${skipped.join(', ')}` : null,
    emailsToText(emails),
  ]
    .filter(Boolean)
    .join('\n')
  const client = new Anthropic()

  const structured = await client.messages.parse(
    {
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: header },
            ...(blocks as Anthropic.ContentBlockParam[]),
            { type: 'text', text: SNAPSHOT_RULES },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(SnapshotSchema) },
    },
    { signal }
  )
  await logUsage({ feature: 'snapshot', model: 'claude-opus-5-5', dealId, usage: structured.usage })
  if (!structured.parsed_output) throw new Error('Could not build the snapshot')
  return structured.parsed_output
}

// Turns a snapshot written elsewhere (pasted from Claude.ai) into the
// structured format. One short call.
export async function structureSnapshot(text: string, dealId: string, signal?: AbortSignal): Promise<Snapshot> {
  const client = new Anthropic()
  const structured = await client.messages.parse(
    {
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      messages: [
        {
          role: 'user',
          content: `Convert the following lender snapshot into the structured format. Copy the numbers exactly as written; use null for anything not stated — never invent or estimate a number.\n\n${text}`,
        },
      ],
      output_config: { format: zodOutputFormat(SnapshotSchema) },
    },
    { signal }
  )
  await logUsage({ feature: 'snapshot', model: 'claude-opus-5-5', dealId, usage: structured.usage })
  if (!structured.parsed_output) throw new Error('Could not structure the snapshot')
  return structured.parsed_output
}
