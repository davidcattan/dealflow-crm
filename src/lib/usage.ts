import 'server-only'
import { createClient } from '@/lib/supabase/server'

// USD per million tokens. Cache reads bill at 0.1x input, cache writes at
// 1.25x. Web search is billed per request (~$10 per 1,000 — an estimate).
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-haiku-4-5': { in: 1, out: 5 },
}
const WEB_SEARCH_USD = 0.01

export type UsageLike = {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  server_tool_use?: { web_search_requests?: number | null } | null
}

export function addUsage(total: Required<Record<keyof Omit<UsageLike, 'server_tool_use'> | 'web_searches', number>>, u: UsageLike | undefined) {
  if (!u) return
  total.input_tokens += u.input_tokens ?? 0
  total.output_tokens += u.output_tokens ?? 0
  total.cache_read_input_tokens += u.cache_read_input_tokens ?? 0
  total.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0
  total.web_searches += u.server_tool_use?.web_search_requests ?? 0
}

export function emptyUsage() {
  return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, web_searches: 0 }
}

// Best-effort: a logging failure must never break the AI feature itself.
export async function logUsage(opts: {
  feature: string
  model: string
  dealId?: string | null
  usage: UsageLike | (ReturnType<typeof emptyUsage>) | undefined
}) {
  try {
    const u = opts.usage as Record<string, unknown> | undefined
    if (!u) return
    const input = Number(u.input_tokens ?? 0)
    const output = Number(u.output_tokens ?? 0)
    const cacheRead = Number(u.cache_read_input_tokens ?? 0)
    const cacheWrite = Number(u.cache_creation_input_tokens ?? 0)
    const searches = Number(
      u.web_searches ?? (u.server_tool_use as { web_search_requests?: number } | undefined)?.web_search_requests ?? 0
    )
    const p = PRICES[opts.model] ?? PRICES['claude-opus-5']
    const cost =
      (input * p.in + output * p.out + cacheRead * p.in * 0.1 + cacheWrite * p.in * 1.25) / 1_000_000 +
      searches * WEB_SEARCH_USD

    const supabase = await createClient()
    await supabase.from('ai_usage').insert({
      deal_id: opts.dealId ?? null,
      feature: opts.feature,
      model: opts.model,
      input_tokens: input,
      output_tokens: output,
      cache_read_tokens: cacheRead,
      cache_write_tokens: cacheWrite,
      web_searches: searches,
      cost_usd: Number(cost.toFixed(4)),
    })
  } catch (err) {
    console.error('Usage logging failed', err)
  }
}
