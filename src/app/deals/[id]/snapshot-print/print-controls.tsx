'use client'

// Kept as a tiny client island so the rest of the page can be a plain
// server component. window.print() opens the browser's normal print
// dialog, where "Save as PDF" is one of the destination options — that's
// the export path, no PDF library needed.
export function PrintControls() {
  return (
    <div className="print-hide sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
      <span className="text-xs text-slate-500">
        This is the clean, print-ready version — no app navigation, sized for one page where possible.
      </span>
      <button
        onClick={() => window.print()}
        className="shrink-0 rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
      >
        Print / Save as PDF
      </button>
    </div>
  )
}
