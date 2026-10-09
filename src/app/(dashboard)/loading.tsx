// Shown instantly while a page loads, so taps feel immediate instead of
// the screen sitting still until everything is ready.
export default function Loading() {
  return (
    <div className="animate-pulse space-y-5" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-48 rounded-md bg-slate-200" />
      <div className="h-4 w-32 rounded bg-slate-200" />
      <div className="h-16 rounded-xl bg-slate-200/70" />
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-slate-200/60" />
        ))}
      </div>
    </div>
  )
}
