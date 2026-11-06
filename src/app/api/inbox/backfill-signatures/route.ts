import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { parseSignature } from '@/lib/inbox/signature'

export const maxDuration = 120

type Row = { id: string; name: string | null; email: string | null; title: string | null; phone: string | null }
const blank = (s: string | null | undefined) => !s || !s.trim()

// "Reza.Anwar@provident.bank" -> "Reza Anwar". Other addresses stay as they
// are: "earato@" can't be split into a name.
function nameFromEmail(value: string) {
  const parts = value.split('@')[0].split('.').filter(Boolean)
  if (parts.length !== 2 || parts.some((p) => !/^[a-z]{2,}$/i.test(p))) return null
  return parts.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ')
}

async function allRows<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null }>, cap: number) {
  const rows: T[] = []
  for (let from = 0; from < cap; from += 1000) {
    const { data } = await read(from, from + 999)
    rows.push(...(data ?? []))
    if ((data?.length ?? 0) < 1000) break
  }
  return rows
}

// One-off, no AI: what the emails already stored say about each contact.
// Only ever fills blanks.
async function plan(supabase: SupabaseClient) {
  const contacts = await allRows<Row>(
    (a, b) => supabase.from('lender_contacts').select('id, name, email, title, phone').not('email', 'is', null).order('id').range(a, b),
    5000
  )
  const mail = await allRows<{ from_email: string; body_text: string }>(
    (a, b) =>
      supabase
        .from('inbox_messages')
        .select('from_email, body_text')
        .not('body_text', 'is', null)
        .neq('classification', 'sent')
        .order('received_at', { ascending: false })
        .range(a, b),
    3000
  )
  const bodies = new Map<string, string[]>()
  for (const m of mail) {
    const key = m.from_email?.toLowerCase()
    if (key) bodies.set(key, [...(bodies.get(key) ?? []), m.body_text])
  }

  const changes: { id: string; email: string; patch: Record<string, string> }[] = []
  for (const c of contacts) {
    const email = c.email!.toLowerCase()
    const patch: Record<string, string> = {}
    const named = blank(c.name) || c.name!.includes('@') ? nameFromEmail(c.email!) : c.name
    if (named && named !== c.name) patch.name = named
    for (const body of bodies.get(email) ?? []) {
      if (!blank(c.phone) && !blank(c.title)) break
      const sig = parseSignature(body, named)
      if (sig.phone && blank(c.phone) && !patch.phone) patch.phone = sig.phone
      if (sig.title && blank(c.title) && !patch.title) patch.title = sig.title
    }
    if (Object.keys(patch).length) changes.push({ id: c.id, email, patch })
  }
  return { contacts: contacts.length, emailsRead: mail.length, changes }
}

async function auth() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ? supabase : null
}

// Preview: nothing is saved.
export async function GET() {
  const supabase = await auth()
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { contacts, emailsRead, changes } = await plan(supabase)
  return NextResponse.json({
    contacts,
    emailsRead,
    toUpdate: changes.length,
    phones: changes.filter((c) => c.patch.phone).length,
    titles: changes.filter((c) => c.patch.title).length,
    names: changes.filter((c) => c.patch.name).length,
    sample: changes.slice(0, 60),
  })
}

export async function POST() {
  const supabase = await auth()
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { changes } = await plan(supabase)
  let saved = 0
  for (const c of changes) {
    const { error } = await supabase.from('lender_contacts').update(c.patch).eq('id', c.id)
    if (!error) saved++
  }
  return NextResponse.json({ saved, of: changes.length })
}
