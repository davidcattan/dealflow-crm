import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { addUsage, emptyUsage, logUsage, usageCost } from '@/lib/usage'
import { friendlyAiError } from '@/lib/ai-errors'
import { buildDealContext, buildPipelineContext, CHAT_RULES } from '@/lib/chat/context'
import { CHAT_TOOLS, runChatTool, TOOL_LIMITS } from '@/lib/chat/tools'
import { buildDocumentContent } from '@/lib/underwriting/build-content'
import type { DocumentRecord } from '@/lib/types'

export const maxDuration = 300

// Quick: Sonnet — cheap, fine for most questions and drafting. Deep: Opus,
// for hard reading (a full tax return, a messy file).
const MODELS = {
  quick: { model: 'claude-sonnet-5-5', effort: 'medium' as const },
  deep: { model: 'claude-opus-5-5', effort: 'high' as const },
}
const HISTORY_LIMIT = 30

// Lines the panel shows in grey while the AI works (not saved), and the
// cost of the answer at the very end.
const status = (s: string) => `\n⟦${s}⟧\n`

// "Ask AI": one question in a conversation, answered as a text stream. The
// AI can open the deal's documents and look things up in the CRM itself
// (read-only tools), within per-question limits. The deal (or pipeline)
// context is a cached system block, so follow-ups cost much less.
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
    deep?: boolean
  }
  const text = (body.message ?? '').trim()
  if (!text) return new Response('Empty message', { status: 400 })
  const dealId = body.dealId || null
  const mode = body.deep ? 'deep' : 'quick'
  const { model, effort } = MODELS[mode]
  const limits = TOOL_LIMITS[mode]

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
    const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t, i) =>
      i === turns.length - 1 && docBlocks.length
        ? { role: t.role, content: [...(docBlocks as Anthropic.Beta.BetaContentBlockParam[]), { type: 'text', text: t.text }] }
        : { role: t.role, content: t.text }
    )

    const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const client = new Anthropic()
    const encoder = new TextEncoder()
    const budget = { imagesLeft: limits.images, charsLeft: limits.chars }
    const usage = emptyUsage()

    const readable = new ReadableStream({
      async start(controller) {
        const send = (s: string) => controller.enqueue(encoder.encode(s))
        let answer = ''
        try {
          for (let round = 0; round < limits.rounds; round++) {
            const lastRound = round === limits.rounds - 1
            const stream = client.beta.messages.stream(
              {
                model,
                max_tokens: 16000,
                thinking: { type: 'adaptive' },
                output_config: { effort },
                // Re-routes the rare safety decline to another model instead of failing.
                betas: ['server-side-fallback-2026-07-01'],
                fallbacks: 'default',
                // Each round re-sends the conversation so far; caching makes
                // the repeated part cost a tenth.
                cache_control: { type: 'ephemeral' },
                system: [
                  { type: 'text', text: CHAT_RULES },
                  { type: 'text', text: `Today is ${today}.\n\n${contextText}`, cache_control: { type: 'ephemeral' } },
                ],
                tools: CHAT_TOOLS,
                // Out of rounds: answer with what it has.
                tool_choice: lastRound ? { type: 'none' } : { type: 'auto' },
                messages,
              },
              { signal: request.signal }
            )
            let wroteThisRound = false
            stream.on('text', (delta) => {
              // Keep text from separate rounds in separate paragraphs.
              if (!wroteThisRound && answer && !answer.endsWith('\n')) {
                answer += '\n\n'
                send('\n\n')
              }
              wroteThisRound = true
              answer += delta
              send(delta)
            })
            const message = await stream.finalMessage()
            addUsage(usage, message.usage)

            if (message.stop_reason === 'pause_turn') {
              messages.push({ role: 'assistant', content: message.content })
              continue
            }
            const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
            if (message.stop_reason !== 'tool_use' || !toolUses.length) {
              if (message.stop_reason === 'refusal') send('\n\n⚠️ The AI declined to answer that one.')
              break
            }

            messages.push({ role: 'assistant', content: message.content })
            const results = await Promise.all(toolUses.map((b) => runChatTool({ supabase, dealId, budget }, b)))
            for (const r of results) send(status(r.status))
            messages.push({
              role: 'user',
              content: toolUses.map((b, i) => ({
                type: 'tool_result' as const,
                tool_use_id: b.id,
                content: results[i].content as Anthropic.Beta.BetaToolResultBlockParam['content'],
                is_error: results[i].isError || undefined,
              })),
            })
          }

          await logUsage({ feature: mode === 'deep' ? 'ai-chat-deep' : 'ai-chat', model, dealId, usage })
          send(`\n⟦cost:${usageCost(model, usage).toFixed(4)}⟧`)
          if (answer.trim()) {
            await supabase.from('ai_chat_messages').insert({ chat_id: chatId, role: 'assistant', content: answer })
          }
          await supabase.from('ai_chats').update({ updated_at: new Date().toISOString() }).eq('id', chatId)
        } catch (err) {
          if (usage.input_tokens) await logUsage({ feature: 'ai-chat', model, dealId, usage })
          send(`\n\n⚠️ ${friendlyAiError(err, 'The answer was cut off.')}`)
          if (answer.trim()) await supabase.from('ai_chat_messages').insert({ chat_id: chatId, role: 'assistant', content: answer })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Chat-Id': chatId, 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    return new Response(friendlyAiError(err, 'Ask AI failed'), { status: 500, headers: { 'X-Chat-Id': chatId } })
  }
}
