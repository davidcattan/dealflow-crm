// "eli@jed-capitalgroup.com" → "Eli's inbox" (or "Eli's Sent folder").
export function mailboxOwner(mailbox: string | null | undefined) {
  const first = (mailbox ?? '').split('@')[0].split(/[._-]/)[0]
  return first ? first[0].toUpperCase() + first.slice(1).toLowerCase() : null
}

export function mailboxLabel(mailbox: string | null | undefined, sent = false) {
  const owner = mailboxOwner(mailbox)
  if (!owner) return null
  return sent ? `from ${owner}'s mailbox` : `in ${owner}'s inbox`
}
