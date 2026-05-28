import { useMutation } from '@tanstack/react-query'
import { scanService } from '@/services/supabase/scanService'
import type { ScanResult } from '@/types/domain'

export function useScanner() {
  return useMutation<ScanResult, Error, string>({
    mutationFn: (token: string) => scanService.scan(token),
  })
}
