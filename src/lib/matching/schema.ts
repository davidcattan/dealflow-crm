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
        reasoning: z
          .string()
          .describe(
            '2-4 sentences: why this lender is a plausible fit, and any real concerns or gaps.'
          ),
      })
    )
    .describe(
      'Between 1 and 10 realistic candidate lenders, ranked best-fit first. Do not pad the list with weak fits just to reach 10 — return fewer if fewer are genuinely plausible.'
    ),
  notes: z
    .string()
    .nullable()
    .describe(
      'Caveats about match quality overall — e.g. missing financials, ask amount unclear from the deal notes.'
    ),
})

export type MatchResult = z.infer<typeof MatchSchema>
