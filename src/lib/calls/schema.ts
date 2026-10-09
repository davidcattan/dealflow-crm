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
