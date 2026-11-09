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

export const ROLE_LABELS: Record<LenderRole | 'other', { title: string; note: string }> = {
  po: { title: 'PO financing', note: 'pays the suppliers' },
  ar: { title: 'Factoring / AR', note: 'advances on the invoices and takes out the PO lender' },
  other: { title: 'Other lenders', note: '' },
}
