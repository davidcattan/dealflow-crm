import { ImportForm } from './import-form'

export const maxDuration = 120

export default function ImportDealsPage() {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Import deals
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload a historical pipeline file (.xlsx). Expected columns: Rep
          Name, Date, Deal Name, Deal Activity, Contact Name, Email/Phone,
          Type, Update, Notes. The Update column&apos;s dated log entries
          (e.g. &quot;9.16: ...&quot;) are split into individual entries on
          the deal&apos;s Updates tab.
        </p>
      </div>

      <ImportForm />
    </div>
  )
}
