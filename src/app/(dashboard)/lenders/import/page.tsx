import { ImportForm } from './import-form'

export const maxDuration = 120

export default function ImportLendersPage() {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Import lenders
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload your lender list (.xlsx). Expected columns: Name, Company,
          Email, Type, Min Check Size, Minimum Revenue, Minimum EBITDA, Care
          About Profit?, Notes.
        </p>
      </div>

      <ImportForm />
    </div>
  )
}
