import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { textToEmailHtml } from './email-html'

const TENANT = process.env.MICROSOFT_TENANT_ID!
const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID!
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET!
const SCOPE = 'offline_access Mail.ReadWrite'

function redirectUri() {
  // Must exactly match what's registered in Azure. Falls back to the known
  // production URL if VERCEL_URL isn't set (e.g. local dev against prod).
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://dealflow-crm-gamma.vercel.app'
  return `${base}/api/auth/microsoft/callback`
}

export function getMicrosoftAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: SCOPE,
    state,
    prompt: 'select_account',
  })
  return `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?${params.toString()}`
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(json.error_description || json.error || 'Microsoft token request failed')
  }
  return json
}

export async function exchangeCodeForTokens(code: string) {
  return tokenRequest({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    scope: SCOPE,
  })
}

async function refreshTokens(refreshToken: string) {
  return tokenRequest({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: SCOPE,
  })
}

export type OutlookConnection = {
  id: string
  account_email: string
  refresh_token: string
  connected_by: string | null
  last_synced_at?: string | null
}

// Every connected mailbox (one per team member who connected Outlook).
export async function listConnections(client?: SupabaseClient): Promise<OutlookConnection[]> {
  const supabase = client ?? (await createClient())
  const { data } = await supabase.from('outlook_connections').select('*').order('created_at', { ascending: true })
  return (data ?? []) as OutlookConnection[]
}

// Refreshes one mailbox's access and persists whatever new refresh token
// Microsoft hands back (they rotate it on each use). Uses the given
// connection, or the most recently connected one if none is specified.
// Throws a clear error if nothing is connected yet.
export async function getValidAccessToken(
  client?: SupabaseClient,
  connectionId?: string | null
): Promise<{ accessToken: string; accountEmail: string; connectionId: string }> {
  const supabase = client ?? (await createClient())
  let query = supabase.from('outlook_connections').select('*')
  query = connectionId ? query.eq('id', connectionId) : query.order('updated_at', { ascending: false }).limit(1)
  const { data: connection } = await query.maybeSingle()

  if (!connection) {
    throw new Error(
      connectionId
        ? 'That Outlook mailbox is no longer connected. Reconnect it in Settings.'
        : 'Outlook is not connected yet. Go to Settings and connect it first.'
    )
  }

  const tokens = await refreshTokens(connection.refresh_token)

  if (tokens.refresh_token && tokens.refresh_token !== connection.refresh_token) {
    await supabase
      .from('outlook_connections')
      .update({ refresh_token: tokens.refresh_token, updated_at: new Date().toISOString() })
      .eq('id', connection.id)
  }

  return { accessToken: tokens.access_token, accountEmail: connection.account_email, connectionId: connection.id }
}

