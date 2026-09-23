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
import { estimateUnderwriting } from '@/lib/underwriting/estimate'
import { MatchingPanel, type MatchWithLender } from './matching-panel'
import { DocumentUploader } from './document-uploader'
import type { Underwriting } from '@/lib/underwriting/schema'
import { formatDateOnly } from '@/lib/format'
import { DealDetails } from './deal-details'

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
          'id, lender_id, score, reasoning, selected, created_at, draft_subject, draft_body, draft_status, lenders(name)'
        )
        .eq('deal_id', id)
        .order('score', { ascending: false }),
    ])

  if (!deal) notFound()

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
      return { ...doc, url: data?.signedUrl ?? null }
    })
  )

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
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
        <div className="flex items-center gap-2">
          <form action={setDealStatusQuick}>
            <input type="hidden" name="deal_id" value={deal.id} />
            <input
              type="hidden"
              name="status"
              value={deal.status === 'dead' ? 'in_review' : 'dead'}
            />
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              {deal.status === 'dead' ? 'Reopen deal' : 'Mark as dead'}
            </button>
          </form>
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

      <DealDetails deal={deal as Deal} />

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

      <UnderwritingPanel
        dealId={deal.id}
        dealName={deal.company_name}
        estimate={estimateUnderwriting((documents ?? []) as DocumentRecord[])}
        lastRunCost={lastRunCost}
        underwriting={deal.underwriting as Underwriting | null}
        generatedAt={deal.underwriting_generated_at}
      />

      <MatchingPanel
        dealId={deal.id}
        matches={matchesWithLender}
        lastRunAt={lastMatchRunAt}
        hasUnderwriting={Boolean(deal.underwriting)}
        currentLoanType={deal.loan_type}
      />
    </div>
  )
}
