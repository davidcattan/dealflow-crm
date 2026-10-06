import Link from 'next/link'
import { requireUser } from '@/lib/dal'
import { logout } from '@/app/login/actions'
import { UnderwritingRunnerProvider } from '@/components/underwriting-runner'
import { createClient } from '@/lib/supabase/server'
import { getInboxHealth } from '@/lib/inbox/health'
import { InboxHealthBadge } from '@/components/inbox-health-badge'
import { unreadCount } from '@/lib/notifications'
import { AskAiPanel } from '@/components/ask-ai-panel'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser()
  const supabase = await createClient()
  const [health, unread] = await Promise.all([getInboxHealth(supabase), unreadCount(supabase, user.id)])

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
              <Link href="/activity" className="whitespace-nowrap hover:text-slate-900">
                Activity
              </Link>
              <Link href="/usage" className="whitespace-nowrap hover:text-slate-900">
                Usage
              </Link>
              <Link href="/settings" className="whitespace-nowrap hover:text-slate-900">
                Settings
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <Link
              href="/activity"
              title={unread ? `${unread} new update${unread === 1 ? '' : 's'} from email` : 'Activity'}
              className="relative rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
              </svg>
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
            <InboxHealthBadge health={health} />
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
      <AskAiPanel />
    </div>
    </UnderwritingRunnerProvider>
  )
}
