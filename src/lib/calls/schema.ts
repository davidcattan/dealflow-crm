import { z } from 'zod'
import { SUBMISSION_STATUSES } from '@/lib/deals/submission-status'

export const DEAL_CHANGE_FIELDS = ['contact_name', 'contact_email', 'contact_phone', 'loan_type', 'add_to_notes'] as const

export const CallNotesSchema = z.object({
  title: z.string().describe('Short title naming who the call was with, e.g. "Call with Larry at Fairview" or "Call with the borrower (Scott)".'),
  summary: z.string().describe('3-5 plain sentences: what the call was about and what came out of it.'),
  key_points: z
    .array(z.string())
    .describe('The concrete facts and numbers said on the call (amounts, rates, terms, collateral, timing, documents, objections). One short line each. Empty if none.'),
  next_steps: z
    .array(
      z.object({
        text: z.string().describe('One action, starting with a verb, e.g. "Send Fairview the appraisal and 2 years of tax returns".'),
        owner: z.enum(['us', 'borrower', 'lender', 'other']).describe('us = JED Capital (David/Eli).'),
      })
    )
    .describe('What has to happen next, most important first.'),
  lender_updates: z
    .array(
      z.object({
        lender_name: z.string().describe('The lender as named on the call (use the CRM name if it is one of the listed lenders).'),
        status: z
          .enum([...SUBMISSION_STATUSES, 'no_change'])
          .describe('Where the deal now stands with this lender, only if the call made it clear; otherwise no_change.'),
        note: z.string().describe('One line: what this lender said or wants.'),
      })
    )
    .describe('One entry per lender discussed on the call. Empty if no lender came up.'),
  deal_changes: z
    .array(
      z.object({
        field: z.enum(DEAL_CHANGE_FIELDS),
        value: z.string().describe('The new value. For add_to_notes: the fact to add, one line.'),
        why: z.string().describe('Very short: what on the call supports this.'),
      })
    )
    .describe(
      'Only changes clearly supported by the call: a new or corrected contact name/email/phone, a different loan type, or an important new fact for the deal notes (e.g. new loan amount, use of funds, timing). Empty if none.'
    ),
})

export type CallNotes = z.infer<typeof CallNotesSchema>

export const LENDER_CHANGE_FIELDS = [
  'min_loan_amount',
  'max_loan_amount',
  'min_revenue',
  'min_ebitda',
  'lending_type',
  'asset_types',
  'industries',
  'geographies',
  'website',
  'add_to_mandate_notes',
] as const

// Notes from a call with a lender that isn't about one deal — usually an
// intro call where they explain what they lend on.
export const LenderCallNotesSchema = z.object({
  title: z.string().describe('Short title, e.g. "Intro call with Mike at Fairview".'),
  summary: z.string().describe('3-5 plain sentences: who they are, what they lend on, and what came out of the call.'),
  key_points: z
    .array(z.string())
    .describe('Concrete facts said on the call: loan sizes, rates, LTV/advance rates, terms, fees, speed to close, deal types they love or avoid. One short line each.'),
  next_steps: z
    .array(
      z.object({
        text: z.string().describe('One action, starting with a verb.'),
        owner: z.enum(['us', 'borrower', 'lender', 'other']).describe('us = JED Capital (David/Eli).'),
      })
    )
    .describe('What has to happen next, most important first.'),
  lender_changes: z
    .array(
      z.object({
        field: z.enum(LENDER_CHANGE_FIELDS),
        value: z
          .string()
          .describe(
            'Amounts: whole US dollars as digits only (e.g. 5000000). lending_type: exactly one of the listed lending types. asset_types / industries / geographies: comma-separated values from the listed options only; geographies "Nationwide" means no restriction. add_to_mandate_notes: one line on what they want or avoid.'
          ),
        why: z.string().describe('Very short: what on the call supports this.'),
      })
    )
    .describe('Updates to the lender profile that the call clearly supports. Empty if none.'),
  new_contacts: z
    .array(
      z.object({
        name: z.string(),
        title: z.string().nullable(),
        email: z.string().nullable(),
        phone: z.string().nullable(),
      })
    )
    .describe('People at the lender named on the call (with any title, email or phone given) — so deals can be sent to them. Empty if none.'),
})

export type LenderCallNotes = z.infer<typeof LenderCallNotesSchema>
