// The team's real Outlook signature (navy JED block, icons) — the same one
// David and Eli pasted into Outlook. Outlook doesn't add a signature to
// drafts created through the API, so the CRM appends it for the sender's
// mailbox. Icons are hosted with the CRM (public/email-signature).

type Person = { name: string; title: string; mobile: string; office?: string; email: string }

const TEAM: Record<string, Person> = {
  'david@jed-capitalgroup.com': { name: 'David Cattan', title: 'Principal', mobile: '917-497-6340', email: 'david@jed-capitalgroup.com' },
  'eli@jed-capitalgroup.com': {
    name: 'Eli Cattan',
    title: 'Principal',
    mobile: '917-892-4690',
    office: '212-768-8330',
    email: 'eli@jed-capitalgroup.com',
  },
}

const ICONS = 'https://dealflow-crm-gamma.vercel.app/email-signature/'
const tel = (n: string) => `tel:+1${n.replace(/\D/g, '')}`

function row(icon: string, inner: string) {
  return `<tr><td width="14" valign="middle" style="padding:0 8px 0 0;line-height:20px;"><img src="${ICONS}${icon}.png" width="13" height="13" alt="" style="display:block;border:0;"></td><td valign="middle" style="font-size:12px;line-height:20px;">${inner}</td></tr>`
}

export function jedSignatureHtml(accountEmail: string | null | undefined): string | null {
  const p = TEAM[(accountEmail ?? '').trim().toLowerCase()]
  if (!p) return null
  const phones = p.office
    ? row('mobile', `<a href="${tel(p.mobile)}" style="color:#374151;text-decoration:none;">${p.mobile}</a> <span style="color:#9CA3AF;font-size:11px;">mobile</span>`) +
      row('phone', `<a href="${tel(p.office)}" style="color:#374151;text-decoration:none;">${p.office}</a> <span style="color:#9CA3AF;font-size:11px;">office</span>`)
    : row('phone', `<a href="${tel(p.mobile)}" style="color:#374151;text-decoration:none;">${p.mobile}</a>`)
  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;border-collapse:collapse;margin-top:4px;">
<tr>
<td width="72" valign="top" style="padding:0 16px 0 0;"><table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td width="72" height="72" bgcolor="#1F3864" align="center" valign="middle" style="background:#1F3864;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:bold;letter-spacing:2px;">JED</td></tr></table></td>
<td valign="top" style="border-left:1px solid #D1D5DB;padding:0 0 0 16px;">
<div style="font-size:16px;font-weight:bold;color:#1F3864;line-height:20px;">${p.name}</div>
<div style="font-size:12px;color:#6B7280;line-height:18px;">${p.title} &nbsp;·&nbsp; JED Capital Group</div>
<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:3px;font-family:Arial,Helvetica,sans-serif;">
${phones}
${row('email', `<a href="mailto:${p.email}" style="color:#1F3864;text-decoration:none;">${p.email}</a>`)}
${row('web', `<a href="https://jed-capitalgroup.com" style="color:#1F3864;text-decoration:none;font-weight:bold;">jed-capitalgroup.com</a>`)}
${row('location', `<span style="color:#6B7280;font-size:11px;">1430 Broadway, 10th Floor, New York, NY 10018</span>`)}
</table>
</td>
</tr>
</table>`
}

// The drafted text ends with a sign-off ("Regards," / "Best,") and maybe a
// name or plain-text signature. With the real signature appended, keep the
// sign-off word and drop what follows it.
export function trimToSignOff(body: string) {
  const lines = body.replace(/\s+$/, '').split('\n')
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i--) {
    if (/^\s*(regards|best|thanks|thank you|best regards|kind regards),?\s*$/i.test(lines[i])) return lines.slice(0, i + 1).join('\n')
  }
  return body
}
