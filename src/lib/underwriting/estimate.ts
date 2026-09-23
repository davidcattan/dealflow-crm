import type { DocumentRecord } from '@/lib/types'

export type UnderwritingEstimate = {
  low: number
  high: number
  docTokens: number
  docCount: number
  untriagedPdfs: number
  lines: string[]
}

// Rough token cost per kind of document. These are deliberately simple
// heuristics — the point is a sensible ballpark before clicking, not an
// invoice. Real spend for every run is logged on the Usage page.
const TOKENS_PER_PDF_PAGE = 2500
const TOKENS_PER_IMAGE = 1600
const BYTES_PER_PDF_PAGE = 75_000

const PRICE_IN = 5 / 1_000_000 // Opus 5, $ per input token
const PRICE_OUT = 25 / 1_000_000

// Fixed part of every run: research write-up (~8-12k output tokens), the
// structuring call, and up to 3 web searches.
const OUTPUT_TOKENS = 14_000
const WEB_SEARCH_COST = 0.03
const BASE_INPUT_TOKENS = 4_000 // prompt, website text, search results

export function estimateUnderwriting(documents: DocumentRecord[]): UnderwritingEstimate {
  let docTokens = 0
  let untriagedPdfs = 0
  const lines: string[] = []

  for (const d of documents) {
    const ext = d.file_name.split('.').pop()?.toLowerCase() ?? ''
    const type = d.content_type ?? ''
    const size = d.file_size ?? 0

    if (type === 'application/pdf' || ext === 'pdf') {
      let pages: number
      if (d.triage) {
        const keep = d.triage.important_pages.reduce((n, r) => n + (r.end - r.start + 1), 0)
        pages = keep > 0 ? Math.min(keep, d.triage.total_pages) : d.triage.total_pages
      } else {
        pages = Math.max(1, Math.round(size / BYTES_PER_PDF_PAGE))
        if (pages > 10) untriagedPdfs++
      }
      docTokens += pages * TOKENS_PER_PDF_PAGE
      lines.push(`${d.file_name}: ~${pages} page${pages === 1 ? '' : 's'}${d.triage ? '' : ' (guessed from file size)'}`)
    } else if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
      docTokens += TOKENS_PER_IMAGE
      lines.push(`${d.file_name}: image`)
    } else if (['xlsx', 'xls', 'csv', 'txt', 'eml'].includes(ext) || type.startsWith('text/')) {
      const tokens = Math.min(Math.round(size / 3), 60_000)
      docTokens += tokens
      lines.push(`${d.file_name}: ~${Math.round(tokens / 1000)}k tokens of text`)
    }
  }

  // The research step can re-read the documents each time it searches the
  // web, so input is billed roughly 1-3.5x the document size.
  const input = docTokens + BASE_INPUT_TOKENS
  const fixed = OUTPUT_TOKENS * PRICE_OUT + WEB_SEARCH_COST
  const low = input * 1 * PRICE_IN + fixed
  const high = input * 3.5 * PRICE_IN + fixed * 1.5

  return { low, high, docTokens, docCount: documents.length, untriagedPdfs, lines }
}
