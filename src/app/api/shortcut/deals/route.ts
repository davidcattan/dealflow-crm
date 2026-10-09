import { authenticateShortcut } from '@/lib/shortcut/keys'
import { shortcutDeals } from '@/lib/shortcut/deals'

// iPhone shortcut, step 1: the active deals to pick from, one per line.
export async function GET(request: Request) {
  const auth = await authenticateShortcut(request)
  if (!auth) {
    return new Response('Your JED CRM key isn’t valid — make a new one in CRM Settings and reinstall the shortcut.', {
      status: 401,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
  const deals = await shortcutDeals(auth.supabase)
  return new Response(deals.map((d) => d.label).join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
