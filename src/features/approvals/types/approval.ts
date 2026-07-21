export type ApprovalRecord = {
  id: string
  type: string
  applicant: string
  applicantSubject?: string
  asset: string
  assetIds?: string[]
  assetCount?: number
  reason: string
  status: string
  system: string
  date: string
  currentNode: string
  approvalNo?: string
  bizNo?: string
  templateCode?: string
  approvalStatus?: string
  approvalSyncedAt?: string
  decisionSubmitted?: ApprovalDecision
  decisionSubmittedAt?: string
  decisionReason?: string
  decisionOperator?: string
  [key: string]: unknown
}

export type ApprovalDecision = 'approve' | 'reject' | 'cancel'
