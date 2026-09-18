import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { createClient } from '@/lib/supabase/server'
import { buildDocumentContent, fetchWebsiteText } from './build-content'
import { UnderwritingSchema, type Underwriting } from './schema'
import type { DocumentRecord } from '@/lib/types'

const RESEARCH_INSTRUCTIONS = `Most borrowers here are small, private, and sometimes financially distressed businesses — not public companies. It is normal and expected for a company to have no website, no news coverage, and no public footprint at all. Do not treat that as a failure; just work with whatever is actually available.

Using the documents above, the company's website content (if provided), and web search for recent news, please:

1. Research this company using web search — ownership changes, financial distress, litigation, UCC filings, liens, lawsuits, closures, or local news. Before including any search result, verify it actually matches this specific company (same industry, same location if known, plausible size) — small businesses often share names with unrelated companies elsewhere, and a name match alone is not enough. If a search turns up nothing relevant, or nothing you can confidently confirm is the same business, say so plainly rather than including a guess or an unrelated company's news.
2. Extract historical financial performance from the documents: revenue, EBITDA, net income, and cash flow for each fiscal period you can find.
3. Extract the company's current financial position from the documents: accounts receivable, inventory, equipment value, real estate value, accounts payable, and total debt — using the most recent as-of date available.
4. Identify strengths and risks relevant to an asset-based lending decision. For a distressed or thinly-documented borrower, this might mean the risks section is short on financial ratios but should still cover what's knowable: document quality/completeness itself, concentration risk, collateral condition, and anything the broker's notes flag.
5. Explicitly note any of the above data points you could NOT find in the provided documents, and say plainly if there was no meaningful public information available at all.

Write your findings as a clear, well-organized plain-text analysis. Be specific with numbers and note which document or source each figure came from. This analysis will be converted into structured data afterward, so make sure every number and finding you want captured appears explicitly in your text. Do not invent or estimate figures that are not present in the documents or a verified source — a short, honest analysis based on thin data is far more useful than a padded one.`

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
