import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logUsage } from '@/lib/usage'
import { TRIAGE_MODEL } from '@/lib/inbox/classify'
import type { MessageAttachment } from '@/lib/outlook/graph'

// A lender's reply can carry two kinds of files: things about the deal
// (a term sheet, an LOI, an approval, the borrower's documents) and the
// lender's own marketing (their tear sheet, program guides, rate sheet).
// The first belong on the deal; the second on the lender's profile, where
// they're read to learn what the lender does.

const Schema = z.object({
  lender_materials: z
    .array(z.string())
    .describe("Exact file names that are the lender's own general materials — tear sheet, program guide/summary, product flyer, rate sheet, brochure, capabilities deck — not about this specific deal."),
})

// Which of these attachment names are the lender's own materials (a cheap
// read of the names and the email). When unsure, a file stays on the deal.
export async function lenderMaterialNames(
  supabase: SupabaseClient,
  opts: { lenderName: string; subject: string; body: string; names: string[] }
): Promise<Set<string>> {
  if (!opts.names.length) return new Set()
  const response = await new Anthropic().messages.parse({
    model: TRIAGE_MODEL,
    max_tokens: 600,
    messages: [
      {
        role: 'user',
        content: [
          `A lender (${opts.lenderName}) replied to a debt broker about a deal. Which attachments are the lender's OWN general materials (tear sheet, program guides, product flyers, rate sheet, brochure) rather than documents about this specific deal (term sheet, LOI, approval, application, the borrower's files, deal-specific forms)? When unsure, leave it out.`,
          '',
          `Subject: ${opts.subject}`,
          opts.body.slice(0, 3000),
          '',
          `Attachments: ${opts.names.join(' | ')}`,
        ].join('\n'),
      },
    ],
    output_config: { format: zodOutputFormat(Schema) },
  })
  await logUsage({ feature: 'lender-materials', model: TRIAGE_MODEL, usage: response.usage, supabase })
  const picked = new Set(response.parsed_output?.lender_materials ?? [])
  return new Set(opts.names.filter((n) => picked.has(n)))
}

// Saves the lender's materials onto their profile (skipping files it
// already has); they're read on the next scheduled run.
export async function saveLenderMaterials(supabase: SupabaseClient, lenderId: string, attachments: MessageAttachment[]) {
  const { data: existing } = await supabase.from('lender_documents').select('file_name, file_size').eq('lender_id', lenderId)
  const have = new Set((existing ?? []).map((d) => `${d.file_name}|${d.file_size}`))
  let saved = 0
  for (const a of attachments) {
    const bytes = Buffer.from(a.contentBytes, 'base64')
    if (have.has(`${a.name}|${bytes.byteLength}`)) continue
    const storagePath = `lenders/${lenderId}/${Date.now()}-${a.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage.from('borrower-documents').upload(storagePath, bytes, { contentType: a.contentType })
    if (error) continue
    const { error: rowError } = await supabase.from('lender_documents').insert({
      lender_id: lenderId,
      file_name: a.name,
      storage_path: storagePath,
      file_size: bytes.byteLength,
      content_type: a.contentType,
    })
    if (rowError) {
      await supabase.storage.from('borrower-documents').remove([storagePath])
      // No lender_documents table yet (migration 050): the caller keeps the
      // files on the deal instead.
      if (rowError.message.includes('lender_documents')) throw new Error(rowError.message)
      continue
    }
    have.add(`${a.name}|${bytes.byteLength}`)
    saved++
  }
  return saved
}
