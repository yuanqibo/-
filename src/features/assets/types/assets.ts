export type AssetRecord = {
  id: string
  name: string
  status: string
  category: string
  type: string
  owner: string
  ownerSubject?: string
  department: string
  company: string
  location: string
  custodian: string
  model: string
  brand: string
  sn: string
  assetTag: string
  supplier: string
  supplierContact?: string
  supplierPhone?: string
  price: number
  purchaseDate: string
  warrantyDate: string
  receiveDate?: string
  borrowDate?: string
  expectedReturnDate?: string
  condition?: string
  unit?: string
  note?: string
  image?: string
  tags?: string[]
  lifecycle?: Array<[string, string, string]>
  [key: string]: unknown
}

export type BusinessRecord = {
  id: string
  type?: string
  name?: string
  applicant?: string
  asset?: string
  status?: string
  currentNode?: string
  date?: string
  owner?: string
  scope?: string
  total?: number
  checked?: number
  diff?: number
  reason?: string
  [key: string]: unknown
}

export type AssetOperationRecord = {
  id: string
  type: 'INBOUND' | 'RECEIVE' | 'RETURN' | 'BORROW' | 'BORROW_RETURN' | 'HANDOVER'
  assetId: string
  assetName?: string
  assetCategory?: string
  assetBrand?: string
  assetModel?: string
  assetSn?: string
  assetPrice?: number
  status?: string
  date?: string
  operator?: string
  party?: string
  partySubject?: string
  company?: string
  department?: string
  location?: string
  note?: string
  sourceType?: string
  expectedReturnDate?: string
  returnOrderId?: string
  canSign?: boolean
  createdAt?: string
  signedAt?: string
  signer?: string
  signerSubject?: string
  signatureImage?: string
  handoverType?: string
  previousParty?: string
  previousPartySubject?: string
  previousCompany?: string
  previousDepartment?: string
  previousLocation?: string
  assetOwnerCompany?: string
  noticeContent?: string
  rejectionReason?: string
  [key: string]: unknown
}

export type CatalogNode = {
  id: string
  code?: string
  name: string
  enabled?: boolean
  unit?: string
  usefulLife?: string
  children: CatalogNode[]
}

export type PortalStoreValues = {
  assetCategoryTree?: CatalogNode[]
  assetLocationTree?: CatalogNode[]
  assetPortalAssetCodeRuleSettingsV1?: Record<string, unknown>
  assetLabelPrintSettingsV2?: Record<string, unknown>
  assetLabelCustomTemplatesV1?: Array<Record<string, unknown>>
  assetPortalSelfServiceSettingsV9?: Record<string, unknown>
  [key: string]: unknown
}

export type DirectoryPerson = {
  subject: string
  name: string
  account: string
  email: string
  department: string
  company: string
}

export type AssetCommand =
  | 'receive'
  | 'return'
  | 'borrow'
  | 'borrow-return'
  | 'handover'
  | 'handover-sign'
  | 'handover-cancel'
  | 'receipt-sign'
  | 'receipt-reject'
  | 'receipt-cancel'
  | 'delete'
  | 'edit'
  | 'batch-edit'
  | 'cancel-inbound'
  | 'repair-start'
  | 'repair-complete'
  | 'update-import'
  | 'receive-import'

export type AssetDraft = Partial<AssetRecord> & { name: string; category: string; location: string }

export type AssetImportRow = { rowNumber: number; draft: AssetDraft | null; errors: string[] }