export async function graphFetch(path: string, accessToken: string, init?: RequestInit) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Graph API error (${res.status}): ${text.slice(0, 300)}`)
  }
  return res.status === 204 ? null : res.json()
}

export type DraftAttachment = { name: string; contentType: string; contentBytes: string }

// Creates a draft in the connected mailbox's Drafts folder. Nothing is
// sent — the person opens Outlook and reviews/sends it themselves.
// Attachments over ~3MB each are skipped (Graph's direct-attach limit);
// larger files need a resumable upload session, not implemented here.
export async function createOutlookDraft({
  accessToken,
  to,
  cc = [],
  subject,
  body,
  attachments,
}: {
  accessToken: string
  to: { name?: string | null; email: string }
  cc?: { name?: string | null; email: string }[]
  subject: string
  body: string
  attachments: DraftAttachment[]
}) {
  const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024
  const included = attachments.filter((a) => Buffer.byteLength(a.contentBytes, 'base64') <= MAX_ATTACHMENT_BYTES)
  const skipped = attachments.filter((a) => !included.includes(a)).map((a) => a.name)

  const message = await graphFetch('/me/messages', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      subject,
      // Sent as formatted HTML so bullets, bold labels and spacing survive.
      body: { contentType: 'html', content: textToEmailHtml(body) },
      toRecipients: [{ emailAddress: { address: to.email, name: to.name ?? undefined } }],
      ccRecipients: cc.map((c) => ({ emailAddress: { address: c.email, name: c.name ?? undefined } })),
      attachments: included.map((a) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.name,
        contentType: a.contentType,
        contentBytes: a.contentBytes,
      })),
    }),
  })

  return {
    messageId: message.id as string,
    conversationId: message.conversationId as string,
    webLink: message.webLink as string,
    skipped,
  }
}

export type MessageAttachment = { name: string; contentType: string; size: number; contentBytes: string }

// Real file attachments on a message (inline images like signature logos
// are skipped). Graph returns small attachments' bytes inline.
export async function getMessageAttachments(accessToken: string, messageId: string): Promise<MessageAttachment[]> {
  const json = await graphFetch(`/me/messages/${messageId}/attachments`, accessToken)
  return (json.value as Array<Record<string, unknown>>)
    .filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment' && !a.isInline && a.contentBytes)
    .map((a) => ({
      name: a.name as string,
      contentType: (a.contentType as string) || 'application/octet-stream',
      size: Number(a.size ?? 0),
      contentBytes: a.contentBytes as string,
    }))
}

export type InboxMessage = {
  id: string
  conversationId: string
  subject: string
  from: string
  fromName: string
  receivedDateTime: string
  internetMessageId: string | null
  hasAttachments: boolean
  bodyPreview: string
  bodyText: string
}

const MESSAGE_SELECT = '$select=id,internetMessageId,conversationId,subject,from,receivedDateTime,hasAttachments,bodyPreview,body'
// Plain-text bodies are far smaller than HTML for the AI to read.
const TEXT_BODY = { headers: { Prefer: 'outlook.body-content-type="text"' } }

function toInboxMessage(m: Record<string, unknown>): InboxMessage {
  const body = m.body as { content?: string } | undefined
  const text = (body?.content ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/<?https?:\/\/\S{60,}>?/g, '[link]')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const from = m.from as { emailAddress?: { address?: string; name?: string } } | undefined
  return {
    id: m.id as string,
    internetMessageId: (m.internetMessageId as string | undefined) ?? null,
    conversationId: m.conversationId as string,
    subject: (m.subject as string) ?? '',
    from: (from?.emailAddress?.address ?? '').toLowerCase(),
    fromName: from?.emailAddress?.name ?? '',
    receivedDateTime: m.receivedDateTime as string,
    hasAttachments: Boolean(m.hasAttachments),
    bodyPreview: (m.bodyPreview as string) ?? '',
    bodyText: text.slice(0, 8000),
  }
}

// Inbox messages received after `sinceIso`, OLDEST first, capped at `top`.
// Oldest-first matters: if more mail arrived than one run handles, the
// next run picks up exactly where this one stopped instead of skipping
// the backlog. Bodies are converted to plain text and truncated.
export async function listInboxMessagesSince(accessToken: string, sinceIso: string, top = 25): Promise<InboxMessage[]> {
  const filter = `$filter=${encodeURIComponent(`receivedDateTime gt ${sinceIso}`)}`
  const json = await graphFetch(
    `/me/mailFolders/inbox/messages?${filter}&${MESSAGE_SELECT}&$orderby=receivedDateTime asc&$top=${top}`,
    accessToken,
    TEXT_BODY
  )
  return (json.value as Array<Record<string, unknown>>).map(toInboxMessage)
}

// One message by id (used to retry an email that was already recorded).
export async function getInboxMessage(accessToken: string, messageId: string): Promise<InboxMessage> {
  const json = await graphFetch(`/me/messages/${messageId}?${MESSAGE_SELECT}`, accessToken, TEXT_BODY)
  return toInboxMessage(json)
}

export type InboxStatus = {
  newest: { receivedDateTime: string; subject: string; from: string } | null
  // Emails received after `sinceIso` — i.e. not read by the CRM yet.
  waiting: number
  waitingCapped: boolean
}

// Newest email in the inbox and how many arrived after `sinceIso`.
// Metadata only, no AI — free to call as often as needed.
export async function getInboxStatus(accessToken: string, sinceIso: string, cap = 500): Promise<InboxStatus> {
  const filter = `$filter=${encodeURIComponent(`receivedDateTime gt ${sinceIso}`)}`
  const [newestJson, waitingJson] = await Promise.all([
    graphFetch(
      '/me/mailFolders/inbox/messages?$select=subject,from,receivedDateTime&$orderby=receivedDateTime desc&$top=1',
      accessToken
    ),
    graphFetch(`/me/mailFolders/inbox/messages?${filter}&$select=receivedDateTime&$top=${cap}`, accessToken),
  ])
  const n = (newestJson.value as Array<Record<string, unknown>>)[0]
  const from = n?.from as { emailAddress?: { address?: string; name?: string } } | undefined
  return {
    newest: n
      ? {
          receivedDateTime: n.receivedDateTime as string,
          subject: (n.subject as string) ?? '',
          from: from?.emailAddress?.name || from?.emailAddress?.address || '',
        }
      : null,
    // Graph matches "gt" at sub-second precision, so the last email already
    // read (same second as the read-through point) can sneak back in —
    // only count ones strictly later.
    waiting: (waitingJson.value as Array<{ receivedDateTime: string }>).filter(
      (m) => new Date(m.receivedDateTime).getTime() > new Date(sinceIso).getTime()
    ).length,
    waitingCapped: Boolean(waitingJson['@odata.nextLink']),
  }
}

// The sent copy of a message in this thread, if the mailbox owner has sent
// one (used to notice that a CRM-created draft went out). No AI — free.
export async function findSentInConversation(
  accessToken: string,
  conversationId: string
): Promise<{ sentDateTime: string; subject: string } | null> {
  const filter = encodeURIComponent(`conversationId eq '${conversationId.replace(/'/g, "''")}'`)
  const json = await graphFetch(
    `/me/mailFolders/sentitems/messages?$filter=${filter}&$select=subject,sentDateTime&$top=5`,
    accessToken
  )
  const sent = (json.value as Array<{ subject?: string; sentDateTime?: string }>)
    .filter((m) => m.sentDateTime)
    .sort((a, b) => (a.sentDateTime! < b.sentDateTime! ? -1 : 1))[0]
  return sent ? { sentDateTime: sent.sentDateTime!, subject: sent.subject ?? '' } : null
}

