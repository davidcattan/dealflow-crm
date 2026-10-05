'use client'

import { useTransition } from 'react'
import { disconnectOutlook } from './actions'

export function DisconnectButton({ connectionId, email }: { connectionId: string; email: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (confirm(`Disconnect ${email}? The CRM will stop reading this inbox and can't create drafts in it until it's reconnected.`))
          startTransition(() => disconnectOutlook(connectionId))
      }}
      className="text-xs text-red-600 hover:underline disabled:opacity-50"
    >
      {pending ? 'Disconnecting…' : 'Disconnect'}
    </button>
  )
}
