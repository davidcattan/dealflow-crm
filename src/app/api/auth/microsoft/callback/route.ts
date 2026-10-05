import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { requireUser } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens, graphFetch } from '@/lib/outlook/graph'

export async function GET(request: Request) {
  const user = await requireUser()
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error_description') || url.searchParams.get('error')

  const cookieStore = await cookies()
  const expectedState = cookieStore.get('ms_oauth_state')?.value
  cookieStore.delete('ms_oauth_state')

  if (error) {
    return NextResponse.redirect(new URL(`/settings?outlook_error=${encodeURIComponent(error)}`, request.url))
  }
  if (!code || !state || state !== expectedState) {
    return NextResponse.redirect(new URL('/settings?outlook_error=Invalid+or+expired+sign-in+attempt', request.url))
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    if (!tokens.refresh_token) {
      throw new Error('Microsoft did not return a refresh token (offline_access scope may be missing)')
    }
    const me = await graphFetch('/me?$select=mail,userPrincipalName', tokens.access_token)
    const accountEmail = me.mail || me.userPrincipalName

    const supabase = await createClient()
    // One connection per mailbox: reconnecting the same mailbox refreshes
    // it; a different mailbox is added alongside the others.
    const { data: existing } = await supabase
      .from('outlook_connections')
      .select('id')
      .ilike('account_email', accountEmail)
      .maybeSingle()
    if (existing) {
      await supabase
        .from('outlook_connections')
        .update({ refresh_token: tokens.refresh_token, connected_by: user.id, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      // A newly added inbox is read from now on — not its backlog, which
      // could repeat emails the CRM already handled from another inbox.
      await supabase.from('outlook_connections').insert({
        account_email: accountEmail,
        refresh_token: tokens.refresh_token,
        connected_by: user.id,
        last_synced_at: new Date().toISOString(),
      })
    }

    return NextResponse.redirect(new URL('/settings?outlook_connected=1', request.url))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed'
    return NextResponse.redirect(new URL(`/settings?outlook_error=${encodeURIComponent(message)}`, request.url))
  }
}
