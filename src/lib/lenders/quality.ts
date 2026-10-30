// What a lender's record is missing for matching to find it. Matching only
// reads the record, so a lender with no notes or type is invisible to it
// (e.g. a healthcare ABL lender whose only note is "fan of tennis").

export type LenderForQuality = {
  name: string
  lending_type: string | null
  mandate_notes: string | null
  min_loan_amount: number | null
  max_loan_amount: number | null
}

export function lenderGaps(l: LenderForQuality): string[] {
  const gaps: string[] = []
  if ((l.mandate_notes ?? '').trim().length < 60) gaps.push('no notes on what they lend on')
  const type = (l.lending_type ?? '').trim()
  // "?" or a phone number pasted into the type field.
  if (!type || type === '?' || /\d{3}[.\-\s]\d{3}[.\-\s]\d{4}/.test(type)) gaps.push('lending type not set')
  if (l.min_loan_amount == null && l.max_loan_amount == null) gaps.push('loan size not set')
  return gaps
}

// Words that don't tell two firms apart ("Tree Line" vs "Tree Line Capital").
// "Financial", "Credit" and "Business" stay: MidCap Financial and MidCap
// Business Credit are different firms.
const FILLER = /\b(llc|inc|corp|co|company|the|capital|partners|group|lending|funding|na|bank)\b/g

function nameKey(name: string) {
  return name.toLowerCase().replace(FILLER, ' ').replace(/[^a-z0-9]/g, '')
}

function withinOneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

// Another lender whose name looks like the same firm: same name once
// "LLC", "Capital"… are dropped, or one typo apart ("Siena" / "Sienna").
export function similarLender<T extends { name: string }>(name: string, others: T[]): T | null {
  const key = nameKey(name)
  if (key.length < 3) return null
  return (
    others.find((o) => {
      if (o.name === name) return false
      const k = nameKey(o.name)
      return k === key || (key.length >= 5 && k.length >= 5 && withinOneEdit(k, key))
    }) ?? null
  )
}
