// The new part of an email — what the sender wrote, without the quoted thread.
export function ownText(body: string) {
  return body.split(/\n\s*(From:|-----Original Message|On .{5,80} wrote:|________________)/)[0].trim()
}

// What the AI should read from one email. Usually just the new part — but a
// forward's new part is often only a signature or "see below", and the
// substance is the forwarded thread, so a forward keeps the thread. Long
// text keeps its start and its end (the newest note and the original ask).
export function readableText(body: string, subject: string | null | undefined, max: number) {
  const own = ownText(body)
  const isForward = /^\s*(fw|fwd)\s*:/i.test(subject ?? '') || body.includes('---------- Forwarded message')
  const text = isForward && own.length < 400 ? body : own
  return headAndTail(text, max)
}

export function headAndTail(text: string, max: number) {
  if (text.length <= max) return text
  const half = Math.floor(max / 2)
  return `${text.slice(0, half)}\n[…]\n${text.slice(-half)}`
}
