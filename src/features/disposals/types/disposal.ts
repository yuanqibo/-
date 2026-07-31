import type { AssetRecord } from '../../assets/types/assets'

export type DisposalStatus = '待处置' | '已处置' | '已取消' | '部分取消'
export type DisposalLineStatus = '待处置' | '已处置' | '已取消'

export type DisposalAssetLine = AssetRecord & {
  assetId: string
  status: DisposalLineStatus
  previousStatus: string
}

export type DisposalRecord = {
  id: string
  status: DisposalStatus
  disposalType: string
  company: string
  operator: string
  amount: number
  fee: number
  description: string
  createdAt: string
  createdDate: string
  completedAt?: string
  returnDate?: string
  assetCount: number
  assets: DisposalAssetLine[]
}

export type DisposalDraft = {
  disposalType: string
  company: string
  operator: string
  amount?: number | null
  fee?: number | null
  description: string
  returnDate: string
  assetIds: string[]
}
