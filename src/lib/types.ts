export type DealStatus =
  | 'new'
  | 'in_review'
  | 'underwritten'
  | 'matched'
  | 'submitted'
  | 'closed'
  | 'dead'

export type Deal = {
  id: string
  company_name: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  industry: string | null
  website: string | null
  status: DealStatus
  notes: string | null
  activity_score: number | null
  deal_type: string | null
  rep_name: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type DealUpdate = {
  id: string
  deal_id: string
  entry_date: string | null
  note: string
  source: string
  created_by: string | null
  created_at: string
}

export type Lender = {
  id: string
  name: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  website: string | null
  mandate_notes: string | null
  lending_type: string | null
  min_loan_amount: number | null
  max_loan_amount: number | null
  min_revenue: number | null
  min_ebitda: number | null
  cares_about_profit: boolean | null
  asset_types: string[]
  industries: string[]
  geographies: string[]
  status: 'active' | 'inactive'
  created_by: string | null
  created_at: string
  updated_at: string
}

export type LenderContact = {
  id: string
  lender_id: string
  name: string | null
  email: string | null
  created_at: string
}

export type DocumentRecord = {
  id: string
  deal_id: string
  file_name: string
  storage_path: string
  file_size: number | null
  content_type: string | null
  uploaded_by: string | null
  uploaded_at: string
}

export type DealMatch = {
  id: string
  deal_id: string
  lender_id: string
  score: number
  reasoning: string
  selected: boolean
  created_at: string
}

export const DEAL_STATUSES: DealStatus[] = [
  'new',
  'in_review',
  'underwritten',
  'matched',
  'submitted',
  'closed',
  'dead',
]

export const STATUS_LABELS: Record<DealStatus, string> = {
  new: 'New',
  in_review: 'In review',
  underwritten: 'Underwritten',
  matched: 'Matched',
  submitted: 'Submitted',
  closed: 'Closed',
  dead: 'Dead',
}

// Dot/badge color per stage, for quick visual scanning on the pipeline tracker.
export const STATUS_COLORS: Record<DealStatus, string> = {
  new: 'bg-slate-400',
  in_review: 'bg-amber-400',
  underwritten: 'bg-blue-400',
  matched: 'bg-violet-400',
  submitted: 'bg-emerald-400',
  closed: 'bg-emerald-600',
  dead: 'bg-red-400',
}

// Stages shown on the active pipeline tracker, in order. Closed and dead
// deals are resolved, not "active" — left out by default.
export const PIPELINE_STATUSES: DealStatus[] = [
  'new',
  'in_review',
  'underwritten',
  'matched',
  'submitted',
]

// Color for the 0-10 "how actively is this being worked" score — red (cold)
// through green (hot). Full class strings, not built dynamically, so
// Tailwind's build-time content scan can find them.
export function activityScoreColor(score: number | null): string {
  if (score === null) return 'bg-slate-200'
  if (score >= 9) return 'bg-emerald-500'
  if (score >= 7) return 'bg-lime-500'
  if (score >= 5) return 'bg-yellow-400'
  if (score >= 3) return 'bg-orange-500'
  return 'bg-red-500'
}

// Same idea, for the 0-100 lender-match fit score.
export function matchScoreColor(score: number): string {
  if (score >= 80) return 'bg-emerald-500'
  if (score >= 60) return 'bg-lime-500'
  if (score >= 40) return 'bg-yellow-400'
  if (score >= 20) return 'bg-orange-500'
  return 'bg-red-500'
}
