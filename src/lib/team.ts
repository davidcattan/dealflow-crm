// The JED team. Deals have an owner (one of these, or nobody = shared), and
// each person has their own To do list.
export const TEAM = ['David', 'Eli'] as const
export type TeamMember = (typeof TEAM)[number]

export function isTeamMember(v: unknown): v is TeamMember {
  return TEAM.includes(v as TeamMember)
}

// Who someone is, from their name or email ("eli@…", "davidjcattan1@…").
export function teamMemberOf(...hints: (string | null | undefined)[]): TeamMember | null {
  for (const hint of hints) {
    const v = (hint ?? '').trim().toLowerCase()
    const match = TEAM.find((t) => v.startsWith(t.toLowerCase()))
    if (match) return match
  }
  return null
}
