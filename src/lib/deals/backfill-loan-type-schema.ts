import { z } from 'zod'

export const LoanTypeBackfillSchema = z.object({
  classifications: z
    .array(
      z.object({
        deal_ref: z
          .string()
          .describe('The D# reference from the list, e.g. "D12"'),
        loan_type: z
          .string()
          .nullable()
          .describe(
            'A short loan/financing category (1-4 words) such as "ABL", "HELOC", "Real Estate Bridge", "Equipment Financing", "Factoring", "Construction", "Working Capital", "SBA", "Term Loan", "M&A / Acquisition Financing". Null if the ask/notes genuinely give no signal — do not guess.'
          ),
      })
    )
    .describe(
      'One entry per deal in the batch — every D# given must appear exactly once, in any order.'
    ),
})

export type LoanTypeBackfillResult = z.infer<typeof LoanTypeBackfillSchema>
