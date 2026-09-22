// Fixed taxonomies for the lender mandate fields. Lending type and
// industries deliberately reuse the exact same categories as deals'
// loan_type/industry (src/lib/deals/categories.ts) so a lender's mandate
// and a deal's profile can eventually be compared category-to-category
// instead of only via free-text matching.

export { LOAN_TYPE_CATEGORIES as LENDING_TYPE_CATEGORIES } from '@/lib/deals/categories'
export { INDUSTRY_CATEGORIES } from '@/lib/deals/categories'

export const ASSET_TYPE_CATEGORIES = [
  'Accounts Receivable',
  'Inventory',
  'Equipment',
  'Real Estate',
  'Purchase Orders',
  'Intellectual Property',
  'Cash Flow',
] as const

// "Nationwide" isn't listed here — it's the same thing as no geographic
// restriction at all, i.e. the checklist's "All" option (an empty array).
export const GEOGRAPHY_CATEGORIES = [
  'Northeast',
  'Mid-Atlantic',
  'Southeast',
  'Midwest',
  'Southwest',
  'West / Pacific',
] as const
