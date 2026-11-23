import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { applyChange, ChangeSchema } from '@/lib/chat/changes'

// "Do it" on a change Ask AI proposed. Plain database work, no AI. The card
// in the saved conversation is marked done so it can't be applied twice.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as { chatId?: string; change?: { id?: string } & Record<string, unknown> }
  const changeId = z.string().uuid().safeParse(body.change?.id)
  const parsed = ChangeSchema.safeParse(body.change)
  if (!parsed.success || !changeId.success) return NextResponse.json({ error: 'That change is incomplete — ask the AI to propose it again.' }, { status: 400 })

  // Already done (e.g. clicked on another device)?
  const { data: msgs } = body.chatId
    ? await supabase.from('ai_chat_messages').select('id, content').eq('chat_id', body.chatId).eq('role', 'assistant').ilike('content', `%${changeId.data}%`)
    : { data: [] as { id: string; content: string }[] }
  if ((msgs ?? []).some((m) => new RegExp('```change-done\\n[^`]*' + changeId.data).test(String(m.content))))
    return NextResponse.json({ error: 'Already done.' }, { status: 409 })

  try {
    const done = await applyChange(supabase, parsed.data, user.id)
    for (const m of msgs ?? []) {
      const content = String(m.content).replace(/```change\n(\{[^\n]*\})\n```/g, (whole, json: string) => {
        try {
          const obj = JSON.parse(json) as { id?: string }
          return obj.id === changeId.data ? `\`\`\`change-done\n${JSON.stringify({ ...obj, done })}\n\`\`\`` : whole
        } catch {
          return whole
        }
      })
      if (content !== m.content) await supabase.from('ai_chat_messages').update({ content }).eq('id', m.id)
    }
    return NextResponse.json({ ok: true, done })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not make that change' }, { status: 500 })
  }
}
