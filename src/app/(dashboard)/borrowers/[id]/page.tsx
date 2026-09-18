import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BORROWER_STATUSES, type DocumentRecord } from '@/lib/types'
import { updateBorrower, uploadDocument, deleteDocument } from './actions'

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(0)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

export default async function BorrowerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: borrower }, { data: documents }] = await Promise.all([
    supabase.from('borrowers').select('*').eq('id', id).single(),
    supabase
      .from('documents')
      .select('*')
      .eq('borrower_id', id)
      .order('uploaded_at', { ascending: false }),
  ])

  if (!borrower) notFound()

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
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          {borrower.company_name}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Added {new Date(borrower.created_at).toLocaleDateString()}
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">
          Deal details
        </h2>
        <form
          action={updateBorrower}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <input type="hidden" name="borrower_id" value={borrower.id} />

          <div>
            <label className="block text-xs font-medium text-slate-600">
              Company name
            </label>
            <input
              name="company_name"
              defaultValue={borrower.company_name}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Status
            </label>
            <select
              name="status"
              defaultValue={borrower.status}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {BORROWER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Industry
            </label>
            <input
              name="industry"
              defaultValue={borrower.industry ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Website
            </label>
            <input
              name="website"
              defaultValue={borrower.website ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Contact name
            </label>
            <input
              name="contact_name"
              defaultValue={borrower.contact_name ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Contact email
            </label>
            <input
              name="contact_email"
              defaultValue={borrower.contact_email ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Contact phone
            </label>
            <input
              name="contact_phone"
              defaultValue={borrower.contact_phone ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600">
              Notes
            </label>
            <textarea
              name="notes"
              rows={4}
              defaultValue={borrower.notes ?? ''}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Save changes
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">
          Diligence documents
        </h2>

        <form
          action={uploadDocument}
          className="mb-5 flex flex-wrap items-center gap-3"
        >
          <input type="hidden" name="borrower_id" value={borrower.id} />
          <input
            type="file"
            name="file"
            required
            className="text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
          />
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Upload
          </button>
        </form>

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
                </div>
                <form action={deleteDocument}>
                  <input type="hidden" name="borrower_id" value={borrower.id} />
                  <input type="hidden" name="document_id" value={doc.id} />
                  <input
                    type="hidden"
                    name="storage_path"
                    value={doc.storage_path}
                  />
                  <button
                    type="submit"
                    className="text-xs text-red-500 hover:underline"
                  >
                    Delete
                  </button>
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
    </div>
  )
}
