import type { Prospect } from './types'

// The standard cold email (David's, Oct 20, 2026). Each mailbox can replace
// it in Settings -> "Edit prospect email"; {first_name} and {company} are
// filled in per person. "Best regards," ends it — the sender's real
// signature follows.
export const DEFAULT_PROSPECT_SUBJECT = 'Asset Based Lending / Senior Debt Facility - Renewal'
export const DEFAULT_PROSPECT_BODY = [
  'Hi {first_name},',
  '',
  'I hope you’re doing well and it’s a pleasure to meet you via email.',
  '',
  'I’m looking for the most appropriate person at {company} who oversees the company’s finances and strategic planning.',
  '',
  'For context, JED Capital Group is a family-owned debt and equity investment firm based in New York City. We work with companies like {company} by facilitating asset-based facilities, senior secured term loans, and minority equity investments.',
  '',
  'I’d love the opportunity to learn more about the company and explore whether we could be a valuable resource from a financing and strategic planning perspective.',
  '',
  'Let me know if you or someone on the team has a few minutes to speak this week.',
  '',
  'Best regards,',
].join('\n')

export type ProspectTemplate = { subject?: string | null; body?: string | null }

// {first_name} / {First Name} / {company}, any spacing or case.
function fill(text: string, p: Prospect) {
  const company = p.company_display || p.company
  const first = p.first_name?.trim() || 'there'
  return text.replace(/\{\s*first[\s_]*name\s*\}/gi, first).replace(/\{\s*company\s*\}/gi, company)
}

export function prospectEmail(p: Prospect, template?: ProspectTemplate | null) {
  return {
    subject: fill(template?.subject?.trim() || DEFAULT_PROSPECT_SUBJECT, p),
    body: fill(template?.body?.trim() || DEFAULT_PROSPECT_BODY, p),
  }
}
