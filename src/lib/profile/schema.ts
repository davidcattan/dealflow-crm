import { z } from 'zod'

// Borrower profile: the company and owner details lender application forms
// ask for, pulled from the deal's tax returns, entity papers and emails.
// Every value says where it came from and how sure we are, so a form can be
// filled with confidence. Social Security numbers are never stored — only
// where to find them.

// The API caps "nullable" fields per request, so the AI answers "" for
// unknowns and fromAi() turns them into null.
const field = (what: string) =>
  z
    .object({
      value: z.string().describe(`${what}. Empty string if not in the material.`),
      status: z
        .enum(['confirmed', 'check', 'missing'])
        .describe(
          'confirmed = printed in a document exactly as given; check = worked out or inferred (e.g. from a parent company, a signature line, or two documents that disagree) — explain in note; missing = not in the material.'
        ),
      source: z.string().describe('Where it came from, short: e.g. "2024 tax return (1120-S), p.9" or "Email from Lucas, Oct 8". Empty string if missing.'),
      note: z.string().describe('Only if useful: why it needs checking, or a caveat. One short line. Empty string otherwise.'),
    })
    .describe(what)

export const OwnerSchema = z.object({
  name: field('Full legal name'),
  title: field('Title, e.g. President, Managing Member, Owner'),
  ownership_pct: field('Ownership percent as a number with %, e.g. "70%". Note if held indirectly through a parent'),
  home_street: field('Home street address (and apt)'),
  home_city: field('Home city'),
  home_state: field('Home state, 2-letter'),
  home_zip: field('Home ZIP'),
  email: field('Email'),
  phone: field('Phone'),
  birth_date: field('Date of birth'),
  credit_score: field('Credit score'),
  ssn_where: field(
    'NEVER the number itself. Where the SSN can be found, e.g. "K-1 in the 2024 tax return, p.15". null if not in any document'
  ),
})

export const ProfileSchema = z.object({
  company: z.object({
    legal_name: field('Exact legal name of the operating company (spelling exactly as on the tax return / state filing)'),
    dba: field('Doing-business-as name'),
    ein: field('Federal tax ID (EIN) of the operating company, format XX-XXXXXXX'),
    entity_type: field('Entity type: LLC, S-Corp, C-Corp, Partnership, Sole Prop, Nonprofit…'),
    state_of_incorporation: field('State of incorporation / formation'),
    start_date: field('Business start / incorporation date'),
    street: field('Business street address (and suite)'),
    city: field('Business city'),
    state: field('Business state, 2-letter'),
    zip: field('Business ZIP'),
    phone: field('Business phone'),
    email: field('Business email'),
    website: field('Website'),
    industry: field('Industry in plain words (and NAICS code if shown)'),
    annual_revenue: field('Most recent annual revenue with its year, e.g. "$18,928,336 (2024)"'),
    employees: field('Number of employees'),
    existing_debt: field('Existing business debt: total and/or number of loans, with the date'),
  }),
  owners: z.array(OwnerSchema).describe('Every owner of 10% or more (and any officer who signs), largest first.'),
  related_entities: z
    .array(
      z.object({
        name: z.string(),
        ein: z.string().describe('EIN, or empty string'),
        relationship: z.string().describe('e.g. "Parent — owns 100% of the operating company", "Subsidiary", "Affiliate under common ownership"'),
      })
    )
    .describe('Parent companies, subsidiaries and affiliates named in the documents.'),
  warnings: z
    .array(z.string())
    .describe(
      'Things that would trip up an application, one short line each: name spelled differently across documents, parent vs operating company EIN, conflicting addresses or percentages, placeholder-looking values.'
    ),
})

export type ProfileField = { value: string | null; status: 'confirmed' | 'check' | 'missing'; source: string | null; note: string | null }
type Ai = z.infer<typeof ProfileSchema>
export type Owner = { [K in keyof Ai['owners'][number]]: ProfileField }
export type Profile = {
  company: { [K in keyof Ai['company']]: ProfileField }
  owners: Owner[]
  related_entities: { name: string; ein: string | null; relationship: string }[]
  warnings: string[]
}

const t = (v: string) => (v.trim() ? v.trim() : null)
const cell = (c: z.infer<ReturnType<typeof field>>): ProfileField => ({
  value: t(c.value),
  status: t(c.value) ? c.status : 'missing',
  source: t(c.source),
  note: t(c.note),
})
const cells = <T extends Record<string, z.infer<ReturnType<typeof field>>>>(o: T) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, cell(v)])) as { [K in keyof T]: ProfileField }

export function fromAi(a: Ai): Profile {
  return {
    company: cells(a.company),
    owners: a.owners.map((o) => cells(o)),
    related_entities: a.related_entities.map((r) => ({ ...r, ein: t(r.ein) })),
    warnings: a.warnings,
  }
}

// Labels for the form-style display, in the order lender forms ask.
export const COMPANY_FIELDS: [keyof Profile['company'], string][] = [
  ['legal_name', 'Legal name'],
  ['dba', 'DBA'],
  ['ein', 'Tax ID (EIN)'],
  ['entity_type', 'Entity type'],
  ['state_of_incorporation', 'State of incorporation'],
  ['start_date', 'Business start date'],
  ['street', 'Address'],
  ['city', 'City'],
  ['state', 'State'],
  ['zip', 'ZIP'],
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['website', 'Website'],
  ['industry', 'Industry'],
  ['annual_revenue', 'Annual revenue'],
  ['employees', 'Employees'],
  ['existing_debt', 'Existing debt'],
]

export const OWNER_FIELDS: [keyof Owner, string][] = [
  ['name', 'Name'],
  ['title', 'Title'],
  ['ownership_pct', 'Ownership'],
  ['home_street', 'Home address'],
  ['home_city', 'City'],
  ['home_state', 'State'],
  ['home_zip', 'ZIP'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['birth_date', 'Birth date'],
  ['credit_score', 'Credit score'],
  ['ssn_where', 'SSN'],
]

// Belt and braces: strip anything shaped like an SSN from the owner details
// and warnings (company values are left alone — an EIN has the same digits).
const SSN = /\b\d{3}-?\d{2}-?\d{4}\b/g
const scrub = <T>(v: T): T => JSON.parse(JSON.stringify(v), (_k, x) => (typeof x === 'string' ? x.replace(SSN, '[SSN removed]') : x))
export function scrubProfile(p: Profile): Profile {
  return { ...p, owners: scrub(p.owners), warnings: scrub(p.warnings) }
}
