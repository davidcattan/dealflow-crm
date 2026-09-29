import { z } from 'zod'
import { INDUSTRY_CATEGORIES, LOAN_TYPE_CATEGORIES } from '@/lib/deals/categories'

export const LENDER_OUTCOMES = ['interested', 'needs_more_info', 'term_sheet', 'declined', 'other'] as const

export const OUTCOME_LABELS: Record<(typeof LENDER_OUTCOMES)[number], string> = {
  interested: 'Interested',
  needs_more_info: 'Needs more info',
  term_sheet: 'Term sheet / offer',
  declined: 'Declined',
  other: 'Replied',
}

export const EmailClassificationSchema = z.object({
  kind: z
    .enum(['new_deal', 'lender_reply', 'other'])
    .describe(
      'new_deal = someone (borrower, broker, referral partner) presenting a financing request for a specific business, or sending more info on one. lender_reply = a lender/funder responding about a deal that was submitted to them. other = everything else (newsletters, lender marketing blasts about their own products, internal chatter, notifications, personal mail).'
    ),
  reason: z.string().describe('One short line explaining the classification.'),
  new_deal: z
    .object({
      existing_deal_ref: z
        .string()
        .nullable()
        .describe('The D# of a deal in the provided list if this email is clearly about that same company (more info, more documents). Null if it is a new company.'),
      company_name: z.string().describe('The borrower company name.'),
      contact_name: z.string().nullable(),
      contact_email: z.string().nullable(),
      contact_phone: z.string().nullable(),
      industry: z.enum(INDUSTRY_CATEGORIES).nullable(),
      loan_type: z.enum(LOAN_TYPE_CATEGORIES).nullable(),
      ask: z.string().nullable().describe('Short: amount and type of financing requested, if stated.'),
      description: z.string().describe('2-5 sentence plain rundown of the deal as presented in the email. Only facts stated in the email.'),
    })
    .nullable()
    .describe('Fill only when kind is new_deal, otherwise null.'),
  lender_reply: z
    .object({
      deal_ref: z
        .string()
        .nullable()
        .describe('The D# of the deal this reply is about, from the provided list. Null if you cannot tell.'),
      outcome: z.enum(LENDER_OUTCOMES),
      summary: z.string().describe('1-2 sentences: what the lender said.'),
      requested_items: z.array(z.string()).describe('Specific documents or answers the lender asked for. Empty if none.'),
      mandate_notes: z
        .string()
        .nullable()
        .describe('New facts the lender stated about what it does or does not finance (size, industries, collateral, geography). Null if none.'),
    })
    .nullable()
    .describe('Fill only when kind is lender_reply, otherwise null.'),
})

export type EmailClassification = z.infer<typeof EmailClassificationSchema>
