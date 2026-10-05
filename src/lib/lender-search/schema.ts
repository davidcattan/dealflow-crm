import { z } from 'zod'

// Lenders found on the web for one deal — candidates to add to the CRM.
export const FoundLenderSchema = z.object({
  name: z.string().describe("The lender's company name as it appears on its own website."),
  website: z.string().describe('Homepage URL of the lender.'),
  lending_type: z.string().describe('Short: e.g. "Land / ADC construction", "Private bridge", "Hard money", "Nonprofit / church lender".'),
  loan_size: z.string().nullable().describe('Loan size range as the lender states it, e.g. "$100K–$5M". Null if not stated.'),
  geographies: z.string().nullable().describe('States/regions served as stated, e.g. "Southeast", "GA, FL, SC", "Nationwide". Null if not stated.'),
  why_fit: z.string().describe('1–2 sentences: why this lender fits THIS deal, based on what its site says.'),
  watch_out: z.string().nullable().describe('One short line on a likely mismatch (e.g. "won\'t lend on owner-occupied homes"), or null.'),
  contact: z.string().nullable().describe('Public contact for deal submissions (email, phone or form URL) if shown on its site, else null.'),
  source_url: z.string().describe('The page on the lender\'s own site that confirms what it lends on.'),
  confidence: z.enum(['high', 'medium', 'low']).describe('How clearly the lender\'s own site shows it does this kind of loan.'),
})

export const LenderSearchSchema = z.object({
  needed: z.string().describe('One or two lines: the kind of lender this deal needs (product, size, geography, key constraints).'),
  results: z.array(FoundLenderSchema).describe('10–15 lenders, best fit first. Only lenders verified on their own website.'),
  note: z.string().nullable().describe('One short line of advice for the broker (e.g. what to fix before submitting), or null.'),
})

export type FoundLender = z.infer<typeof FoundLenderSchema>
export type LenderSearch = z.infer<typeof LenderSearchSchema>
