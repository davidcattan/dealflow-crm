import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { createClient } from '@/lib/supabase/server'
import { buildDocumentContent, fetchWebsiteText } from './build-content'
import { UnderwritingSchema, type Underwriting } from './schema'
import type { DocumentRecord } from '@/lib/types'

const RESEARCH_INSTRUCTIONS = `Using the documents above, the company's website content (if provided), and web search for recent news, please:

1. Research recent news about this company using web search — ownership changes, financial distress, expansion, litigation, leadership changes, or industry trends that affect it.
2. Extract historical financial performance from the documents: revenue, EBITDA, net income, and cash flow for each fiscal period you can find.
3. Extract the company's current financial position from the documents: accounts receivable, inventory, equipment value, real estate value, accounts payable, and total debt — using the most recent as-of date available.
4. Identify strengths and risks relevant to an asset-based lending decision.
5. Explicitly note any of the above data points you could NOT find in the provided documents.

Write your findings as a clear, well-organized plain-text analysis. Be specific with numbers and note which document or source each figure came from. This analysis will be converted into structured data afterward, so make sure every number and finding you want captured appears explicitly in your text. Do not invent or estimate figures that are not present in the documents or a cited source.`

export async function runUnderwriting(borrowerId: string): Promise<Underwriting> {
  const supabase = await createClient()

  const [{ data: borrower, error: borrowerError }, { data: documents }] = await Promise.all([
    supabase.from('borrowers').select('*').eq('id', borrowerId).single(),
    supabase
      .from('documents')
      .select('*')
      .eq('borrower_id', borrowerId)
      .order('uploaded_at', { ascending: true }),
  ])

  if (borrowerError || !borrower) {
    throw new Error('Borrower not found')
  }

  const { blocks: documentBlocks, skipped } = await buildDocumentContent(
    supabase,
    (documents ?? []) as DocumentRecord[]
  )

  const websiteText = borrower.website ? await fetchWebsiteText(borrower.website) : null

  const client = new Anthropic()

  const introText = [
    `Company: ${borrower.company_name}`,
    `Industry: ${borrower.industry ?? 'unknown'}`,
    `Website: ${borrower.website ?? 'none provided'}`,
    borrower.notes ? `Broker notes: ${borrower.notes}` : null,
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
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
    messages: [{ role: 'user', content: researchContent }],
  })

  for await (const message of runner) {
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

  const structured = await client.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: `Convert the following underwriting analysis into the structured format. Use null for any figure not explicitly stated — never invent or estimate a number.\n\n${researchText}`,
      },
    ],
    output_config: { format: zodOutputFormat(UnderwritingSchema) },
  })

  if (!structured.parsed_output) {
    throw new Error('Could not structure the underwriting analysis')
  }

  return structured.parsed_output
}
