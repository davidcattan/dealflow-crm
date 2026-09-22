import { z } from 'zod'
import { LOAN_TYPE_CATEGORIES } from './categories'

export const LoanTypeRecommendationSchema = z.object({
  loan_type: z
    .enum(LOAN_TYPE_CATEGORIES)
    .nullable()
    .describe(
      'The single best-fit loan type for this deal from the fixed category list. Null only if the underwriting, documents, and notes genuinely give no signal about what financing would fit.'
    ),
  reasoning: z
    .string()
    .describe(
      '2-4 sentences explaining the recommendation — what in the underwriting/documents/notes points to this loan type, and any real uncertainty or alternative that was considered.'
    ),
})

export type LoanTypeRecommendation = z.infer<typeof LoanTypeRecommendationSchema>
