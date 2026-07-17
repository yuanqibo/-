export type OrganizationAccountSet = {
  unionId: string | null
  name: string | null
  code: string | null
  status: string | null
  sourceType: string | null
  setType: string | null
  configStatus: string | null
  syncMode: string | null
  syncStatus: string | null
  syncVersion: number | null
  dataVersion: number | null
  lastSyncAt: string | null
}

export type OrganizationNode = {
  key: string
  unionId: string | null
  externalId: string | null
  name: string | null
  nodeType: string | null
  path: string | null
  fullPath: string | null
  status: string | null
  sourceType: string | null
  accountSetUnionId: string | null
  companyUnionId: string | null
  parentUnionId: string | null
  leaderName: string | null
  level: number
  directSubjects: string[]
  memberSubjects: string[]
  children: OrganizationNode[]
}

export type OrganizationUserDepartment = {
  unionId: string | null
  externalId: string | null
  name: string | null
  nodeType: string | null
  path: string | null
  leaderName: string | null
}

export type OrganizationUser = {
  subject: string
  unionId: string | null
  externalId: string | null
  accountSetUnionId: string | null
  name: string | null
  email: string | null
  phone: string | null
  employeeNo: string | null
  jobTitle: string | null
  status: string | null
  companyUnionId: string | null
  companyName: string | null
  departments: OrganizationUserDepartment[]
}

export type OrganizationCapabilities = {
  sync: boolean
  syncConfiguration: boolean
  accountSetSettings: boolean
  unavailableReason: string | null
}

export type OrganizationConsole = {
  accountSets: OrganizationAccountSet[]
  roots: OrganizationNode[]
  users: OrganizationUser[]
  capabilities: OrganizationCapabilities
  warnings: string[]
  fetchedAt: string | null
}

export type OrganizationMember = OrganizationUser & {
  company: string
  department: string
  accountSetName: string
  accountSetSourceType: string
  accountSetSyncMode: string
}

export type OrganizationMemberScope = 'all' | 'direct'
export type OrganizationAccountStatus = 'all' | 'enabled' | 'disabled'

export type OrganizationFilterOption<T extends string> = {
  value: T
  label: string
  triggerLabel?: string
}
