import { z } from 'zod'

// Simply Capital (Tom) — lender on small deals and a referral source. When a
// deal fits his program he wants his Jotform application filled in with the
// diligence files uploaded. The CRM prepares everything except the parts
// only the borrower can give: SSN, date of birth, credit score, signature.

export const SIMPLY_CAPITAL = {
  name: 'Simply Capital',
  formUrl: 'https://form.jotform.com/261184683266161',
  min: 300_000,
  max: 500_000,
}

export const CHECKLIST = [
  { key: 'tax_returns', label: '2024 & 2025 tax returns' },
  { key: 'pl_bs', label: '2026 P&L and balance sheet' },
  { key: 'bank_statements', label: 'Last 6 months bank statements' },
  { key: 'debt_schedule', label: 'Debt schedule' },
  { key: 'application', label: 'Application' },
] as const

const s = (what: string) => z.string().nullable().describe(`${what}. null if not in the material.`)

const OwnerSchema = z.object({
  first_name: s('First name'),
  last_name: s('Last name'),
  email: s('Email'),
  mobile: s('Mobile phone, digits'),
  home_street: s('Home street address'),
  home_city: s('Home city'),
  home_state: s('Home state, 2-letter'),
  home_zip: s('Home ZIP'),
  ownership_pct: s('Ownership percent, number only, e.g. "60"'),
})

export const SimplyCapitalSchema = z.object({
  requested_amount: z.number().nullable().describe('Loan amount the borrower is asking for, in dollars. null if unknown.'),
  form: z.object({
    company_name: s('Legal company name exactly as on the tax return / formation papers'),
    dba: s('DBA, if different'),
    street: s('Business street address'),
    street2: s('Suite / unit'),
    city: s('Business city'),
    state: s('Business state, 2-letter'),
    zip: s('Business ZIP'),
    ein: s('Federal tax ID, XX-XXXXXXX'),
    entity_type: z.enum(['Corporation', 'Sole Prop', 'LLC', 'Partnership', 'Non-Profit']).nullable().describe('S-Corp and C-Corp are "Corporation".'),
    established: s('Business established / incorporation date, YYYY-MM-DD'),
    product_or_service: s('What the business sells, a few words'),
    owner: OwnerSchema.describe('Primary owner (largest %)'),
    contact_time: s('Best time and method to reach the owner, if stated'),
    second_owner: OwnerSchema.nullable().describe('Second owner, or null if only one owner'),
    monthly_sales: z
      .number()
      .nullable()
      .describe('Average monthly business deposits/sales over the latest bank statements (exclude transfers between own accounts and loan proceeds). null if no statements.'),
    open_loans_or_mca: z.enum(['Yes', 'No']).nullable().describe('Any open term loan or merchant cash advance (from the debt schedule, statements — recurring lender debits — or emails).'),
    funding_amount: z.number().nullable().describe('Funding amount needed, dollars'),
    use_of_funds: s('Use of funds, short'),
  }),
  files: z
    .array(
      z.object({
        item: z.enum(['tax_returns', 'pl_bs', 'bank_statements', 'debt_schedule', 'application']),
        document_ids: z.array(z.string()).describe('Ids of the documents that satisfy this item (for bank statements: the latest 6 months, newest first).'),
        status: z.enum(['complete', 'partial', 'missing']),
        note: z.string().nullable().describe('What is missing or off, e.g. "only 2024 return", "statements stop at July".'),
      })
    )
    .describe('One entry for each of the 5 checklist items.'),
  check: z.array(z.string()).describe('Values worth double-checking before submitting, one short line each (guesses, conflicts, old data).'),
})

export type SimplyCapitalPrep = z.infer<typeof SimplyCapitalSchema>

// The pre-filled Jotform link. Only business and contact details go in the
// link — never SSN, date of birth or credit score.
export function prefillUrl(p: SimplyCapitalPrep) {
  const f = p.form
  const q = new URLSearchParams()
  const set = (k: string, v: string | number | null | undefined) => {
    if (v !== null && v !== undefined && String(v).trim()) q.set(k, String(v).trim())
  }
  set('companyName', f.company_name)
  set('dba', f.dba)
  set('businessPhysical[addr_line1]', f.street)
  set('businessPhysical[addr_line2]', f.street2)
  set('businessPhysical[city]', f.city)
  set('businessPhysical[state]', f.state)
  set('businessPhysical[postal]', f.zip)
  set('typeA63', f.ein)
  set('typeA', f.entity_type)
  const est = f.established?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (est) {
    set('date[month]', est[2])
    set('date[day]', est[3])
    set('date[year]', est[1])
  }
  set('productOr', f.product_or_service)
  set('fullName[first]', f.owner.first_name)
  set('fullName[last]', f.owner.last_name)
  set('email11', f.owner.email)
  set('mobilePhone[full]', f.owner.mobile?.replace(/\D/g, ''))
  set('homeAddress[addr_line1]', f.owner.home_street)
  set('homeAddress[city]', f.owner.home_city)
  set('homeAddress[state]', f.owner.home_state)
  set('homeAddress[postal]', f.owner.home_zip)
  set('ownership', f.owner.ownership_pct)
  set('typeA34', f.contact_time)
  set('typeA35', f.second_owner ? 'Yes' : 'No')
  if (f.second_owner) {
    set('fullName41[first]', f.second_owner.first_name)
    set('fullName41[last]', f.second_owner.last_name)
    set('homeAddress40[addr_line1]', f.second_owner.home_street)
    set('homeAddress40[city]', f.second_owner.home_city)
    set('homeAddress40[state]', f.second_owner.home_state)
    set('homeAddress40[postal]', f.second_owner.home_zip)
    set('mobilePhone42[full]', f.second_owner.mobile?.replace(/\D/g, ''))
    set('email', f.second_owner.email)
    set('typeA47', f.second_owner.ownership_pct)
  }
  set('totalMonthly', f.monthly_sales !== null ? Math.round(f.monthly_sales) : null)
  set('doYou', f.open_loans_or_mca)
  set('fundingAmount', f.funding_amount !== null ? Math.round(f.funding_amount) : null)
  set('useOf', f.use_of_funds)
  return `${SIMPLY_CAPITAL.formUrl}?${q.toString()}`
}

// "$350K", "350,000", "$1.2M" in the deal's ask → dollars (largest found).
export function askAmount(...texts: (string | null | undefined)[]) {
  let best: number | null = null
  for (const t of texts) {
    for (const m of (t ?? '').matchAll(/\$?\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m|mm|million|thousand)?\b/gi)) {
      let n = parseFloat(m[1].replace(/,/g, ''))
      const unit = (m[2] ?? '').toLowerCase()
      if (unit === 'k' || unit === 'thousand') n *= 1_000
      else if (unit === 'm' || unit === 'mm' || unit === 'million') n *= 1_000_000
      if (n >= 50_000 && n <= 100_000_000 && (best === null || n > best)) best = n
    }
  }
  return best
}

export const fitsSimplyCapital = (amount: number | null) => amount !== null && amount >= SIMPLY_CAPITAL.min && amount <= SIMPLY_CAPITAL.max
