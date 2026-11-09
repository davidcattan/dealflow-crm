// Which side of a two-part deal a lender sits on, read from its free-text
// lending type: PO financing pays the suppliers, factoring / AR advances on
// the invoices and takes the PO lender out.
export type LenderRole = 'po' | 'ar'

export function lenderRole(lendingType: string | null | undefined): LenderRole | null {
  const t = lendingType ?? ''
  if (/\bP\.?O\.?\b|purchase order|supply chain|trade financ/i.test(t)) return 'po'
  if (/factor|\bA\/?R\b|receivable|invoice/i.test(t)) return 'ar'
  return null
}

export const ROLE_LABELS: Record<LenderRole | 'other', string> = {
  po: 'PO financing (pays the suppliers)',
  ar: 'Factoring / AR (advances on invoices, takes out the PO lender)',
  other: 'Other lenders',
}
