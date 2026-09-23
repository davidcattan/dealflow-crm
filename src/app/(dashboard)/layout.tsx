import Link from 'next/link'
import { requireUser } from '@/lib/dal'
import { logout } from '@/app/login/actions'
import { UnderwritingRunnerProvider } from '@/components/underwriting-runner'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser()

  return (
    <UnderwritingRunnerProvider>
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <Link href="/" className="whitespace-nowrap text-sm font-semibold text-slate-900 hover:text-slate-600">
              Dealflow CRM
            </Link>
            <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
              <Link href="/" className="whitespace-nowrap hover:text-slate-900">
                Dashboard
              </Link>
              <Link href="/pipeline" className="whitespace-nowrap hover:text-slate-900">
                Pipeline
              </Link>
              <Link href="/deals" className="whitespace-nowrap hover:text-slate-900">
                Deals
              </Link>
              <Link href="/lenders" className="whitespace-nowrap hover:text-slate-900">
                Lenders
              </Link>
              <Link href="/usage" className="whitespace-nowrap hover:text-slate-900">
                Usage
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="hidden whitespace-nowrap sm:inline">
              {user.email}
            </span>
            <form action={logout}>
              <button
                type="submit"
                className="whitespace-nowrap rounded-md border border-slate-300 px-3 py-1 text-slate-600 hover:bg-slate-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {children}
      </main>
    </div>
    </UnderwritingRunnerProvider>
  )
}
