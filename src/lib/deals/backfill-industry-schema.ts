import { z } from 'zod'

export const IndustryBackfillSchema = z.object({
  classifications: z
    .array(
      z.object({
        deal_ref: z
          .string()
          .describe('The D# reference from the list, e.g. "D12"'),
        industry: z
          .string()
          .nullable()
          .describe(
            'A concise industry category (2-4 words), e.g. "Construction", "Trucking & Logistics", "Restaurants / Food Service", "Healthcare Services". Null if the company name, notes, and ask genuinely give no signal to infer from — do not guess.'
          ),
      })
    )
    .describe(
      'One entry per deal in the batch — every D# given must appear exactly once, in any order.'
    ),
})

export type IndustryBackfillResult = z.infer<typeof IndustryBackfillSchema>
