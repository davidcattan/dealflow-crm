import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export type NotificationKind = 'new_deal' | 'deal_update' | 'lender_reply' | 'sent' | 'needs_review'

// Adds an entry to the activity feed. Best-effort: never blocks the work
// that caused it.
export async function notify(
  supabase: SupabaseClient,
  n: { kind: NotificationKind; title: string; body?: string | null; dealId?: string | null; lenderId?: string | null }
) {
  try {
    await supabase.from('notifications').insert({
      kind: n.kind,
      title: n.title.slice(0, 300),
      body: n.body ? n.body.slice(0, 1000) : null,
      deal_id: n.dealId ?? null,
      lender_id: n.lenderId ?? null,
    })
  } catch {
    // Feed is a convenience — ignore failures.
  }
}

// Unread count for the signed-in user (header bell).
export async function unreadCount(supabase: SupabaseClient, userId: string) {
  const { data: seen } = await supabase.from('notification_seen').select('seen_at').eq('user_id', userId).maybeSingle()
  let query = supabase.from('notifications').select('id', { count: 'exact', head: true })
  if (seen?.seen_at) query = query.gt('created_at', seen.seen_at)
  const { count, error } = await query
  return error ? 0 : (count ?? 0)
}
