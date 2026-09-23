import { z } from 'zod'

export const DocTriageSchema = z.object({
  doc_type: z
    .string()
    .describe('Short label for what this document is, e.g. "Personal tax return (Form 1040 + schedules)", "Balance sheet", "Debt schedule".'),
  total_pages: z.number().describe('Total number of pages in the document.'),
  relevance: z
    .enum(['high', 'medium', 'low'])
    .describe('How much this document matters for an asset-based lending underwriting decision.'),
  summary: z
    .string()
    .describe('1-2 sentences: what the document contains and what, if anything, on the omitted pages was left out.'),
  important_pages: z
    .array(z.object({ start: z.number(), end: z.number() }))
    .describe('1-indexed inclusive page ranges that carry real underwriting signal. For short documents (10 pages or fewer) return the whole document as one range.'),
})
