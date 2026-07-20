<script setup lang="ts">
import { computed } from 'vue'
import type { AssetRecord } from '../types/assets'

export type AssetOrderPrintKind = 'inbound' | 'receive' | 'return' | 'employee' | 'handover'

const props = defineProps<{
  kind: AssetOrderPrintKind
  rows: AssetRecord[]
  currentUser?: string
}>()

const config = computed(() => ({
  inbound: { eyebrow: '资产入库', title: '入库单打印预览', personLabel: '入库人' },
  receive: { eyebrow: '领用', title: '领用单打印预览', personLabel: '领用人' },
  return: { eyebrow: '退库', title: '领用退库单打印预览', personLabel: '领用人' },
  employee: { eyebrow: '员工申领', title: '员工申领单打印预览', personLabel: '领用人' },
  handover: { eyebrow: '交接', title: '交接单打印预览', personLabel: '接收人' }
}[props.kind]))

const isInbound = computed(() => props.kind === 'inbound')
const text = (value: unknown): string => String(value ?? '').trim() || '-'
const orderNumber = (row: AssetRecord): string => text(row.operationId || row.inboundOrderId)
const operationDate = (row: AssetRecord): string => text(row.operationDate || row.receiveDate || row.borrowDate || row.purchaseDate)
const operator = (row: Partial<AssetRecord>): string => text(row.operator || row.custodian)
const money = (value: unknown): string => `¥${Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
const summary = computed(() => {
  const categories = Array.from(new Set(props.rows.map((row) => row.category).filter(Boolean))).join('、') || '-'
  const companies = Array.from(new Set(props.rows.map((row) => text(row.ownerCompany || row.company)).filter((value) => value !== '-'))).join('、') || '-'
  const total = props.rows.reduce((sum, row) => sum + Number(row.price || 0), 0)
  return [
    ['入库单数', props.rows.length], ['资产数量', props.rows.length], ['资产分类', categories],
    ['所属公司', companies], ['入库总金额', money(total)], ['打印日期', new Date().toISOString().slice(0, 10)]
  ]
})
</script>

<template>
  <div class="print-preview asset-order-print-preview">
    <div class="print-preview-head">
      <div><div class="eyebrow">{{ config.eyebrow }}</div><h3>{{ config.title }}</h3></div>
      <span class="tag blue">共 {{ rows.length }} 条</span>
    </div>
    <div v-if="isInbound" class="print-summary-grid">
      <div v-for="item in summary" :key="String(item[0])" class="detail-item"><div class="detail-label">{{ item[0] }}</div><div class="detail-value">{{ item[1] }}</div></div>
    </div>
    <div class="print-table-wrap">
      <table class="print-table">
        <thead>
          <tr v-if="isInbound"><th>入库单号</th><th>入库状态</th><th>资产编码</th><th>资产名称</th><th>资产分类</th><th>入库日期</th><th>入库人</th><th>金额</th></tr>
          <tr v-else><th>单号</th><th>状态</th><th>日期</th><th>经办人</th><th>{{ config.personLabel }}</th><th>资产编码</th><th>资产名称</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="`${orderNumber(row)}-${row.id}`">
            <template v-if="isInbound"><td>{{ orderNumber(row) }}</td><td>{{ text(row.status) }}</td><td>{{ row.id }}</td><td>{{ text(row.name) }}</td><td>{{ text(row.category) }}</td><td>{{ operationDate(row) }}</td><td>{{ operator(row) }}</td><td>{{ money(row.price) }}</td></template>
            <template v-else><td>{{ orderNumber(row) }}</td><td>{{ text(row.status) }}</td><td>{{ operationDate(row) }}</td><td>{{ operator(row) }}</td><td>{{ text(row.owner) }}</td><td>{{ row.id }}</td><td>{{ text(row.name) }}</td></template>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="print-sign-grid">
      <div>{{ isInbound ? '入库人' : '经办人' }}：{{ rows[0] ? operator(rows[0]) : currentUser || '-' }}</div>
      <div v-if="isInbound">采购人：{{ text(rows[0]?.purchaser) }}</div><div v-else>{{ config.personLabel }}：</div>
      <div>管理员签字：</div><div>日期：</div>
    </div>
  </div>
</template>