export type SentMessage = {
  id: string
  internetMessageId: string | null
  conversationId: string
  subject: string
  sentDateTime: string
  to: { email: string; name: string }[]
  bodyText: string
}

// Sent Items after `sinceIso`, oldest first (same catch-up logic as the
// inbox). Recipients include To and CC.
export async function listSentMessagesSince(accessToken: string, sinceIso: string, top = 25): Promise<SentMessage[]> {
  const filter = `$filter=${encodeURIComponent(`sentDateTime gt ${sinceIso}`)}`
  const select = '$select=id,internetMessageId,conversationId,subject,sentDateTime,toRecipients,ccRecipients,body'
  const json = await graphFetch(
    `/me/mailFolders/sentitems/messages?${filter}&${select}&$orderby=sentDateTime asc&$top=${top}`,
    accessToken,
    TEXT_BODY
  )
  type Rcpt = { emailAddress?: { address?: string; name?: string } }
  return (json.value as Array<Record<string, unknown>>).map((m) => ({
    id: m.id as string,
    internetMessageId: (m.internetMessageId as string | undefined) ?? null,
    conversationId: m.conversationId as string,
    subject: (m.subject as string) ?? '',
    sentDateTime: m.sentDateTime as string,
    to: [...((m.toRecipients as Rcpt[]) ?? []), ...((m.ccRecipients as Rcpt[]) ?? [])]
      .map((r) => ({ email: (r.emailAddress?.address ?? '').toLowerCase(), name: r.emailAddress?.name ?? '' }))
      .filter((r) => r.email),
    bodyText: toInboxMessage({ ...m, from: null }).bodyText,
  }))
}
