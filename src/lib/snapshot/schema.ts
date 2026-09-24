import { z } from 'zod'

// The lender snapshot: the short template the brokerage sends to lenders.
// One block per entity, plus a combined block when there is more than one.
// Every figure is nullable — never guess a number — and every period /
// balance carries the document it came from.

const Money = z.number().nullable()

export const PeriodSchema = z.object({
  label: z.string().describe('e.g. "2026 YTD (Jan-Aug)", "FY2025", "FY2024".'),
  revenue: Money,
  ebitda: Money,
  net_income: Money,
  source: z
    .string()
    .describe('Short source, e.g. "2025 Form 1065", "YTD P&L (QuickBooks)", "Schedule C". Note basis (tax/book/cash) if it matters.'),
})

export const DebtSchema = z.object({
  lender: z.string().describe('Lender / holder name, e.g. "Sandy Spring Mortgage", "SBA loan", "Note payable - owner".'),
  balance: z.number().nullable(),
  kind: z
    .enum(['real_estate', 'business'])
    .describe('real_estate = mortgages secured by real estate; business = everything else (equipment loans, lines of credit, SBA, notes).'),
  note: z.string().nullable().describe('Optional 3-8 word note (rate, secured by, maturity) or null.'),
})

export const EntitySchema = z.object({
  name: z.string(),
  about: z.string().describe('One sentence: what the business does.'),
  owner: z.string().describe('Owner(s) and percentage if known.'),
  industry: z.string(),
  periods: z
    .array(PeriodSchema)
    .describe('Newest first: interim YTD, then FY-1, then FY-2. Omit periods with no data.'),
  assets: z.object({
    accounts_receivable: Money,
    equipment: Money.describe('Net fixed assets / equipment. If real estate is separately reported, exclude it here.'),
    real_estate: Money.describe('Net book value of real estate/land/buildings if the entity owns any, else null.'),
    inventory: Money,
    as_of: z.string().describe('Balance sheet date the assets are as of.'),
    source: z.string(),
  }),
  liabilities: z.object({
    accounts_payable: Money,
    debts: z.array(DebtSchema).describe('One row per loan/tranche or grouped tranches (e.g. "Heavy equipment loans (24 tranches)").'),
    total_debt: Money,
    as_of: z.string(),
    source: z.string(),
  }),
})

export const CombinedSchema = z.object({
  periods: z.array(PeriodSchema),
  accounts_receivable: Money,
  equipment: Money,
  real_estate: Money,
  inventory: Money,
  accounts_payable: Money,
  real_estate_debt: Money,
  business_debt: Money,
  total_debt: Money,
  note: z.string().nullable().describe('One short line on intercompany eliminations or adjustments, or null.'),
})

export const SnapshotSchema = z.object({
  entities: z.array(EntitySchema).describe('One entry per legal entity in the package.'),
  combined: CombinedSchema.nullable().describe('Only when there is more than one entity; otherwise null.'),
  coverage: z.object({
    annual_debt_service: Money,
    ebitda_used: Money,
    dscr: z.number().nullable(),
    note: z.string().describe('One short line: what basis was used and how much to trust it.'),
  }),
  flags: z
    .array(z.string())
    .describe('Short red flags and inconsistencies (each one line): e.g. application says no balances but debt exists, unexplained income, missing depreciation, round-number AR, thin coverage, seasonality.'),
  request_list: z
    .array(z.string())
    .describe('Documents to request from the client (short, one per line), tailored to what is missing for ABL / lender review.'),
})

export type Snapshot = z.infer<typeof SnapshotSchema>
export type SnapshotEntity = z.infer<typeof EntitySchema>
