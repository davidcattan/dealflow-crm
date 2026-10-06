import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Deal, DocumentRecord, DealUpdate } from '@/lib/types'
import {
  deleteDocument,
  deleteDeal,
  addDealUpdate,
  deleteDealUpdate,
  setDealStatusQuick,
} from './actions'
import { ConfirmButton } from '@/components/confirm-button'
import { UnderwritingPanel } from './underwriting-panel'
import { SnapshotPanel } from './snapshot-panel'
import { buildSnapshotPrompt } from '@/lib/snapshot/prompt'
import type { Snapshot } from '@/lib/snapshot/schema'
import { estimateUnderwriting } from '@/lib/underwriting/estimate'
import { buildManualPrompt } from '@/lib/underwriting/prompt'
import { MatchingPanel, type MatchWithLender, type LoanTypeRecommendation } from './matching-panel'
import { DocumentUploader } from './document-uploader'
import type { Underwriting } from '@/lib/underwriting/schema'
import { formatDateOnly } from '@/lib/format'
import { DealDetails } from './deal-details'
import { SubmissionsPanel, type SubmissionRow, type TimelineItem } from './submissions-panel'
import type { SubmissionStatus } from '@/lib/deals/submission-status'
import { loadDealEmails, emailsToText } from '@/lib/deals/deal-emails'
import { findPossibleDuplicates } from '@/lib/deals/duplicates'
import { MergeDealButton, DuplicateBanner } from './merge-deal'
import { LenderSearchPanel } from './lender-search-panel'
import { CollapsibleSection, CollapseAllControls } from '@/components/collapsible-section'
import { loadNextSteps } from '@/lib/deals/load-next-steps'
import { NextStepToggle } from '@/components/next-step-toggle'
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
          'id, lender_id, score, reasoning, selected, created_at, draft_subject, draft_body, draft_status, outlook_draft_created_at, lenders(name)'
        )
        .eq('deal_id', id)
        .order('score', { ascending: false }),
    ])

  if (!deal) notFound()
  const step = (await loadNextSteps(supabase, [id])).get(id) ?? null

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const [{ data: submissionRows }, { data: lenderRows }, { data: lenderEmails }, dealEmails, duplicates, { data: allDeals }, { data: mailboxRows }] = await Promise.all([
    supabase
      .from('deal_submissions')
      .select('id, lender_id, status, sent_on, last_activity_at, lenders(name)')
      .eq('deal_id', id)
      .order('last_activity_at', { ascending: false }),
    supabase.from('lenders').select('id, name').order('name'),
    supabase
      .from('inbox_messages')
      .select('id, lender_id, subject, summary, received_at')
      .eq('deal_id', id)
      .not('lender_id', 'is', null)
      .order('received_at', { ascending: false }),
    loadDealEmails(supabase, id),
    findPossibleDuplicates(supabase, id),
    supabase.from('deals').select('id, company_name, status').order('company_name'),
    supabase.from('outlook_connections').select('id, account_email, connected_by, created_at').order('created_at'),
  ])
  // Drafts go to the mailbox the signed-in user connected most recently,
  // else the newest one. (created_at, not updated_at — updated_at changes on
  // every token refresh.)
  const mailboxes = (mailboxRows ?? []).map((m) => ({ id: m.id as string, account_email: m.account_email as string }))
  const defaultMailboxId =
    [...(mailboxRows ?? [])].filter((m) => m.connected_by === user?.id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]?.id ??
    [...(mailboxRows ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]?.id ??
    null
  const lenderNameById = new Map((lenderRows ?? []).map((l) => [l.id as string, l.name as string]))
  const submissions: SubmissionRow[] = (submissionRows ?? []).map((r) => {
    const lender = Array.isArray(r.lenders) ? r.lenders[0] : r.lenders
    return {
      id: r.id,
      lender_id: r.lender_id,
      lender_name: lender?.name ?? 'Unknown lender',
      status: r.status as SubmissionStatus,
      sent_on: r.sent_on,
      last_activity_at: r.last_activity_at,
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

  const matchesWithLender: MatchWithLender[] = (matches ?? []).map((m) => {
    const lender = Array.isArray(m.lenders) ? m.lenders[0] : m.lenders
    return {
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
    }
  })
  const lastMatchRunAt =
    matches && matches.length > 0
      ? matches.reduce(
          (latest, m) => (m.created_at > latest ? m.created_at : latest),
          matches[0].created_at
        )
      : null

  const docsWithUrls = await Promise.all(
    ((documents ?? []) as DocumentRecord[]).map(async (doc) => {
      const { data } = await supabase.storage
        .from('borrower-documents')
        .createSignedUrl(doc.storage_path, 60 * 10)
      const { data: dl } = await supabase.storage
        .from('borrower-documents')
        .createSignedUrl(doc.storage_path, 60 * 60, { download: doc.file_name })
      return { ...doc, url: data?.signedUrl ?? null, downloadUrl: dl?.signedUrl ?? null }
    })
  )

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {deal.company_name}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Added {formatDateOnly(deal.created_at)}
            {dealSpend > 0 && (
              <span className="ml-3 text-slate-400">
                AI spend on this deal: ${dealSpend.toFixed(2)}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {step && !['dead', 'old', 'closed'].includes(deal.status) ? <NextStepToggle step={step} /> : <span />}
        <CollapseAllControls />
      </div>


      <DuplicateBanner dealId={deal.id} dealName={deal.company_name} duplicates={duplicates} />

      <CollapsibleSection title="Deal details">
      <DealDetails deal={deal as Deal} />
      </CollapsibleSection>

      <CollapsibleSection title="Documents" phoneClosed>
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
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
          <ul className="divide-y divide-slate-100">
            {docsWithUrls.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between py-3 text-sm"
              >
                <div>
                  {doc.url ? (
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-slate-800 hover:underline"
                    >
                      {doc.file_name}
                    </a>
                  ) : (
                    <span className="font-medium text-slate-800">
                      {doc.file_name}
                    </span>
                  )}
                  <span className="ml-2 text-xs text-slate-400">
                    {formatBytes(doc.file_size)} ·{' '}
                    {new Date(doc.uploaded_at).toLocaleDateString()}
                  </span>
                  {doc.triage && (
                    <p className="mt-0.5 text-xs text-slate-500">
                      <span className="font-medium capitalize">{doc.triage.relevance} relevance</span>
                      {' · '}
                      {doc.triage.doc_type}
                      {doc.triage.important_pages.length > 0 &&
                        ` · pages ${doc.triage.important_pages
                          .map((r) => (r.start === r.end ? r.start : `${r.start}-${r.end}`))
                          .join(', ')} of ${doc.triage.total_pages} used`}
                    </p>
                  )}
                </div>
                <form action={deleteDocument}>
                  <input type="hidden" name="deal_id" value={deal.id} />
                  <input type="hidden" name="document_id" value={doc.id} />
                  <input
                    type="hidden"
                    name="storage_path"
                    value={doc.storage_path}
                  />
                  <ConfirmButton
                    confirmMessage={`Delete ${doc.file_name}? This cannot be undone.`}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Delete
                  </ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm text-slate-400">
            No documents uploaded yet.
          </p>
        )}
      </section>
      </CollapsibleSection>

      <CollapsibleSection title="Lenders sent to">
      <SubmissionsPanel
        dealId={deal.id}
        submissions={submissions}
        timeline={lenderTimeline}
        lenders={(lenderRows ?? []) as { id: string; name: string }[]}
      />
      </CollapsibleSection>

      <CollapsibleSection title="Updates">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Updates</h2>

        <form
          action={addDealUpdate}
          className="mb-5 flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="deal_id" value={deal.id} />
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Date
            </label>
            <input
              type="date"
              name="entry_date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600">
              Note
            </label>
            <input
              name="note"
              required
              placeholder="e.g. followed up with borrower, waiting on docs"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Add update
          </button>
        </form>

        {updates && updates.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {(updates as DealUpdate[]).map((u) => (
              <li key={u.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                <div>
                  <span className="mr-2 font-medium text-slate-700">
                    {u.entry_date
                      ? new Date(`${u.entry_date}T00:00:00`).toLocaleDateString()
                      : new Date(u.created_at).toLocaleDateString()}
                  </span>
                  {(u as DealUpdate & { lender_id?: string | null }).lender_id && (
                    <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                      {lenderNameById.get((u as DealUpdate & { lender_id?: string | null }).lender_id as string) ?? 'Lender'}
                    </span>
                  )}
                  <span className="text-slate-600">{u.note}</span>
                </div>
                <form action={deleteDealUpdate}>
                  <input type="hidden" name="deal_id" value={deal.id} />
                  <input type="hidden" name="update_id" value={u.id} />
                  <ConfirmButton
                    confirmMessage="Delete this update? This cannot be undone."
                    className="shrink-0 text-xs text-red-500 hover:underline"
                  >
                    Delete
                  </ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm text-slate-400">
            No updates logged yet.
          </p>
        )}
      </section>
      </CollapsibleSection>

      {dealEmails.length > 0 && (
        <CollapsibleSection title="Emails">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Emails ({dealEmails.length})</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Emails the inbox filed on this deal. Their full text is included when the deal is underwritten.
          </p>
          <ul className="mt-4 divide-y divide-slate-100">
            {dealEmails.map((e) => (
              <li key={e.id} className="py-3 text-sm">
                <details>
                  <summary className="cursor-pointer list-none">
                    <span className="mr-2 text-xs text-slate-400">
                      {e.received_at ? new Date(e.received_at).toLocaleDateString() : ''}
                    </span>
                    <span className="font-medium text-slate-800">{e.subject || '(no subject)'}</span>
                    <span className="text-slate-500"> — {e.from_email}</span>
                    {e.summary && <p className="mt-1 text-slate-600">{e.summary}</p>}
                    <span className="mt-1 inline-block text-xs text-slate-400 hover:underline">
                      {e.body_text ? 'Show full email' : 'Full text not stored (read before this was added)'}
                    </span>
                  </summary>
                  {e.body_text && (
                    <pre className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-xs text-slate-700">
                      {e.body_text}
                    </pre>
                  )}
                </details>
              </li>
            ))}
          </ul>
        </section>
        </CollapsibleSection>
      )}

      <CollapsibleSection title="AI underwriting" phoneClosed>
      <SnapshotPanel
        dealId={deal.id}
        snapshot={(deal.snapshot as Snapshot | null) ?? null}
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
          emailsToText(dealEmails)
        )}
        hasReportUnderwriting={Boolean(deal.underwriting)}
      />
      </CollapsibleSection>

      <CollapsibleSection title="Full research report" phoneClosed>
      <UnderwritingPanel
        dealId={deal.id}
        dealName={deal.company_name}
        estimate={estimateUnderwriting((documents ?? []) as DocumentRecord[])}
        lastRunCost={lastRunCost}
        underwriting={deal.underwriting as Underwriting | null}
        generatedAt={deal.underwriting_generated_at}
      />
      </CollapsibleSection>

      <CollapsibleSection title="Lender matching" phoneClosed>
      <MatchingPanel
        dealId={deal.id}
        matches={matchesWithLender}
        lastRunAt={lastMatchRunAt}
        hasUnderwriting={Boolean(deal.underwriting || deal.snapshot)}
        currentLoanType={deal.loan_type}
        sentLenderIds={submissions.map((x) => x.lender_id)}
        documents={docsWithUrls.map((d) => ({ id: d.id, name: d.file_name, size: d.file_size }))}
        mailboxes={mailboxes}
        defaultMailboxId={defaultMailboxId}
        loanTypeRecommendation={
          (deal as { loan_type_recommendation?: LoanTypeRecommendation | null }).loan_type_recommendation ?? null
        }
      />
      </CollapsibleSection>

      <CollapsibleSection title="Find new lenders" phoneClosed>
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
  )
}
