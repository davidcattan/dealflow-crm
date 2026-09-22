import { z } from 'zod'
import { LOAN_TYPE_CATEGORIES } from './categories'

export const LoanTypeBackfillSchema = z.object({
  classifications: z
    .array(
      z.object({
        deal_ref: z
          .string()
          .describe('The D# reference from the list, e.g. "D12"'),
        loan_type: z
          .enum(LOAN_TYPE_CATEGORIES)
          .nullable()
          .describe(
            'One of the fixed loan-type categories — pick the closest fit rather than inventing a new one. Null only if the ask/notes genuinely give no signal about what kind of financing is needed.'
          ),
      })
    )
    .describe(
      'One entry per deal in the batch — every D# given must appear exactly once, in any order.'
    ),
})

export type LoanTypeBackfillResult = z.infer<typeof LoanTypeBackfillSchema>
