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
            'One of the fixed loan-type categories — pick the closest fit rather than inventing a new one. Use "Other" when the ask clearly indicates a real financing need that doesn\'t fit any category above (e.g. purchase order financing, litigation funding, DSCR/rental). Null only if the ask/notes genuinely give no signal at all about what kind of financing is needed.'
          ),
      })
    )
    .describe(
      'One entry per deal in the batch — every D# given must appear exactly once, in any order.'
    ),
})

export type LoanTypeBackfillResult = z.infer<typeof LoanTypeBackfillSchema>
