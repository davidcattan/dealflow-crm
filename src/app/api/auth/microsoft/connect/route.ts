import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { cookies } from 'next/headers'
import { requireUser } from '@/lib/dal'
import { getMicrosoftAuthUrl } from '@/lib/outlook/graph'

// Kicks off the one-time sign-in where the mailbox owner (e.g. Eli)
// approves this app creating drafts in *his own* mailbox.
export async function GET() {
  await requireUser()
  const state = randomUUID()
  const cookieStore = await cookies()
  cookieStore.set('ms_oauth_state', state, { httpOnly: true, maxAge: 600, sameSite: 'lax' })
  return NextResponse.redirect(getMicrosoftAuthUrl(state))
}
