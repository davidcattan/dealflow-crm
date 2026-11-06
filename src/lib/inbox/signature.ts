// Reads a person's own phone number and title out of the signature at the
// bottom of their email. Plain code, no AI, so it can run on every email for
// free. It only looks at the sender's newest message (never the quoted
// thread below it) and only returns what it is confident about.

export type Signature = { phone: string | null; title: string | null }

// Where the quoted thread starts.
const REPLY_MARKER =
  /^\s*(From:\s|Sent:\s|On .{5,120} wrote:|-{2,}\s*Original Message|_{5,}|-{5,}|\*{5,}|CAUTION:|Begin forwarded message)/i

const PHONE = /(?:\+?1[\s.\-]{0,2})?\(?\b\d{3}\)?[\s.\-]{1,2}\d{3}[\s.\-]\d{4}(?!\d)/
const CELL_LABEL = /\b(cell|mobile|mob|m|c)\b\s*[:.]?\s*$|\b(cell|mobile|mob)\b/i
const DIRECT_LABEL = /\b(direct|dir|d)\b\s*[:.]?\s*$|\bdirect\b/i
const FAX_LABEL = /\b(fax|f)\b\s*[:.]?\s*$|\bfax\b/i
// The team's own numbers appear in quoted text; they are never a contact's.
const TEAM_NUMBERS = ['9178924690', '2127688330']

const TITLE_WORD =
  /\b(president|vice president|vp|svp|evp|avp|managing director|director|principal|partner|officer|ceo|cfo|coo|cro|cto|chief|founder|co-founder|owner|manager|head of|analyst|associate|banker|originator|underwriter|counsel|treasurer|controller|relationship|business development)\b/i
// "Turning Rock Partners" and "Hilco Group" are firms, not titles.
const FIRM_ENDING = /\b(partners|capital|group|llc|l\.l\.c\.|lp|inc\.?|corp\.?|bank|financial|finance|funding|lending|credit|advisors|company|co\.)\s*$/i
const NOT_A_TITLE = /@|https?:|www\.|\d{3}|\b(thanks|regards|please|would|could|should|will|let me|i am|i'm|we are|we're|my|our)\b/i

function digits(s: string) {
  return s.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
}

function prettyPhone(raw: string) {
  const d = digits(raw)
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : raw.trim()
}

// The sender's own text: everything above the quoted thread, minus legal
// boilerplate and lines of prose too long to be part of a signature.
function ownLines(body: string) {
  const out: string[] = []
  for (const raw of body.replace(/\r/g, '').split('\n')) {
    if (REPLY_MARKER.test(raw)) break
    const line = raw.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()
    if (line) out.push(line)
  }
  return out
}

function titleFrom(line: string, lastName: string) {
  const parts = line.split(/\s*[|•·,]\s*|\s+[-–—]\s+/)
  for (const part of parts) {
    const p = part.trim()
    if (p.length < 2 || p.length > 60) continue
    if (lastName && p.toLowerCase().includes(lastName)) continue
    if (!TITLE_WORD.test(p) || FIRM_ENDING.test(p) || NOT_A_TITLE.test(p)) continue
    return p
  }
  return null
}

// Outlook often shows names as "Anwar, Reza".
export function normalizeName(name: string | null | undefined) {
  const n = (name ?? '').trim()
  const m = n.match(/^([^,]+),\s*([^,]+)$/)
  return m ? `${m[2].trim()} ${m[1].trim()}` : n
}

export function parseSignature(body: string, fromName?: string | null): Signature {
  const lines = ownLines(body ?? '')
  if (!lines.length) return { phone: null, title: null }

  const nameParts = normalizeName(fromName).toLowerCase().split(/\s+/).filter(Boolean)
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : ''
  // The signature starts at the last short line holding the sender's name;
  // without one, only the final few lines are trusted.
  let start = -1
  if (lastName) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].length <= 80 && !lines[i].includes('@') && lines[i].toLowerCase().includes(lastName)) {
        start = i
        break
      }
    }
  }
  const named = start >= 0
  const block = named ? lines.slice(start, start + 12) : lines.slice(-6)

  const phones: { value: string; rank: number }[] = []
  let title: string | null = null
  block.forEach((line, i) => {
    // Without a name line, a phone inside a sentence isn't a signature.
    if (line.length > (named ? 120 : 50)) return
    if (title === null && (named ? i <= 3 : false)) title = titleFrom(line, lastName)
    const re = new RegExp(PHONE.source, 'g')
    for (const m of line.matchAll(re)) {
      if (TEAM_NUMBERS.includes(digits(m[0]))) continue
      const before = `${i > 0 && line.slice(0, m.index).trim() === '' ? block[i - 1] : ''} ${line.slice(0, m.index)}`.trim()
      if (FAX_LABEL.test(before)) continue
      phones.push({ value: prettyPhone(m[0]), rank: CELL_LABEL.test(before) ? 0 : DIRECT_LABEL.test(before) ? 1 : 2 })
    }
  })
  phones.sort((a, b) => a.rank - b.rank)
  return { phone: phones[0]?.value ?? null, title }
}
