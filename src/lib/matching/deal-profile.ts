import 'server-only'
import type { Deal, DealUpdate } from '@/lib/types'
import type { Underwriting } from '@/lib/underwriting/schema'

// Shared plain-text summary of a deal — used both when matching it against
// lenders and when drafting a submission email for it, so the two stay
// consistent with each other.
export function buildDealProfile(
  deal: Deal,
  updates: Pick<DealUpdate, 'entry_date' | 'note'>[] | null
): string {
  const underwriting = deal.underwriting as Underwriting | null

  const parts = [
    `Company: ${deal.company_name}`,
    deal.industry ? `Industry: ${deal.industry}` : null,
    deal.loan_type ? `Loan type: ${deal.loan_type}` : null,
    deal.deal_type ? `Deal type / ask: ${deal.deal_type}` : null,
    deal.description ? `Deal description (from the broker): ${deal.description}` : null,
    deal.notes ? `Broker notes: ${deal.notes}` : null,
  ].filter(Boolean) as string[]

  if (underwriting) {
    parts.push(
      '',
      '--- AI underwriting summary ---',
      `Company overview: ${underwriting.company_overview}`,
      underwriting.historical_financials.length > 0
        ? `Historical financials: ${underwriting.historical_financials
            .map(
              (f) =>
                `${f.period}: revenue ${f.revenue ?? '?'}, EBITDA ${f.ebitda ?? '?'}, net income ${f.net_income ?? '?'}, cash flow ${f.cash_flow ?? '?'}`
            )
            .join('; ')}`
        : 'No historical financials extracted.',
      `Current position: AR ${underwriting.current_position.accounts_receivable ?? '?'}, inventory ${underwriting.current_position.inventory ?? '?'}, equipment ${underwriting.current_position.equipment_value ?? '?'}, real estate ${underwriting.current_position.real_estate_value ?? '?'}, AP ${underwriting.current_position.accounts_payable ?? '?'}, total debt ${underwriting.current_position.total_debt ?? '?'}`,
      `Strengths: ${underwriting.strengths.join('; ') || 'none noted'}`,
      `Risks: ${underwriting.risks.join('; ') || 'none noted'}`,
      `Data gaps: ${underwriting.data_gaps.join('; ') || 'none noted'}`
    )
  } else {
    parts.push('', '(No AI underwriting has been run on this deal yet.)')
  }

  if (updates && updates.length > 0) {
    parts.push(
      '',
      '--- Recent activity log ---',
      ...updates.map((u) => `${u.entry_date ?? '(no date)'}: ${u.note}`)
    )
  }

  return parts.join('\n')
}
