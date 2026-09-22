import { z } from 'zod'
import { INDUSTRY_CATEGORIES } from './categories'

export const IndustryBackfillSchema = z.object({
  classifications: z
    .array(
      z.object({
        deal_ref: z
          .string()
          .describe('The D# reference from the list, e.g. "D12"'),
        industry: z
          .enum(INDUSTRY_CATEGORIES)
          .nullable()
          .describe(
            'One of the fixed industry categories — pick the closest fit rather than inventing a new one. Use "Other" for a real but uncommon industry, and null only if the company name, notes, and ask genuinely give no signal at all.'
          ),
      })
    )
    .describe(
      'One entry per deal in the batch — every D# given must appear exactly once, in any order.'
    ),
})

export type IndustryBackfillResult = z.infer<typeof IndustryBackfillSchema>
