// Opens the "CRM underwriting queue (cloud)" routine on claude.ai, where
// "Run now" processes every queued deal in the cloud (Mac can be off).
// The routine lives on David's Claude account.
export const QUEUE_ROUTINE_URL = 'https://claude.ai/code/routines/trig_01DmeucR5uokXZXhBV338pJD'

export function RunQueueButton({ className = '' }: { className?: string }) {
  return (
    <a
      href={QUEUE_ROUTINE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 ${className}`}
    >
      Run the queue now ↗
    </a>
  )
}
