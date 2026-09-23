export const BILLING_URL = 'https://platform.claude.com/settings/billing'

// Turns whatever Anthropic threw into a message a person can act on. Out of
// credit and hit-the-spend-limit are the two that need David to do
// something, so they say exactly what and where.
export function friendlyAiError(err: unknown, fallback: string): string {
  const status = (err as { status?: number })?.status
  const raw = err instanceof Error ? err.message : ''
  const text = raw.toLowerCase()

  if (text.includes('credit balance is too low')) {
    return `Out of AI credit — your Anthropic balance is empty. Add credit here, then try again: ${BILLING_URL}`
  }
  if (
    text.includes('usage limit') ||
    text.includes('spend limit') ||
    text.includes('reached your specified api usage')
  ) {
    return `Your monthly AI spend limit has been reached. Raise the limit or wait for it to reset: ${BILLING_URL}`
  }
  if (status === 401 || text.includes('invalid x-api-key') || text.includes('authentication_error')) {
    return 'The app’s Anthropic API key was rejected. It may have been deleted or expired — create a new key in the Anthropic console and update it in Vercel.'
  }
  if (status === 429 || text.includes('rate_limit')) {
    return 'Anthropic is rate-limiting requests right now. Wait a minute and try again.'
  }
  if (status === 529 || text.includes('overloaded')) {
    return 'Anthropic is overloaded at the moment. Try again in a minute or two.'
  }
  return raw || fallback
}
