import type { Snapshot } from './schema'

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n < 0 ? `($${Math.abs(Math.round(n)).toLocaleString('en-US')})` : `$${Math.round(n).toLocaleString('en-US')}`

// Plain-text version of the snapshot — for copy/paste into an email, and
// as the compact context the AI reads for matching and drafting.
export function snapshotToText(s: Snapshot): string {
  const lines: string[] = []
  for (const e of s.entities) {
    lines.push(`${e.name}`, `About: ${e.about}`, `Owner: ${e.owner}  |  Industry: ${e.industry}`)
    for (const p of e.periods) {
      lines.push(`${p.label}: Revenue ${fmt(p.revenue)} | EBITDA ${fmt(p.ebitda)} | Net income ${fmt(p.net_income)}  [${p.source}]`)
    }
    const a = e.assets
    lines.push(
      `Assets (${a.as_of}): AR ${fmt(a.accounts_receivable)} | Equipment ${fmt(a.equipment)} | Real estate ${fmt(a.real_estate)} | Inventory ${fmt(a.inventory)}`
    )
    const l = e.liabilities
    lines.push(`Liabilities (${l.as_of}): AP ${fmt(l.accounts_payable)} | Total debt ${fmt(l.total_debt)}`)
    for (const d of l.debts) lines.push(`  - ${d.lender} (${d.kind === 'real_estate' ? 'RE' : 'Business'}): ${fmt(d.balance)}${d.note ? ` — ${d.note}` : ''}`)
    lines.push('')
  }
  if (s.combined) {
    const c = s.combined
    lines.push('COMBINED')
    for (const p of c.periods) lines.push(`${p.label}: Revenue ${fmt(p.revenue)} | EBITDA ${fmt(p.ebitda)} | Net income ${fmt(p.net_income)}`)
    lines.push(
      `Assets: AR ${fmt(c.accounts_receivable)} | Equipment ${fmt(c.equipment)} | Real estate ${fmt(c.real_estate)} | Inventory ${fmt(c.inventory)}`,
      `Liabilities: AP ${fmt(c.accounts_payable)} | Real estate debt ${fmt(c.real_estate_debt)} | Business debt ${fmt(c.business_debt)} | Total debt ${fmt(c.total_debt)}`
    )
    if (c.note) lines.push(`Note: ${c.note}`)
    lines.push('')
  }
  lines.push(
    `Coverage: ${s.coverage.dscr === null ? '—' : s.coverage.dscr.toFixed(2) + 'x'} (debt service ${fmt(s.coverage.annual_debt_service)}, EBITDA ${fmt(s.coverage.ebitda_used)}) — ${s.coverage.note}`
  )
  if (s.flags.length) lines.push('', 'Flags:', ...s.flags.map((f) => `- ${f}`))
  if (s.request_list.length) lines.push('', 'Documents to request:', ...s.request_list.map((r) => `- ${r}`))
  return lines.join('\n')
}
