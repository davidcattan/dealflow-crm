import { z } from 'zod'

// A quick read of a deal: just the important things, glanceable on a phone.
export const QuickReadSchema = z.object({
  headline: z.string().describe('One line: what the business is, where, and what it wants (amount + product if known).'),
  key_numbers: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .describe('Up to 6 of the most important figures with their period, e.g. {"label":"Revenue 2025","value":"$4.55M (up 57%)"}. Only numbers in the documents.'),
  watch_outs: z.array(z.string()).describe('The 3 most important concerns, one short line each.'),
  missing: z.array(z.string()).describe('Up to 5 documents still needed, most important first.'),
  fit: z.string().describe('One line: what kind of lender/product fits this (e.g. "ABL / factoring", "SBA 7(a)", "equipment finance") or that it is not bankable yet and why.'),
})

export type QuickRead = z.infer<typeof QuickReadSchema>
