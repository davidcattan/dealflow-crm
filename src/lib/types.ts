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
  min_loan_amount: number | null
  max_loan_amount: number | null
  asset_types: string[]
  industries: string[]
  geographies: string[]
  status: 'active' | 'inactive'
  created_by: string | null
  created_at: string
  updated_at: string
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
