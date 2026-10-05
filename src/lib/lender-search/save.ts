import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LenderSearch } from './schema'

export async function saveLenderSearch(supabase: SupabaseClient, dealId: string, search: LenderSearch) {
  const { data, error } = await supabase
    .from('deals')
    .update({
      lender_search: search,
      lender_search_generated_at: new Date().toISOString(),
      lender_search_requested_at: null,
    })
    .eq('id', dealId)
    .select('id')
    .single()
  if (error || !data) throw new Error('Failed to save the lender search')
}
