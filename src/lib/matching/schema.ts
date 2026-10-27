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
        reasoning: z
          .string()
          .describe(
            '2-4 sentences: why this lender is a plausible fit for that solution, and any real concerns or gaps.'
          ),
      })
    )
    .describe(
      'Up to 15 realistic candidate lenders across the deal\'s solutions, ranked best-fit first — the strongest few for each solution. Do not pad the list with weak fits; return fewer if fewer are genuinely plausible.'
    ),
  notes: z
    .string()
    .nullable()
    .describe(
      'Start with the financing solutions this deal could realistically use, one short line each (e.g. "1. ABL refinance of Meritrust — $8-10M against AR and inventory"). Then any caveats about match quality — e.g. missing financials, ask amount unclear.'
    ),
})

export type MatchResult = z.infer<typeof MatchSchema>
