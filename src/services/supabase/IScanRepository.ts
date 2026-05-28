import type { ScanResult } from '@/types/domain'

export interface IScanRepository {
  scan(token: string): Promise<ScanResult>
}
