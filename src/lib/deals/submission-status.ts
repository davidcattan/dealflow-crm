// Where a deal stands with one lender it was sent to.
export const SUBMISSION_STATUSES = ['sent', 'interested', 'needs_more_info', 'term_sheet', 'declined', 'funded'] as const
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]

export const SUBMISSION_LABELS: Record<SubmissionStatus, string> = {
  sent: 'Sent — waiting',
  interested: 'Interested',
  needs_more_info: 'Needs more info',
  term_sheet: 'Term sheet / offer',
  declined: 'Declined',
  funded: 'Funded',
}

export const SUBMISSION_STYLES: Record<SubmissionStatus, string> = {
  sent: 'bg-slate-100 text-slate-700',
  interested: 'bg-sky-100 text-sky-800',
  needs_more_info: 'bg-amber-100 text-amber-800',
  term_sheet: 'bg-violet-100 text-violet-800',
  declined: 'bg-red-100 text-red-700',
  funded: 'bg-emerald-100 text-emerald-800',
}
