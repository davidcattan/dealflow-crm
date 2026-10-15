import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Deal, DocumentRecord, DealUpdate } from '@/lib/types'
import {
  deleteDeal,
  setDealStatusQuick,
} from './actions'
import { ConfirmButton } from '@/components/confirm-button'
import { UnderwritingPanel } from './underwriting-panel'
import { SnapshotPanel } from './snapshot-panel'
import { QuickReadPanel } from './quick-read-panel'
import type { QuickRead } from '@/lib/quickread/schema'
import { buildSnapshotPrompt } from '@/lib/snapshot/prompt'
import type { Snapshot } from '@/lib/snapshot/schema'
import { docTextsOf, withCollateralRequests } from '@/lib/snapshot/collateral'
import { estimateUnderwriting } from '@/lib/underwriting/estimate'
import { buildManualPrompt } from '@/lib/underwriting/prompt'
import { MatchingPanel, type MatchWithLender, type LoanTypeRecommendation, type SentEmail } from './matching-panel'
import { ownText } from '@/lib/outlook/own-text'
import { DocumentUploader } from './document-uploader'
import type { Underwriting } from '@/lib/underwriting/schema'
import { formatDateOnly } from '@/lib/format'
import { DealDetails } from './deal-details'
import { AtAGlance } from './at-a-glance'
import { KeyFacts } from './key-facts'
import { ActivityTimeline } from './activity'
import type { DealContact } from './deal-contacts'
import { ProfilePanel } from './profile-panel'
import { mailboxLabel, mailboxOwner } from '@/lib/outlook/mailbox-label'
import { SubmissionsPanel, type SubmissionRow, type TimelineItem } from './submissions-panel'
import type { SubmissionStatus } from '@/lib/deals/submission-status'
import { loadDealEmails, emailsToText } from '@/lib/deals/deal-emails'
import { findPossibleDuplicates } from '@/lib/deals/duplicates'
import { MergeDealButton, DuplicateBanner } from './merge-deal'
import { type CallRow } from './calls-panel'
import { DocumentGroups } from './document-groups'
import { guessCategory, guessLender } from '@/lib/documents/categories'
import { callSuggestions } from '@/lib/calls/process'
import type { CallNotes } from '@/lib/calls/schema'
import { LenderSearchPanel } from './lender-search-panel'
import { CollapsibleSection } from '@/components/collapsible-section'
import { loadNextSteps } from '@/lib/deals/load-next-steps'
import { NextStepToggle } from '@/components/next-step-toggle'
import { PhoneTabs } from '@/components/phone-tabs'
import { URGENCY_STYLES } from '@/lib/deals/next-step'
import { STATUS_COLORS, STATUS_LABELS, displayStatus, type DealStatus } from '@/lib/types'
import { buildLenderSearchPrompt } from '@/lib/lender-search/prompt'
import type { LenderSearch } from '@/lib/lender-search/schema'

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  const kb = bytes / 1024
  if (kb < 1) return '< 1 KB'
  if (kb < 1024) return `${kb.toFixed(0)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: deal }, { data: documents }, { data: updates }, { data: matches }] =
    await Promise.all([
      supabase.from('deals').select('*').eq('id', id).single(),
      supabase
        .from('documents')
        .select('*')
        .eq('deal_id', id)
        .order('uploaded_at', { ascending: false }),
      supabase
        .from('deal_updates')
        .select('*')
        .eq('deal_id', id)
        .order('entry_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('deal_matches')
        .select(
          'id, lender_id, score, reasoning, selected, created_at, draft_subject, draft_body, draft_status, draft_generated_at, outlook_draft_created_at, lenders(name)'
        )
        .eq('deal_id', id)
        .order('score', { ascending: false }),
    ])

  if (!deal) notFound()
  const step = (await loadNextSteps(supabase, [id])).get(id) ?? null
  // Your latest email to a lender on this deal (from the Sent folders) —
  // drafts written before it get a "Redraft to match" nudge.
  const { data: lastPitchRow } = await supabase
    .from('inbox_messages')
    .select('received_at, lender_id, lenders(name)')
    .eq('deal_id', id)
    .eq('classification', 'sent')
    .not('lender_id', 'is', null)
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const latestPitch = lastPitchRow
    ? {
        at: lastPitchRow.received_at as string,
        lenderId: lastPitchRow.lender_id as string,
        lenderName:
          ((Array.isArray(lastPitchRow.lenders) ? lastPitchRow.lenders[0] : lastPitchRow.lenders) as { name?: string } | null)?.name ??
          'a lender',
      }
    : null

  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Opening the deal clears its "New from email" tag on the Pipeline.
  if (user) {
    await supabase
      .from('deal_views')
      .upsert({ user_id: user.id, deal_id: id }, { onConflict: 'user_id,deal_id', ignoreDuplicates: true })
  }
  const [{ data: submissionRows }, { data: lenderRows }, { data: lenderEmails }, dealEmails, duplicates, { data: allDeals }, { data: mailboxRows }, { data: callRows }] = await Promise.all([
    supabase
      .from('deal_submissions')
      .select('id, lender_id, status, sent_on, last_activity_at, lenders(name)')
      .eq('deal_id', id)
      .order('last_activity_at', { ascending: false }),
    supabase.from('lenders').select('id, name').order('name'),
    supabase
      .from('inbox_messages')
      .select('id, lender_id, subject, summary, received_at, mailbox, classification, from_email, to_emails')
      .eq('deal_id', id)
      .not('lender_id', 'is', null)
      .order('received_at', { ascending: false }),
    loadDealEmails(supabase, id, 60),
    findPossibleDuplicates(supabase, id),
    supabase.from('deals').select('id, company_name, status').order('company_name'),
    supabase.from('outlook_connections').select('id, account_email, connected_by, created_at').order('created_at'),
    // Empty until migration 029 is run.
    supabase
      .from('deal_calls')
      .select('id, status, created_at, duration_seconds, transcript, result, applied, error, call_with, lender_id')
      .eq('deal_id', id)
      .order('created_at', { ascending: false }),
  ])
  const calls: CallRow[] = (callRows ?? []).map((c) => ({
    ...(c as Omit<CallRow, 'suggestions'>),
    applied: (c.applied as string[] | null) ?? [],
    suggestions: c.result ? callSuggestions(c.result as CallNotes) : [],
  }))
  // Drafts go to the mailbox the signed-in user connected most recently,
  // else the newest one. (created_at, not updated_at — updated_at changes on
  // every token refresh.)
  const mailboxes = (mailboxRows ?? []).map((m) => ({ id: m.id as string, account_email: m.account_email as string }))
  const defaultMailboxId =
    [...(mailboxRows ?? [])].filter((m) => m.connected_by === user?.id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]?.id ??
    [...(mailboxRows ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]?.id ??
    null
  const lenderNameById = new Map((lenderRows ?? []).map((l) => [l.id as string, l.name as string]))
  // Who a "what we still need" email can go to: the borrower contact, and
  // the broker / referral partner named in the notes.
  const brokerEmail = String(deal.notes ?? '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null
  const brokerName = String(deal.notes ?? '').match(/Referred by ([^,—(\n]+)/)?.[1]?.trim() ?? null
  // Other people on the deal (empty until migration 042 is run).
  const { data: contactRows } = await supabase.from('deal_contacts').select('id, name, title, email, phone, notes').eq('deal_id', id).order('created_at')
  const otherContacts = (contactRows ?? []) as DealContact[]
  const requestRecipients = [
    ...(deal.contact_email ? [{ label: `Borrower — ${deal.contact_name || deal.contact_email}`, name: deal.contact_name, email: deal.contact_email }] : []),
    ...otherContacts
      .filter((c) => c.email && c.email !== deal.contact_email)
      .map((c) => ({ label: `${c.title || 'Contact'} — ${c.name}`, name: c.name, email: c.email as string })),
    ...(brokerEmail && brokerEmail !== deal.contact_email
      ? [{ label: `Broker — ${brokerName || brokerEmail}`, name: brokerName, email: brokerEmail }]
      : []),
  ]

  // For "Move to deal…" on misfiled emails and documents.
  const dealChoices = ((allDeals ?? []) as { id: string; company_name: string; status: string }[]).map((d) => ({
    id: d.id,
    name: d.company_name,
    past: ['dead', 'closed', 'old'].includes(d.status),
  }))
  // For tagging term sheets: lenders on this deal first, then everyone.
  const termSheetLenders = [
    ...(submissionRows ?? []).map((r) => ({ id: r.lender_id as string, name: lenderNameById.get(r.lender_id as string) ?? 'Lender' })),
    ...((lenderRows ?? []) as { id: string; name: string }[]).filter((l) => !(submissionRows ?? []).some((r) => r.lender_id === l.id)),
  ]
  // NDAs (heads-up only): lenders with JED's master NDA, and lenders that
  // signed one for this deal. Both just come back empty before migration 041.
  const requiresNda = Boolean((deal as { requires_nda?: boolean }).requires_nda)
  const [{ data: ndaSubs }, { data: ndaLenders }] = await Promise.all([
    supabase.from('deal_submissions').select('id, lender_id, nda_signed_on').eq('deal_id', id).not('nda_signed_on', 'is', null),
    supabase.from('lenders').select('id').not('nda_signed_on', 'is', null),
  ])
  const masterNda = new Set((ndaLenders ?? []).map((l) => l.id as string))
  const dealNda = new Set((ndaSubs ?? []).map((r) => r.id as string))
  const ndaLenderIds = [...masterNda, ...(ndaSubs ?? []).map((r) => r.lender_id as string)]
  // Who you're talking to at each lender: the people on your emails with them
  // on this deal (newest first), named from the lender's contacts.
  const subLenderIds = (submissionRows ?? []).map((r) => r.lender_id as string)
  const [{ data: subContacts }, { data: subLenders }] = await Promise.all([
    supabase.from('lender_contacts').select('lender_id, name, email').in('lender_id', subLenderIds.concat('00000000-0000-0000-0000-000000000000')),
    supabase.from('lenders').select('id, contact_name, contact_email').in('id', subLenderIds.concat('00000000-0000-0000-0000-000000000000')),
  ])
  const nameByEmail = new Map<string, string>()
  for (const c of [...(subContacts ?? []), ...(subLenders ?? []).map((l) => ({ name: l.contact_name, email: l.contact_email }))]) {
    if (c.email && c.name) nameByEmail.set(String(c.email).toLowerCase(), String(c.name))
  }
  const ours = new Set((mailboxRows ?? []).map((m) => String(m.account_email).toLowerCase()))
  const isOurs = (e: string) => ours.has(e) || /@(jed-capitalgroup|jedcapital-group|jedcapitalgrp)\.com$/.test(e)
  const peopleByLender = new Map<string, { name: string | null; email: string }[]>()
  for (const m of lenderEmails ?? []) {
    const lenderId = m.lender_id as string
    const addrs =
      m.classification === 'sent'
        ? String(m.to_emails ?? '').split(/[,;]\s*/)
        : [String(m.from_email ?? '')]
    const list = peopleByLender.get(lenderId) ?? []
    for (const raw of addrs) {
      const email = raw.trim().toLowerCase()
      if (!email.includes('@') || isOurs(email) || list.some((x) => x.email === email)) continue
      list.push({ name: nameByEmail.get(email) ?? null, email })
    }
    peopleByLender.set(lenderId, list)
  }
  const submissions: SubmissionRow[] = (submissionRows ?? []).map((r) => {
    const lender = Array.isArray(r.lenders) ? r.lenders[0] : r.lenders
    const primary = (subLenders ?? []).find((l) => l.id === r.lender_id)
    const fromEmails = peopleByLender.get(r.lender_id as string) ?? []
    return {
      people: fromEmails.length
        ? fromEmails
        : primary?.contact_email
          ? [{ name: (primary.contact_name as string | null) ?? null, email: String(primary.contact_email).toLowerCase() }]
          : [],
      peopleFromEmails: fromEmails.length > 0,
      id: r.id,
      lender_id: r.lender_id,
      lender_name: lender?.name ?? 'Unknown lender',
      status: r.status as SubmissionStatus,
      sent_on: r.sent_on,
      last_activity_at: r.last_activity_at,
      nda: masterNda.has(r.lender_id as string) ? 'master' : dealNda.has(r.id as string) ? 'deal' : null,
    }
  })
  // Per-lender timeline: received emails (from the inbox log) plus notes.
  // Email-sourced updates are skipped — the email itself is the entry.
  const lenderTimeline: TimelineItem[] = [
    ...(lenderEmails ?? []).map((m) => ({
      id: `email-${m.id}`,
      lender_id: m.lender_id as string,
      kind: 'email' as const,
      at: m.received_at as string,
      text: (m.summary as string | null) ?? '',
      subject: m.subject as string | null,
      where: mailboxLabel(m.mailbox as string | null, m.classification === 'sent'),
      sentBy: m.classification === 'sent' ? (mailboxOwner(m.mailbox as string | null) ?? 'We') : null,
    })),
    ...((updates ?? []) as (DealUpdate & { lender_id?: string | null })[])
      .filter((u) => u.lender_id && u.source !== 'email')
      .map((u) => ({
        id: `note-${u.id}`,
        lender_id: u.lender_id as string,
        kind: 'note' as const,
        at: u.created_at,
        text: u.note,
      })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1))

  const { data: usageRows } = await supabase
    .from('ai_usage')
    .select('cost_usd, feature, created_at')
    .eq('deal_id', id)
    .order('created_at', { ascending: false })
  const dealSpend = (usageRows ?? []).reduce((sum, r) => sum + Number(r.cost_usd), 0)

  // A run logs two rows (research + structuring), newest first.
  const uwRows = (usageRows ?? []).filter((r) => r.feature === 'underwriting').slice(0, 2)
  const lastRunCost = uwRows.length > 0 ? uwRows.reduce((n, r) => n + Number(r.cost_usd), 0) : null

  // What you actually emailed each lender on this deal (from the Sent
  // folders, picked up by the inbox sync), newest first.
  const { data: sentRows } = await supabase
    .from('inbox_messages')
    .select('lender_id, subject, body_text, summary, received_at, to_emails')
    .eq('deal_id', id)
    .eq('classification', 'sent')
    .not('lender_id', 'is', null)
    .order('received_at', { ascending: false })
  const sentByLender = new Map<string, SentEmail[]>()
  for (const r of sentRows ?? []) {
    const list = sentByLender.get(r.lender_id as string) ?? []
    list.push({
      subject: (r.subject as string | null) ?? '',
      body: r.body_text ? ownText(r.body_text as string) : ((r.summary as string | null) ?? ''),
      at: r.received_at as string,
      to: (r.to_emails as string | null) ?? '',
    })
    sentByLender.set(r.lender_id as string, list)
  }

  const matchesWithLender: MatchWithLender[] = (matches ?? []).map((m) => {
    const lender = Array.isArray(m.lenders) ? m.lenders[0] : m.lenders
    return {
      sent: sentByLender.get(m.lender_id as string) ?? [],
      id: m.id,
      lender_id: m.lender_id,
      lender_name: lender?.name ?? 'Unknown lender',
      score: m.score,
      reasoning: m.reasoning,
      selected: m.selected,
      draftSubject: m.draft_subject,
      draftBody: m.draft_body,
      draftStatus: m.draft_status as 'none' | 'drafted' | 'sent',
      outlookDraftCreatedAt: m.outlook_draft_created_at,
      draftGeneratedAt: m.draft_generated_at,
    }
  })
  const lastMatchRunAt =
    matches && matches.length > 0
      ? matches.reduce(
          (latest, m) => (m.created_at > latest ? m.created_at : latest),
          matches[0].created_at
        )
      : null

  // Open links for every document in one request; download links are made
  // when clicked.
  const docList = (documents ?? []) as DocumentRecord[]
  const { data: viewUrls } = docList.length
    ? await supabase.storage.from('borrower-documents').createSignedUrls(
        docList.map((d) => d.storage_path),
        60 * 10
      )
    : { data: [] as { signedUrl: string | null }[] }
  const docsWithUrls = docList.map((doc, i) => ({
    ...doc,
    url: viewUrls?.[i]?.signedUrl ?? null,
    downloadUrl: `/api/deals/${deal.id}/documents/${doc.id}/download`,
  }))

  // Overview card: the most recent thing that happened, from any source.
  const activityUpdates = ((updates ?? []) as (DealUpdate & { source?: string | null })[]).filter((u) => u.source !== 'call' && u.source !== 'email')
  const activityCount = activityUpdates.length + calls.length + dealEmails.length
  const lastActivity =
    [
      ...activityUpdates.map((u) => ({ at: u.entry_date ? `${u.entry_date}T12:00:00` : u.created_at, text: u.note })),
      ...calls.map((c) => ({ at: c.created_at, text: `Call${c.result?.title ? `: ${c.result.title}` : ''}${c.result?.summary ? ` — ${c.result.summary}` : ''}` })),
      ...dealEmails.map((e) => ({
        at: e.received_at ?? '',
        text: `${e.classification === 'sent' ? 'Sent' : `Email from ${e.from_email}`}: ${e.summary || e.subject || ''}`,
      })),
    ]
      .filter((x) => x.at)
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .map((x) => ({ ...x, text: x.text.length > 220 ? `${x.text.slice(0, 220)}…` : x.text }))[0] ?? null

  const isPast = ['dead', 'old', 'closed'].includes(deal.status)
  const dealActions = (
    <>
          <form action={setDealStatusQuick}>
            <input type="hidden" name="deal_id" value={deal.id} />
            <input
              type="hidden"
              name="status"
              value={['dead', 'old', 'closed'].includes(deal.status) ? 'in_review' : 'dead'}
            />
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              {['dead', 'old', 'closed'].includes(deal.status) ? 'Mark as active' : 'Mark as dead'}
            </button>
          </form>
          <MergeDealButton
            dealId={deal.id}
            dealName={deal.company_name}
            deals={(allDeals ?? []) as { id: string; company_name: string; status: string }[]}
          />
          <form action={deleteDeal}>
            <input type="hidden" name="deal_id" value={deal.id} />
            <ConfirmButton
              confirmMessage={`Delete ${deal.company_name}? This also deletes all of its uploaded documents. This cannot be undone.`}
              className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              Delete deal
            </ConfirmButton>
          </form>
    </>
  )

  return (
    <div className="space-y-5 sm:space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight text-slate-900 sm:text-2xl">{deal.company_name}</h1>
          {/* Phone: status and loan type at a glance. */}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500 sm:hidden">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_COLORS[displayStatus(deal.status as DealStatus)]}`} />
              {STATUS_LABELS[displayStatus(deal.status as DealStatus)]}
            </span>
            {deal.loan_type && <span>{deal.loan_type}</span>}
          </p>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">
            Added {formatDateOnly(deal.created_at)}
            {dealSpend > 0 && <span className="ml-3 text-slate-400">AI spend on this deal: ${dealSpend.toFixed(2)}</span>}
          </p>
        </div>
        <div className="hidden flex-wrap items-center gap-2 sm:flex">{dealActions}</div>
        {/* Phone: the same actions in a ⋯ menu. */}
        <details className="relative shrink-0 sm:hidden">
          <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full border border-slate-300 bg-white text-lg leading-none text-slate-600 [&::-webkit-details-marker]:hidden">
            ⋯
          </summary>
          <div className="absolute right-0 z-40 mt-2 flex w-56 flex-col items-stretch gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-lg [&_button]:w-full">
            {dealActions}
          </div>
        </details>
      </div>

      {/* Phone: the next step, right at the top. */}
      {step && !isPast && (
        <div className={`rounded-xl border px-4 py-3 sm:hidden ${URGENCY_STYLES[step.urgency].pill}`}>
          <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Next step · {URGENCY_STYLES[step.urgency].label}</p>
          <p className="mt-0.5 text-sm font-medium">{step.text}</p>
          {step.detail && <p className="mt-0.5 text-xs opacity-80">{step.detail}</p>}
        </div>
      )}

      <div className="hidden flex-wrap items-center justify-between gap-3 sm:flex">
        {step && !isPast ? <NextStepToggle step={step} /> : <span />}
      </div>

      <PhoneTabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'lenders', label: 'Lenders', count: submissions.length },
          { key: 'activity', label: 'Activity', count: activityCount },
          { key: 'docs', label: 'Docs', count: (documents ?? []).length },
          { key: 'ai', label: 'AI' },
        ]}
      >
      <div className="space-y-5 sm:space-y-8">

      <DuplicateBanner dealId={deal.id} dealName={deal.company_name} duplicates={duplicates} />

      <CollapsibleSection tab="overview" title="At a glance">
        <AtAGlance
          status={deal.status as DealStatus}
          owner={(deal as { owner?: string | null }).owner ?? null}
          ask={deal.deal_type}
          loanType={deal.loan_type}
          industry={deal.industry}
          contact={{ name: deal.contact_name, phone: deal.contact_phone, email: deal.contact_email }}
          lenders={submissions.map((x) => ({
            id: x.lender_id,
            name: x.lender_name,
            status: x.status,
            person: x.people?.[0] ? (x.people[0].name ?? x.people[0].email.split('@')[0]) : null,
          }))}
          last={lastActivity}
        />
      </CollapsibleSection>

      <CollapsibleSection tab="overview" title="Key facts">
        <KeyFacts
          dealId={deal.id}
          keyFacts={((deal as { key_facts?: unknown }).key_facts ?? null) as Parameters<typeof KeyFacts>[0]['keyFacts']}
          at={(deal as { key_facts_at?: string | null }).key_facts_at ?? null}
        />
      </CollapsibleSection>

      <CollapsibleSection tab="overview" title="Deal details">
      <DealDetails deal={deal as Deal} contacts={otherContacts} />
      </CollapsibleSection>

      <CollapsibleSection tab="overview" title="Quick read">
        <QuickReadPanel
          dealId={deal.id}
          quickRead={((deal as { quick_read?: QuickRead | null }).quick_read as QuickRead | null) ?? null}
          at={(deal as { quick_read_at?: string | null }).quick_read_at ?? null}
          costLabel={deal.snapshot ? 'about 1¢ (uses the existing underwriting)' : 'usually 5–30¢'}
        />
      </CollapsibleSection>




      <CollapsibleSection tab="lenders" title="Lenders sent to">
      <SubmissionsPanel
        dealId={deal.id}
        requiresNda={requiresNda}
        submissions={submissions}
        timeline={lenderTimeline}
        lenders={(lenderRows ?? []) as { id: string; name: string }[]}
      />
      </CollapsibleSection>

      <CollapsibleSection tab="activity" title="Activity">
        <ActivityTimeline
          dealId={deal.id}
          // A call's notes live on the call and an email's on the email, so
          // the notes they saved aren't listed a second time.
          updates={((updates ?? []) as (DealUpdate & { lender_id?: string | null; source?: string | null })[]).filter(
            (u) => u.source !== 'call' && u.source !== 'email'
          )}
          calls={calls}
          emails={dealEmails}
          lenderNames={Object.fromEntries(lenderNameById)}
          target={{
            uploadUrl: `/api/deals/${deal.id}/calls`,
            pathPrefix: `calls/${deal.id}/`,
            label: deal.company_name,
            href: `/deals/${deal.id}`,
          }}
          whoOptions={{
            borrowerName: deal.contact_name || deal.company_name,
            dealLenders: submissions.map((x) => ({ id: x.lender_id, name: x.lender_name })),
            otherLenders: ((lenderRows ?? []) as { id: string; name: string }[]).filter(
              (l) => !submissions.some((x) => x.lender_id === l.id)
            ),
          }}
          deals={dealChoices}
        />
      </CollapsibleSection>





      {/* Right above the underwriting, so you can see what documents it has to work with. */}
      <CollapsibleSection tab="docs" title="Documents" phoneClosed>
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">
          Diligence documents
        </h2>

        <DocumentUploader
          dealId={deal.id}
          untriagedCount={
            docsWithUrls.filter(
              (d) => !d.triage && d.file_name.toLowerCase().endsWith('.pdf')
            ).length
          }
        />

        {docsWithUrls.length > 0 ? (
          <DocumentGroups
            dealId={deal.id}
            dealName={deal.company_name}
            docs={docsWithUrls.map((doc) => {
              const category = doc.category || guessCategory(doc.file_name, doc.triage?.doc_type)
              const lenderId =
                doc.lender_id ??
                (category === 'Term sheets & offers' ? guessLender(doc.file_name, termSheetLenders)?.id : null) ??
                null
              return {
                id: doc.id,
                file_name: doc.file_name,
                storage_path: doc.storage_path,
                url: doc.url,
                size: formatBytes(doc.file_size),
                uploaded_at: doc.uploaded_at,
                triage: doc.triage,
                category,
                lender: lenderId ? { id: lenderId, name: lenderNameById.get(lenderId) ?? 'Lender' } : null,
              }
            })}
            lenders={termSheetLenders}
            deals={dealChoices}
          />
        ) : (
          <p className="py-6 text-center text-sm text-slate-400">
            No documents uploaded yet.
          </p>
        )}
      </section>
      </CollapsibleSection>

      {/* What the underwriting has to work with, without leaving the AI tab. */}
      <CollapsibleSection tab="ai" title="Documents on file">
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          {docsWithUrls.length === 0
            ? 'No documents yet — upload them on the Docs tab.'
            : `${docsWithUrls.length} document${docsWithUrls.length === 1 ? '' : 's'}: ` +
              Object.entries(
                docsWithUrls.reduce<Record<string, number>>((acc, d) => {
                  const c = d.category || guessCategory(d.file_name, d.triage?.doc_type)
                  acc[c] = (acc[c] ?? 0) + 1
                  return acc
                }, {})
              )
                .map(([c, n]) => `${c} ${n}`)
                .join(' · ')}
        </p>
      </CollapsibleSection>

      <CollapsibleSection tab="ai" title="AI underwriting">
      <SnapshotPanel
        dealId={deal.id}
        snapshot={
          deal.snapshot
            ? withCollateralRequests(deal.snapshot as Snapshot, docTextsOf((documents ?? []) as DocumentRecord[]))
            : null
        }
        requestEmail={{ dealName: deal.company_name, recipients: requestRecipients, mailboxId: defaultMailboxId ?? null }}
        generatedAt={(deal.snapshot_generated_at as string | null) ?? null}
        queuedAt={(deal as { underwriting_requested_at?: string | null }).underwriting_requested_at ?? null}
        manualDocs={docsWithUrls.map((d) => ({
          id: d.id,
          name: d.file_name,
          downloadUrl: d.downloadUrl,
          trimmedUrl:
            d.triage && d.triage.important_pages.length > 0 && (d.content_type === 'application/pdf' || d.file_name.toLowerCase().endsWith('.pdf'))
              ? `/api/deals/${deal.id}/documents/${d.id}/trimmed`
              : null,
        }))}
        manualPrompt={buildManualPrompt(deal, ((documents ?? []) as DocumentRecord[]).map((d) => d.file_name))}
        snapshotPrompt={buildSnapshotPrompt(
          deal,
          ((documents ?? []) as DocumentRecord[]).map((d) => d.file_name),
          emailsToText(dealEmails.slice(0, 20))
        )}
        hasReportUnderwriting={Boolean(deal.underwriting)}
      />
      </CollapsibleSection>

      <CollapsibleSection tab="ai" title="Borrower profile" keepToggle phoneClosed closed={!(deal as { borrower_profile?: unknown }).borrower_profile}>
        <ProfilePanel
          dealId={deal.id}
          profile={((deal as { borrower_profile?: unknown }).borrower_profile ?? null) as Parameters<typeof ProfilePanel>[0]['profile']}
          at={(deal as { borrower_profile_at?: string | null }).borrower_profile_at ?? null}
        />
      </CollapsibleSection>

      <CollapsibleSection tab="ai" title="Full research report" keepToggle phoneClosed closed>
      <UnderwritingPanel
        dealId={deal.id}
        dealName={deal.company_name}
        estimate={estimateUnderwriting((documents ?? []) as DocumentRecord[])}
        lastRunCost={lastRunCost}
        underwriting={deal.underwriting as Underwriting | null}
        generatedAt={deal.underwriting_generated_at}
      />
      </CollapsibleSection>

      <CollapsibleSection tab="lenders" title="Lender matching" phoneClosed>
      <MatchingPanel
        requiresNda={requiresNda}
        ndaLenderIds={ndaLenderIds}
        dealId={deal.id}
        matches={matchesWithLender}
        lastRunAt={lastMatchRunAt}
        hasUnderwriting={Boolean(deal.underwriting || deal.snapshot)}
        currentLoanType={deal.loan_type}
        sentLenderIds={submissions.map((x) => x.lender_id)}
        documents={docsWithUrls.map((d) => ({ id: d.id, name: d.file_name, size: d.file_size }))}
        mailboxes={mailboxes}
        defaultMailboxId={defaultMailboxId}
        latestPitch={latestPitch}
        loanTypeRecommendation={
          (deal as { loan_type_recommendation?: LoanTypeRecommendation | null }).loan_type_recommendation ?? null
        }
      />
      </CollapsibleSection>

      <CollapsibleSection tab="lenders" title="Find new lenders" phoneClosed closed={Boolean((deal as { lender_search?: unknown }).lender_search)}>
      <LenderSearchPanel
        dealId={deal.id}
        search={(deal as { lender_search?: LenderSearch | null }).lender_search ?? null}
        generatedAt={(deal as { lender_search_generated_at?: string | null }).lender_search_generated_at ?? null}
        queuedAt={(deal as { lender_search_requested_at?: string | null }).lender_search_requested_at ?? null}
        lenderIdsByName={Object.fromEntries((lenderRows ?? []).map((l) => [String(l.name).trim().toLowerCase(), l.id as string]))}
        prompt={buildLenderSearchPrompt(deal, (lenderRows ?? []).map((l) => l.name as string))}
      />
      </CollapsibleSection>
      </div>
      </PhoneTabs>
    </div>
  )
}
