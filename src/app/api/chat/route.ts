import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { logUsage } from '@/lib/usage'
import { friendlyAiError } from '@/lib/ai-errors'
import { buildDealContext, buildPipelineContext, CHAT_RULES } from '@/lib/chat/context'
import { buildDocumentContent } from '@/lib/underwriting/build-content'
import type { DocumentRecord } from '@/lib/types'

export const maxDuration = 300

// Sonnet: ~60% cheaper than Opus and strong at drafting and Q&A.
const MODEL = 'claude-sonnet-5-5'
const HISTORY_LIMIT = 30

// "Ask AI": one question in a conversation, answered as a text stream.
// The deal (or pipeline) context is sent as a cached system block, so
// follow-up questions in the same conversation cost much less.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const body = (await request.json().catch(() => ({}))) as {
    dealId?: string | null
    chatId?: string | null
    message?: string
    documentIds?: string[]
  }
  const text = (body.message ?? '').trim()
  if (!text) return new Response('Empty message', { status: 400 })
  const dealId = body.dealId || null

  // Find or start the conversation.
  let chatId = body.chatId || null
  if (!chatId) {
    const { data: created, error } = await supabase
      .from('ai_chats')
      .insert({ deal_id: dealId, created_by: user.id })
      .select('id')
      .single()
    if (error || !created) return new Response('Could not start a conversation (run the latest Supabase step).', { status: 500 })
    chatId = created.id as string
  }

  try {
    const context = dealId ? await buildDealContext(supabase, dealId) : null
    const contextText = context ? context.text : await buildPipelineContext(supabase)

    const attachedDocs = context && body.documentIds?.length ? context.documents.filter((d) => body.documentIds!.includes(d.id)) : []
    await supabase.from('ai_chat_messages').insert({
      chat_id: chatId,
      role: 'user',
      content: text,
      attached: attachedDocs.length ? attachedDocs.map((d) => d.file_name).join(', ') : null,
      created_by: user.id,
    })

    const { data: history } = await supabase
      .from('ai_chat_messages')
      .select('role, content, attached')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT)
    const ordered = (history ?? []).reverse()

    // Merge any back-to-back same-role turns (e.g. after a failed answer).
    const turns: { role: 'user' | 'assistant'; text: string }[] = []
    for (const m of ordered) {
      const t = m.attached && m.role === 'user' ? `${m.content}\n\n[Attached: ${m.attached}]` : m.content
      const last = turns[turns.length - 1]
      if (last && last.role === m.role) last.text += `\n\n${t}`
      else turns.push({ role: m.role as 'user' | 'assistant', text: t })
    }
    while (turns.length && turns[0].role !== 'user') turns.shift()

    // Attached documents go with the newest question only.
    const docBlocks = attachedDocs.length ? (await buildDocumentContent(supabase, attachedDocs as DocumentRecord[])).blocks : []
    const messages: Anthropic.MessageParam[] = turns.map((t, i) =>
      i === turns.length - 1 && docBlocks.length
        ? { role: t.role, content: [...(docBlocks as Anthropic.ContentBlockParam[]), { type: 'text', text: t.text }] }
        : { role: t.role, content: t.text }
    )

    const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const client = new Anthropic()
    const stream = client.messages.stream(
      {
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        system: [
          { type: 'text', text: CHAT_RULES },
          { type: 'text', text: `Today is ${today}.\n\n${contextText}`, cache_control: { type: 'ephemeral' } },
        ],
        messages,
      },
      { signal: request.signal }
    )

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        let answer = ''
        stream.on('text', (delta) => {
          answer += delta
          controller.enqueue(encoder.encode(delta))
        })
        try {
          const final = await stream.finalMessage()
          await logUsage({ feature: 'ai-chat', model: MODEL, dealId, usage: final.usage })
          if (answer.trim()) {
            await supabase.from('ai_chat_messages').insert({ chat_id: chatId, role: 'assistant', content: answer })
          }
          await supabase.from('ai_chats').update({ updated_at: new Date().toISOString() }).eq('id', chatId)
        } catch (err) {
          controller.enqueue(encoder.encode(`\n\n⚠️ ${friendlyAiError(err, 'The answer was cut off.')}`))
        } finally {
          controller.close()
        }
      },
      cancel() {
        stream.abort()
      },
    })

    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Chat-Id': chatId, 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    return new Response(friendlyAiError(err, 'Ask AI failed'), { status: 500, headers: { 'X-Chat-Id': chatId } })
  }
}
