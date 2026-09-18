export type BorrowerStatus =
  | 'new'
  | 'in_review'
  | 'underwritten'
  | 'matched'
  | 'submitted'
  | 'closed'
  | 'dead'

export type Borrower = {
  id: string
  company_name: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  industry: string | null
  website: string | null
  status: BorrowerStatus
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
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
  borrower_id: string
  file_name: string
  storage_path: string
  file_size: number | null
  content_type: string | null
  uploaded_by: string | null
  uploaded_at: string
}

export const BORROWER_STATUSES: BorrowerStatus[] = [
  'new',
  'in_review',
  'underwritten',
  'matched',
  'submitted',
  'closed',
  'dead',
]

export const STATUS_LABELS: Record<BorrowerStatus, string> = {
  new: 'New',
  in_review: 'In review',
  underwritten: 'Underwritten',
  matched: 'Matched',
  submitted: 'Submitted',
  closed: 'Closed',
  dead: 'Dead',
}

// Dot/badge color per stage, for quick visual scanning on the pipeline tracker.
export const STATUS_COLORS: Record<BorrowerStatus, string> = {
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
export const PIPELINE_STATUSES: BorrowerStatus[] = [
  'new',
  'in_review',
  'underwritten',
  'matched',
  'submitted',
]
