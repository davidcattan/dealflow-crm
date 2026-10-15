import { createClient } from '@/lib/supabase/server'
import { loadLastActivity, loadNextSteps } from '@/lib/deals/load-next-steps'
import { TODO_GROUPS, type NextStep } from '@/lib/deals/next-step'
import { TEAM, isTeamMember, teamMemberOf, type TeamMember } from '@/lib/team'
import { TodoList, type MyTodo, type TodoItem, type TodoSection } from './todo-list'

// "What do I need to do next?" — every active deal's next step in one list,
// most pressing first, plus to-dos the team writes themselves. Each person
// sees their own deals (and shared ones). Worked out from the deals
// themselves (no AI, free); an item goes away on its own once the deal
// moves on.

const INACTIVE = ['dead', 'closed', 'old']

type Item = { id: string; name: string; owner: string | null; step: NextStep; lastActivity: string }

// Whole days since the deal's last activity.
function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

const toTodo = (i: Item): TodoItem => ({
  id: i.id,
  name: i.name,
  owner: isTeamMember(i.owner) ? i.owner : null,
  text: i.step.text,
  detail: i.step.detail ?? null,
  days: daysSince(i.lastActivity),
})

type DealRow = { id: string; company_name: string; status: string; updated_at: string; owner?: string | null }

export default async function TodoPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const { who: whoParam } = await searchParams
  const supabase = await createClient()

  // Who's looking — their list opens by default.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const [{ data: profile }, { data: mailbox }] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user?.id ?? '').maybeSingle(),
    supabase.from('outlook_connections').select('account_email').eq('connected_by', user?.id ?? '').limit(1).maybeSingle(),
  ])
  const me = teamMemberOf(profile?.full_name, mailbox?.account_email, user?.email)
  const asked = TEAM.find((t) => t.toLowerCase() === whoParam?.toLowerCase())
  const who: TeamMember | 'all' = whoParam === 'all' ? 'all' : (asked ?? me ?? 'all')

  // Works before the owner column exists (037 not run yet): everyone shares.
  const withOwner = await supabase.from('deals').select('id, company_name, status, updated_at, owner')
  const deals = (
    withOwner.error ? (await supabase.from('deals').select('id, company_name, status, updated_at')).data : withOwner.data
  ) as DealRow[] | null
  const active = (deals ?? []).filter((d) => !INACTIVE.includes(d.status))
  const ids = active.map((d) => d.id)
  const [steps, last, { data: todoRows }] = await Promise.all([
    loadNextSteps(supabase, ids),
    loadLastActivity(supabase, ids),
    supabase
      .from('todos')
      .select('id, text, assignee, deal_id, due_date, created_at')
      .is('done_at', null)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
  ])

  const mine = (owner: string | null | undefined) => who === 'all' || !isTeamMember(owner) || owner === who

  // Steps dismissed on this page stay hidden until the deal has new activity
  // (empty before migration 045).
  const { data: dismissedRows } = await supabase.from('deals').select('id, step_dismissed, step_dismissed_at').not('step_dismissed', 'is', null)
  const dismissed = new Map((dismissedRows ?? []).map((r) => [r.id as string, { text: r.step_dismissed as string, at: r.step_dismissed_at as string }]))
  const isDismissed = (dealId: string, text: string) => {
    const d = dismissed.get(dealId)
    const act = last.get(dealId)
    return Boolean(d && d.text === text && (!act || act <= d.at))
  }

  const items: Item[] = active
    .filter((d) => mine(d.owner))
    .map((d) => ({
      id: d.id,
      name: d.company_name,
      owner: d.owner ?? null,
      step: steps.get(d.id)!,
      lastActivity: last.get(d.id) ?? d.updated_at,
    }))
    .filter((i) => i.step && !isDismissed(i.id, i.step.text))
    // Most pressing kind first; within a kind, whatever's been sitting longest.
    .sort((a, b) => (a.step.rank ?? 9) - (b.step.rank ?? 9) || a.lastActivity.localeCompare(b.lastActivity))

  // Sections in the team's order of importance; waiting deals at the end.
  const todo = items.filter((i) => (i.step.rank ?? 9) <= 6)
  const waiting = items.filter((i) => (i.step.rank ?? 9) > 6)
  const sections: TodoSection[] = Object.entries(TODO_GROUPS)
    .map(([rank, title]) => ({
      rank: Number(rank),
      title,
      items: todo.filter((i) => i.step.rank === Number(rank)).map(toTodo),
    }))
    .filter((g) => g.items.length)

  const dealName = new Map(active.map((d) => [d.id, d.company_name]))
  const myTodos: MyTodo[] = (todoRows ?? [])
    .filter((t) => who === 'all' || t.assignee === who)
    .map((t) => ({
      id: t.id as string,
      text: t.text as string,
      assignee: t.assignee as string,
      dueDate: (t.due_date as string | null) ?? null,
      deal: t.deal_id ? { id: t.deal_id as string, name: dealName.get(t.deal_id as string) ?? 'Deal' } : null,
    }))

  const dealOptions = [...active]
    .sort((a, b) => a.company_name.localeCompare(b.company_name))
    .map((d) => ({ id: d.id, name: d.company_name }))

  return (
    <TodoList
      who={who}
      me={me}
      sections={sections}
      waiting={waiting.map(toTodo)}
      todos={myTodos}
      deals={dealOptions}
    />
  )
}
