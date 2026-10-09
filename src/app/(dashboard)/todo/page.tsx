import { createClient } from '@/lib/supabase/server'
import { loadLastActivity, loadNextSteps } from '@/lib/deals/load-next-steps'
import { TODO_GROUPS, type NextStep } from '@/lib/deals/next-step'
import { TodoList, type TodoItem, type TodoSection } from './todo-list'

// "What do I need to do next?" — every active deal's next step in one list,
// most pressing first. Worked out from the deals themselves (no AI, free);
// an item goes away on its own once the deal moves on.

const INACTIVE = ['dead', 'closed', 'old']

type Item = { id: string; name: string; step: NextStep; lastActivity: string }

// Whole days since the deal's last activity.
function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

const toTodo = (i: Item): TodoItem => ({
  id: i.id,
  name: i.name,
  text: i.step.text,
  detail: i.step.detail ?? null,
  days: daysSince(i.lastActivity),
})

export default async function TodoPage() {
  const supabase = await createClient()
  const { data: deals } = await supabase.from('deals').select('id, company_name, status, updated_at')
  const active = (deals ?? []).filter((d) => !INACTIVE.includes(d.status as string))
  const ids = active.map((d) => d.id as string)
  const [steps, last] = await Promise.all([loadNextSteps(supabase, ids), loadLastActivity(supabase, ids)])

  const items: Item[] = active
    .map((d) => ({
      id: d.id as string,
      name: d.company_name as string,
      step: steps.get(d.id as string)!,
      lastActivity: last.get(d.id as string) ?? (d.updated_at as string),
    }))
    .filter((i) => i.step)
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

  return <TodoList sections={sections} waiting={waiting.map(toTodo)} />
}
