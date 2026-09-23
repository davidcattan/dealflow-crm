import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { createClient } from '@/lib/supabase/server'
import { logUsage } from '@/lib/usage'
import { buildDocumentContent, fetchWebsiteText } from './build-content'
import { UnderwritingSchema, type Underwriting } from './schema'
import { RESEARCH_INSTRUCTIONS } from './prompt'
import type { DocumentRecord } from '@/lib/types'

export async function runUnderwriting(
  dealId: string,
  signal?: AbortSignal
): Promise<Underwriting> {
  const supabase = await createClient()

  const [{ data: deal, error: dealError }, { data: documents }] = await Promise.all([
    supabase.from('deals').select('*').eq('id', dealId).single(),
    supabase
      .from('documents')
      .select('*')
      .eq('deal_id', dealId)
      .order('uploaded_at', { ascending: true }),
  ])

  if (dealError || !deal) {
    throw new Error('Deal not found')
  }

  const { blocks: documentBlocks, skipped } = await buildDocumentContent(
    supabase,
    (documents ?? []) as DocumentRecord[]
  )

  const websiteText = deal.website ? await fetchWebsiteText(deal.website) : null

  const client = new Anthropic()

  const introText = [
    `Company: ${deal.company_name}`,
    `Industry: ${deal.industry ?? 'unknown'}`,
    `Website: ${deal.website ?? 'none provided'}`,
    deal.notes ? `Broker notes: ${deal.notes}` : null,
    skipped.length > 0
      ? `Note: the following uploaded files could not be analyzed and are not included below: ${skipped.join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')

  const researchContent: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: 'text', text: introText },
    ...(websiteText
      ? [{ type: 'text' as const, text: `--- Company website content ---\n${websiteText}` }]
      : []),
    ...(documentBlocks as Anthropic.Beta.BetaContentBlockParam[]),
    { type: 'text', text: RESEARCH_INSTRUCTIONS },
  ]

  const runner = client.beta.messages.toolRunner({
    model: 'claude-opus-5',
    max_tokens: 16000,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
    messages: [{ role: 'user', content: researchContent }],
  }, { signal })

  // Each step's usage is logged the moment it arrives, so a run that gets
  // stopped or times out is still counted — Anthropic bills for it anyway.
  for await (const message of runner) {
    await logUsage({ feature: 'underwriting', model: 'claude-opus-5', dealId, usage: message.usage as never })
    if (message.stop_reason === 'pause_turn') {
      runner.pushMessages({ role: 'assistant', content: message.content })
    }
  }
  const researchMessage = await runner.done()

  const researchText = researchMessage.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')

  if (!researchText) {
    throw new Error('Underwriting research produced no output')
  }

  return structureUnderwriting(researchText, dealId, signal)
}

// Turns a written underwriting analysis (from our own research step, or one
// pasted in from Claude.ai) into the structured format the app stores.
export async function structureUnderwriting(
  analysisText: string,
  dealId: string,
  signal?: AbortSignal
): Promise<Underwriting> {
  const client = new Anthropic()
  const structured = await client.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: `Convert the following underwriting analysis into the structured format. Use null for any figure not explicitly stated — never invent or estimate a number.\n\n${analysisText}`,
      },
    ],
    output_config: { format: zodOutputFormat(UnderwritingSchema) },
  }, { signal })

  await logUsage({ feature: 'underwriting', model: 'claude-opus-5', dealId, usage: structured.usage })

  if (!structured.parsed_output) {
    throw new Error('Could not structure the underwriting analysis')
  }

  return structured.parsed_output
}
