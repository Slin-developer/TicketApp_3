import { supabase } from '@/lib/supabaseClient'
import type { ScanResult } from '@/types/domain'
import type { IScanRepository } from './IScanRepository'

// scan_ticket returns jsonb shaped as:
//   { result: 'success', ticket_id: <uuid> }
// | { result: 'already_scanned' | 'not_found' | 'unauthorized' }
interface RawScanResponse {
  result: 'success' | 'already_scanned' | 'not_found' | 'unauthorized'
  ticket_id?: string
}

function parseScanResponse(raw: unknown): ScanResult {
  const r = raw as RawScanResponse | null
  if (!r || typeof r !== 'object' || typeof r.result !== 'string') {
    throw new Error('scan_ticket returned an unrecognized payload.')
  }
  switch (r.result) {
    case 'success':
      if (!r.ticket_id) throw new Error('scan_ticket success missing ticket_id.')
      return { result: 'success', ticketId: r.ticket_id }
    case 'already_scanned':
      return { result: 'already_scanned' }
    case 'not_found':
      return { result: 'not_found' }
    case 'unauthorized':
      return { result: 'unauthorized' }
    default:
      throw new Error(`scan_ticket returned unknown result: ${String(r.result)}`)
  }
}

export const scanService: IScanRepository = {
  // Returns a typed ScanResult; only throws on transport/auth/shape errors,
  // not on business outcomes (already_scanned, not_found, unauthorized).
  async scan(token: string): Promise<ScanResult> {
    const { data, error } = await supabase.rpc('scan_ticket', {
      input_token: token,
    })
    if (error) throw error
    return parseScanResponse(data)
  },
}
