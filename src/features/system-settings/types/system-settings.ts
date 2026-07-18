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
