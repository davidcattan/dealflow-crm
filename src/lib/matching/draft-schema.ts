import { z } from 'zod'

export const DraftEmailSchema = z.object({
  subject: z
    .string()
    .describe(
      'Short and specific: loan type, amount (if known), collateral/location, borrower. e.g. "$250K Land/ADC Loan — 5.4 ac, Flowery Branch GA". No "Deal Submission:" prefix.'
    ),
  body: z
    .string()
    .describe(
      'Plain text, ready to send. UNDER 120 WORDS. Exactly this shape: "Hi <first name>," (or "Hi there,") / one sentence: what the deal is (borrower type, what they need, amount, collateral, location) / 2-4 short bullet lines ("- ") with the numbers that matter most to a lender (value, LTV, revenue/EBITDA, use of funds) — only numbers given to you / one sentence on why it fits THIS lender (their product, size or geography) / optional one line starting "Heads up:" only if there is a known issue that would stop most lenders / one closing line asking for a quick look or call, mentioning the package is attached if documents are attached / sign-off.'
    ),
})

export type DraftEmail = z.infer<typeof DraftEmailSchema>
