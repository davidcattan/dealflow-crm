'use client'

// A plain `await res.json()` throws an opaque "Unexpected token... is not
// valid JSON" error whenever the server didn't actually return JSON — a
// platform-level timeout or crash page, a payload-too-large rejection,
// etc. Those aren't rare edge cases for long-running AI calls, so every
// client panel that hits our API routes should go through this instead of
// parsing the response directly.
export async function readJsonResponse<T>(
  res: Response
): Promise<{ ok: true; body: T } | { ok: false; message: string }> {
  const text = await res.text()
  let body: unknown = null

  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      return {
        ok: false,
        message: res.ok
          ? 'The server sent back an unexpected response.'
          : `Server error (${res.status}). This usually means the request took too long or the payload was too large — try again, or with fewer/smaller files.`,
      }
    }
  }

  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Request failed (${res.status}).`
    return { ok: false, message }
  }

  return { ok: true, body: body as T }
}
