import { z } from 'zod'

export const FinancialPeriodSchema = z.object({
  period: z.string().describe('e.g. "FY2022", "FY2023", "FY2024 YTD"'),
  revenue: z.number().nullable(),
  ebitda: z.number().nullable(),
  net_income: z.number().nullable(),
  cash_flow: z.number().nullable(),
})

export const UnderwritingSchema = z.object({
  company_overview: z
    .string()
    .describe(
      'A 2-4 sentence summary of what the company does, based on its website, documents, and news.'
    ),
  historical_financials: z
    .array(FinancialPeriodSchema)
    .describe(
      'One entry per fiscal period found in the uploaded documents, oldest first. Empty array if no historical financials were found.'
    ),
  current_position: z.object({
    as_of: z
      .string()
      .nullable()
      .describe('Date or period these current-position figures are as of, if known.'),
    accounts_receivable: z.number().nullable(),
    inventory: z.number().nullable(),
    equipment_value: z.number().nullable(),
    real_estate_value: z.number().nullable(),
    accounts_payable: z.number().nullable(),
    total_debt: z.number().nullable(),
  }),
  recent_news: z
    .array(
      z.object({
        headline: z.string(),
        summary: z.string(),
        url: z.string().nullable(),
      })
    )
    .describe('Recent news found via web search. Empty array if nothing relevant was found.'),
  strengths: z.array(z.string()),
  risks: z.array(z.string()),
  data_gaps: z
    .array(z.string())
    .describe(
      'Specific financial data points that were needed for underwriting but not found in the uploaded documents.'
    ),
  summary: z
    .string()
    .describe('Overall underwriting narrative and recommendation context, 3-6 sentences.'),
})

export type Underwriting = z.infer<typeof UnderwritingSchema>
