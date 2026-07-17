export type DirectoryCompany = {
  unionId: string | null
  externalId: string | null
  name: string | null
  accountSetUnionId: string | null
}

export type DirectoryDepartment = {
  unionId: string | null
  externalId: string | null
  name: string | null
  path: string | null
}

export type DirectoryEmployee = {
  subject: string
  unionId: string | null
  externalId: string | null
  accountSetUnionId: string | null
  name: string | null
  displayName: string | null
  email: string | null
  phone: string | null
  employeeNo: string | null
  jobTitle: string | null
  status: string | null
  company: DirectoryCompany | null
  departments: DirectoryDepartment[]
}

export type DirectoryEmployeePage = {
  items: DirectoryEmployee[]
  current: number
  size: number
  total: number
  totalPages: number
  hasNext: boolean
}

export type DirectoryEmployeeQuery = {
  query?: string
  page: number
  size: number
}
