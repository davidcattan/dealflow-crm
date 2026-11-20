import { z } from 'zod'

export const MatchSchema = z.object({
  matches: z
    .array(
      z.object({
        lender_ref: z
          .string()
          .describe('The L# reference number from the lender list, e.g. "L42"'),
        score: z
          .number()
          .min(0)
          .max(100)
          .describe('Fit score 0-100 — how well this lender matches the deal'),
        solution: z
          .string()
          .describe('Which of the deal\'s financing solutions this lender is for, in a few words, e.g. "ABL refinance", "Cash-flow term loan", "Junior capital", "Equipment term loan", "Real estate bridge".'),
        tier: z
          .enum(['best', 'good', 'long_shot'])
          .describe('"best": a lender the team should send this deal to first — clearly in its box on size, EBITDA, structure and industry. "good": a real fit with one open question. "long_shot": possible but a stretch, or would only cover part of the deal.'),
        summary: z
          .string()
          .describe('One plain line, under 20 words, for the deal page: what this lender does and why it fits, e.g. "Cash flow loans $1-7MM at 3-4x EBITDA; this deal is right in range." Mention a past term sheet or LinkedIn connection when it matters.'),
        contact: z
          .string()
          .describe('The one person at this lender to send this deal to, by name, from its "people" list (the right group for this deal). Empty string when the list has no clear choice.'),
        reasoning: z
          .string()
          .describe(
            '2-4 sentences: why this lender is a plausible fit for that solution, and any real concerns or gaps.'
          ),
      })
    )
    .describe(
      'The top 12-15 lenders for this deal across its solutions, ranked best-fit first. Return fewer only when fewer could plausibly do the deal.'
    ),
  notes: z
    .string()
    .nullable()
    .describe(
      'Start with the financing solutions this deal could realistically use, one short line each (e.g. "1. ABL refinance of Meritrust — $8-10M against AR and inventory"). Then any caveats about match quality — e.g. missing financials, ask amount unclear.'
    ),
})

export type MatchResult = z.infer<typeof MatchSchema>
