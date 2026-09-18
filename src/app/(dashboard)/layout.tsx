import Link from 'next/link'
import { requireUser } from '@/lib/dal'
import { logout } from '@/app/login/actions'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser()

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <span className="text-sm font-semibold text-slate-900">
              Dealflow CRM
            </span>
            <nav className="flex gap-5 text-sm text-slate-600">
              <Link href="/" className="hover:text-slate-900">
                Dashboard
              </Link>
              <Link href="/borrowers" className="hover:text-slate-900">
                Borrowers
              </Link>
              <Link href="/lenders" className="hover:text-slate-900">
                Lenders
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span>{user.email}</span>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-md border border-slate-300 px-3 py-1 text-slate-600 hover:bg-slate-100"
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
  )
}
