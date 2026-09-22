// Fixed taxonomies for deal industry/loan-type, so the Pipeline filter
// dropdowns stay short and usable instead of accumulating a near-unique
// freeform label per deal. Classification (in backfill-industry.ts /
// backfill-loan-type.ts) is constrained to exactly these values.

export const INDUSTRY_CATEGORIES = [
  'Construction & Contracting',
  'Real Estate',
  'Healthcare & Medical',
  'Restaurants & Food Service',
  'Retail & Ecommerce',
  'Manufacturing & Industrial',
  'Transportation & Logistics',
  'Financial Services',
  'Professional & Business Services',
  'Technology & Software',
  'Energy & Utilities',
  'Hospitality & Entertainment',
  'Agriculture & Food Production',
  'Automotive',
  'Consumer Products',
  'Staffing & Recruiting',
  'Security Services',
  'Aerospace & Defense',
  'Other',
] as const

export const LOAN_TYPE_CATEGORIES = [
  'ABL (AR & Inventory)',
  'Equipment Financing',
  'Real Estate / Bridge',
  'HELOC / Home Equity',
  'Factoring',
  'Construction Financing',
  'Working Capital / Line of Credit',
  'SBA Loan',
  'Term Loan',
  'M&A / Acquisition Financing',
] as const

export type IndustryCategory = (typeof INDUSTRY_CATEGORIES)[number]
export type LoanTypeCategory = (typeof LOAN_TYPE_CATEGORIES)[number]
