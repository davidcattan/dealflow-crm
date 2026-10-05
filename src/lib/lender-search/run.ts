import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/usage'
import { LenderSearchSchema, type LenderSearch } from './schema'
import { buildLenderSearchPrompt } from './prompt'

export async function loadLenderSearchPrompt(supabase: SupabaseClient, dealId: string) {
  const [{ data: deal }, { data: lenders }] = await Promise.all([
    supabase.from('deals').select('*').eq('id', dealId).single(),
    supabase.from('lenders').select('name'),
  ])
  if (!deal) throw new Error('Deal not found')
  return buildLenderSearchPrompt(deal, (lenders ?? []).map((l) => l.name as string))
}

// Paid path: web research (search + reading lenders' own sites), then one
// call to put the findings in the stored format. Typically ~$1–3.
export async function runLenderSearch(
  supabase: SupabaseClient,
  dealId: string,
  signal?: AbortSignal
): Promise<LenderSearch> {
  const prompt = await loadLenderSearchPrompt(supabase, dealId)
  const client = new Anthropic()

  const runner = client.beta.messages.toolRunner(
    {
      model: 'claude-opus-5',
      max_tokens: 16000,
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 12, max_content_tokens: 4000 },
      ],
      messages: [{ role: 'user', content: prompt }],
    },
    { signal }
  )
  // Log each step as it arrives so a stopped run is still counted.
  for await (const message of runner) {
    await logUsage({ feature: 'lender-search', model: 'claude-opus-5', dealId, usage: message.usage as never })
    if (message.stop_reason === 'pause_turn') runner.pushMessages({ role: 'assistant', content: message.content })
  }
  const done = await runner.done()
  const text = done.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
  if (!text) throw new Error('The lender search came back empty')
  return structureLenderSearch(text, dealId, signal)
}

// Turns written findings (ours, or pasted from Claude.ai) into the stored format.
export async function structureLenderSearch(text: string, dealId: string, signal?: AbortSignal): Promise<LenderSearch> {
  const client = new Anthropic()
  const structured = await client.messages.parse(
    {
      model: 'claude-opus-5',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: `Convert these lender research findings into the structured format. Keep only lenders that were verified on their own website; leave anything not stated as null — never invent loan sizes, states or contacts.\n\n${text}`,
        },
      ],
      output_config: { format: zodOutputFormat(LenderSearchSchema) },
    },
    { signal }
  )
  await logUsage({ feature: 'lender-search', model: 'claude-opus-5', dealId, usage: structured.usage })
  if (!structured.parsed_output) throw new Error('Could not read the lender search results')
  return structured.parsed_output
}
