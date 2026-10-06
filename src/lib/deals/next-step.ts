// "What do I do next on this deal?" — worked out from the deal's own data
// (documents, underwriting, matches, who it was sent to and how each lender
// responded, how long things have been quiet). No AI, so it's free and
// always current.

export type NextStepUrgency = 'you' | 'follow_up' | 'waiting' | 'done'

export type NextStep = { urgency: NextStepUrgency; text: string; detail?: string }

export type NextStepInput = {
  status: string
  createdAt: string
  docCount: number
  hasUnderwriting: boolean
  underwritingQueued: boolean
  matchCount: number
  draftCount: number
  submissions: { lender: string; status: string; sentOn: string | null; lastActivityAt: string }[]
  // Latest "Asked for: …" per lender, from logged lender replies.
  requestsByLender?: Record<string, string>
  lastActivityAt: string
}

const FOLLOW_UP_AFTER_DAYS = 5
const STALE_AFTER_DAYS = 14

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function names(list: string[], max = 2) {
  if (list.length <= max) return list.join(' and ')
  return `${list.slice(0, max).join(', ')} +${list.length - max} more`
}

export function nextStep(d: NextStepInput): NextStep {
  const subs = d.submissions
  const by = (s: string) => subs.filter((x) => x.status === s)

  if (by('funded').length) return { urgency: 'done', text: `Funded by ${names(by('funded').map((s) => s.lender))} — mark the deal Closed` }

  const termSheets = by('term_sheet')
  if (termSheets.length) return { urgency: 'you', text: `Review the term sheet from ${names(termSheets.map((s) => s.lender))} with the borrower` }

  const needInfo = by('needs_more_info')
  if (needInfo.length) {
    const first = needInfo[0]
    const asked = d.requestsByLender?.[first.lender]
    return {
      urgency: 'you',
      text: `Send ${names(needInfo.map((s) => s.lender))} what they asked for`,
      detail: asked ? `${first.lender} asked for: ${asked}` : undefined,
    }
  }

  const interested = by('interested')
  if (interested.length) return { urgency: 'you', text: `Set up a call with ${names(interested.map((s) => s.lender))} — interested` }

  if (d.underwritingQueued) {
    return { urgency: 'waiting', text: 'Underwriting queued — tell Claude Code "process the underwriting queue"' }
  }

  if (subs.length === 0) {
    if (d.docCount === 0) return { urgency: 'you', text: 'Get documents from the borrower' }
    if (!d.hasUnderwriting) return { urgency: 'you', text: `Underwrite the deal (${d.docCount} document${d.docCount === 1 ? '' : 's'} in)` }
    if (d.matchCount === 0) return { urgency: 'you', text: 'Find matching lenders' }
    return {
      urgency: 'you',
      text: `Send to your top lenders${d.draftCount ? ` (${d.draftCount} draft${d.draftCount === 1 ? '' : 's'} ready)` : ''}`,
    }
  }

  const waiting = by('sent')
  if (waiting.length === 0) {
    // Everyone answered and nobody is moving forward.
    return {
      urgency: 'you',
      text: subs.length === 1 ? `${subs[0].lender} passed — find new lenders` : `All ${subs.length} lenders passed — find new lenders`,
    }
  }

  const overdue = waiting.filter((s) => daysSince(s.lastActivityAt) >= FOLLOW_UP_AFTER_DAYS)
  if (overdue.length) {
    const days = Math.max(...overdue.map((s) => daysSince(s.lastActivityAt)))
    return { urgency: 'follow_up', text: `Follow up with ${names(overdue.map((s) => s.lender))} — no reply in ${days} days` }
  }

  const sentDays = Math.max(...waiting.map((s) => daysSince(s.sentOn ?? s.lastActivityAt)))
  const quiet = daysSince(d.lastActivityAt)
  return {
    urgency: 'waiting',
    text: `Waiting on ${waiting.length} lender${waiting.length === 1 ? '' : 's'} — sent ${sentDays === 0 ? 'today' : `${sentDays} day${sentDays === 1 ? '' : 's'} ago`}`,
    detail: quiet >= STALE_AFTER_DAYS ? `No activity in ${quiet} days` : undefined,
  }
}

export const URGENCY_STYLES: Record<NextStepUrgency, { label: string; dot: string; pill: string }> = {
  you: { label: 'Your move', dot: 'bg-red-500', pill: 'bg-red-50 text-red-700 border-red-200' },
  follow_up: { label: 'Follow up', dot: 'bg-amber-500', pill: 'bg-amber-50 text-amber-800 border-amber-200' },
  waiting: { label: 'Waiting', dot: 'bg-slate-300', pill: 'bg-slate-50 text-slate-600 border-slate-200' },
  done: { label: 'Done', dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}

// Pulls "Asked for: a; b; c." out of logged lender-reply notes.
export function extractAskedFor(note: string): string | null {
  const m = note.match(/Asked for:\s*([\s\S]+?)\.?\s*$/)
  return m ? m[1].trim() : null
}
