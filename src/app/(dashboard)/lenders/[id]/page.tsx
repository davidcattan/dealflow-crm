import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LenderDetail } from './lender-detail'
import type { Lender, LenderContact } from '@/lib/types'

export default async function LenderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const [{ data: lender }, { data: contacts }] = await Promise.all([
    supabase.from('lenders').select('*').eq('id', id).single(),
    supabase
      .from('lender_contacts')
      .select('*')
      .eq('lender_id', id)
      .order('created_at', { ascending: true }),
  ])

  if (!lender) notFound()

  return (
    <LenderDetail
      lender={lender as Lender}
      contacts={(contacts ?? []) as LenderContact[]}
    />
  )
}
