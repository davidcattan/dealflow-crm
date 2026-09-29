import 'server-only'
import { createClient } from '@/lib/supabase/server'

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

// Reads the single stored connection, refreshes it, and persists whatever
// new refresh token Microsoft hands back (they rotate it on each use).
// Throws a clear error if nothing is connected yet.
export async function getValidAccessToken(): Promise<{ accessToken: string; accountEmail: string; connectionId: string }> {
  const supabase = await createClient()
  const { data: connection } = await supabase
    .from('outlook_connections')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  if (!connection) {
    throw new Error('Outlook is not connected yet. Go to Settings and connect it first.')
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
  subject,
  body,
  attachments,
}: {
  accessToken: string
  to: { name?: string | null; email: string }
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
      body: { contentType: 'text', content: body },
      toRecipients: [{ emailAddress: { address: to.email, name: to.name ?? undefined } }],
      attachments: included.map((a) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.name,
        contentType: a.contentType,
        contentBytes: a.contentBytes,
      })),
    }),
  })

  return { messageId: message.id as string, webLink: message.webLink as string, skipped }
}

export type InboxMessage = {
  id: string
  conversationId: string
  subject: string
  from: string
  receivedDateTime: string
  bodyPreview: string
  bodyText: string
}

// Lists recent inbox messages (newest first). `sinceIso` limits to messages
// received after that time — pass null on the very first run to just grab
// a recent batch instead of the whole history.
export async function listRecentInboxMessages(accessToken: string, sinceIso: string | null, top = 25): Promise<InboxMessage[]> {
  const filter = sinceIso ? `&$filter=receivedDateTime ge ${sinceIso}` : ''
  const select = '$select=id,conversationId,subject,from,receivedDateTime,bodyPreview,body'
  const json = await graphFetch(
    `/me/mailFolders/inbox/messages?${select}${filter}&$orderby=receivedDateTime desc&$top=${top}`,
    accessToken
  )
  return (json.value as Array<Record<string, unknown>>).map((m) => {
    const body = m.body as { content?: string } | undefined
    const text = (body?.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const from = m.from as { emailAddress?: { address?: string; name?: string } } | undefined
    return {
      id: m.id as string,
      conversationId: m.conversationId as string,
      subject: (m.subject as string) ?? '',
      from: from?.emailAddress?.address ?? '',
      receivedDateTime: m.receivedDateTime as string,
      bodyPreview: (m.bodyPreview as string) ?? '',
      bodyText: text.slice(0, 5000),
    }
  })
}
