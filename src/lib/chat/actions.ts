'use server'

import { createClient } from '@/lib/supabase/server'

export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; attached: string | null; created_at: string }

// The latest conversation for this deal (shared by the team), or the
// user's latest general one — with its messages and the deal's documents.
export async function loadChat(dealId: string | null) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { chatId: null, dealName: null, messages: [] as ChatMessage[], documents: [] as { id: string; name: string }[] }

  let query = supabase.from('ai_chats').select('id').order('updated_at', { ascending: false }).limit(1)
  query = dealId ? query.eq('deal_id', dealId) : query.is('deal_id', null).eq('created_by', user.id)
  const [{ data: chat }, { data: docs }, { data: deal }] = await Promise.all([
    query.maybeSingle(),
    dealId
      ? supabase.from('documents').select('id, file_name').eq('deal_id', dealId).order('uploaded_at')
      : Promise.resolve({ data: [] as { id: string; file_name: string }[] }),
    dealId
      ? supabase.from('deals').select('company_name').eq('id', dealId).maybeSingle()
      : Promise.resolve({ data: null as { company_name: string } | null }),
  ])

  const { data: messages } = chat
    ? await supabase
        .from('ai_chat_messages')
        .select('id, role, content, attached, created_at')
        .eq('chat_id', chat.id)
        .order('created_at')
    : { data: [] }

  return {
    chatId: (chat?.id as string | undefined) ?? null,
    dealName: (deal?.company_name as string | undefined) ?? null,
    messages: (messages ?? []) as ChatMessage[],
    documents: (docs ?? []).map((d) => ({ id: d.id as string, name: d.file_name as string })),
  }
}
