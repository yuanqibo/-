export type SystemIntegration = {
  id: string
  code: string
  name: string
  provider: string
  baseUrl: string
  enabled: boolean
  config: Record<string, unknown>
  secretConfigured: boolean
  version: number
  updatedAt: string
}

export type LegacyAssetSyncStatus = {
  sourceSystem: string
  sourceOfTruth: string
  readOnly: boolean
  schedule: string
  timeZone: string
  cursorTime?: string
  runId?: string
  status?: string
  fetchedCount?: number
  appliedCount?: number
  failedCount?: number
  windowStart?: string
  windowEnd?: string
  startedAt?: string
  completedAt?: string
  errorMessage?: string
}

export type LegacyAssetSyncRun = {
  id: string
  status: string
  fetchedCount: number
  appliedCount: number
  failedCount: number
  windowStart: string
  windowEnd: string
  startedAt: string
  completedAt?: string
  errorMessage?: string
}

export type LegacyAssetSyncHistoryPage = {
  items: LegacyAssetSyncRun[]
  page: number
  pageSize: number
  total: number
}

export type SystemFormDefinition = {
  id: string
  code: string
  name: string
  description: string
  enabled: boolean
  schema: Record<string, unknown>
  version: number
  updatedAt: string
}

export type SelfServiceItem = {
  enabled: boolean
  approvalRequired?: boolean
  remarkRequired: boolean
  remarkPrompt: string
  categories?: string[]
  allowEmployeeAddDevice?: boolean
}

export type SelfServiceSignItem = {
  employeeSign: boolean
  noticeEnabled: boolean
  noticeContent: string
  timings: Record<string, boolean>
}

export type SelfServiceSignSettings = Record<string, SelfServiceSignItem>

export type SelfServiceSettings = Record<string, unknown> & {
  receiveAsset?: SelfServiceItem
  returnAsset?: SelfServiceItem
  borrowAsset?: SelfServiceItem
  giveBackAsset?: SelfServiceItem
  handoverAsset?: SelfServiceItem
  deviceRequest?: SelfServiceItem
  signSettings?: SelfServiceSignSettings
}
