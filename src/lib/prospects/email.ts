import type { Prospect } from './types'

// The cold email David wrote (Oct 20, 2026): an introduction asking for the
// person who runs finance and strategic planning, "Best regards," — the
// sender's real signature follows.
export function prospectEmail(p: Prospect) {
  const company = p.company_display || p.company
  const first = p.first_name?.trim() || 'there'

  return {
    subject: `${company} — introduction`,
    body: [
      `Hi ${first},`,
      '',
      'I hope you’re doing well and it’s a pleasure to meet you via email.',
      '',
      `I’m looking for the most appropriate person at ${company} who oversees the company’s finances and strategic planning.`,
      '',
      `For context, JED Capital Group is a family-owned debt and equity investment firm based in New York City. We work with companies like ${company} by facilitating asset-based facilities, senior secured term loans, and minority equity investments.`,
      '',
      'I’d love the opportunity to learn more about the company and explore whether we could be a valuable resource from a financing and strategic planning perspective.',
      '',
      'Let me know if you or someone on the team has a few minutes to speak this week.',
      '',
      'Best regards,',
    ].join('\n'),
  }
}
