import { z } from 'zod'

export const DRAFT_STYLES = ['short', 'long'] as const
export type DraftStyle = (typeof DRAFT_STYLES)[number]

export const DraftEmailSchema = z.object({
  subject: z
    .string()
    .describe(
      'Short and specific: loan type, amount (if known), collateral/location, borrower. e.g. "$250K Land/ADC Loan — 5.4 ac, Flowery Branch GA". No "Deal Submission:" prefix.'
    ),
  body: z.string().describe('Plain text email body, ready to send, following the style rules exactly.'),
})

export type DraftEmail = z.infer<typeof DraftEmailSchema>
