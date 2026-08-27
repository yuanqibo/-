<script setup lang="ts">
import { computed } from 'vue'
import { createQrGraphic, type QrGraphic } from '../composables/qrGraphic'
import { displayAssetCode, displayAssetStatus, type AssetRecord } from '../types/assets'

type LabelSettings = {
  templateKey: string
  labelWidth: number
  labelHeight: number
  logoWidth: number
  logoHeight: number
  logoScale: number
  logoText: string
  logoImage: string
  qrSize: number
  qrTextGap: number
  contentScale: number
  offsetX: number
  offsetY: number
  fontSize: number
  fieldFontSizes: number[]
  columns: number
  rows: number
  columnGap: number
  rowGap: number
  fields: string[]
  scanFields: string[]
  customFields: string
  showLogo: boolean
  ownershipText?: string
}

type LabelRow = { label: string; value: string; fontSize: number }
type LabelEntry = { asset: AssetRecord; rows: LabelRow[]; scanText: string; qr: QrGraphic; accessQr: QrGraphic }

const props = defineProps<{
  assets: AssetRecord[]
  settings: Record<string, unknown>
  customTemplates: Array<Record<string, unknown>>
}>()

const accessTemplateUrl = '/assets/asset-code-template.svg'

const emit = defineEmits<{
  print: [options: Pick<LabelSettings, 'labelWidth' | 'labelHeight' | 'columns' | 'rows' | 'columnGap' | 'rowGap'>]
}>()

const fieldLabels: Record<string, string> = {
  id: '资产编码', name: '资产名称', category: '资产分类', status: '资产状态', owner: '使用人', employeeCode: '员工工号',
  department: '使用部门', location: '所在位置', brand: '品牌', model: '型号', sn: '序列号', phone: '手机号', email: '电子邮箱',
  receiveDate: '领用日期', assetTag: '资产标签', price: '金额', supplier: '供应商', purchaseMethod: '购置方式', custodian: '管理员',
  note: '备注', company: '所属公司'
}

const presets: Record<string, Omit<LabelSettings, 'templateKey' | 'fieldFontSizes'>> = {
  standard: {
    labelWidth: 40, labelHeight: 30, logoWidth: 14, logoHeight: 8, logoScale: 80, logoText: 'AM', logoImage: '', qrSize: 13,
    qrTextGap: 2, contentScale: 80, offsetX: 0, offsetY: 0, fontSize: 12, columns: 1, rows: 1, columnGap: 0, rowGap: 0,
    fields: ['name', 'id', 'category'], scanFields: [], customFields: '', showLogo: false
  },
  compact: {
    labelWidth: 60, labelHeight: 40, logoWidth: 10, logoHeight: 6, logoScale: 100, logoText: 'IT', logoImage: '', qrSize: 15,
    qrTextGap: 10, contentScale: 100, offsetX: 0, offsetY: 0, fontSize: 7, columns: 1, rows: 1, columnGap: 5, rowGap: 5,
    fields: ['id', 'name', 'category', 'owner'], scanFields: [], customFields: '', showLogo: false
  },
  full: {
    labelWidth: 60, labelHeight: 40, logoWidth: 18, logoHeight: 10, logoScale: 100, logoText: '资产云', logoImage: '', qrSize: 24,
    qrTextGap: 6, contentScale: 100, offsetX: 0, offsetY: 0, fontSize: 12, columns: 1, rows: 1, columnGap: 5, rowGap: 5,
    fields: ['name', 'id'], scanFields: [], customFields: '管理员=custodian', showLogo: false
  },
  access: {
    labelWidth: 60, labelHeight: 40, logoWidth: 0, logoHeight: 0, logoScale: 100, logoText: '', logoImage: '', qrSize: 17,
    qrTextGap: 0, contentScale: 100, offsetX: 0, offsetY: 0, fontSize: 10, columns: 1, rows: 1, columnGap: 0, rowGap: 0,
    fields: ['id', 'model'], scanFields: [], customFields: '', showLogo: false, ownershipText: '此资产归Access集团所有'
  }
}

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback
}

const stringList = (value: unknown, fallback: string[]): string[] => {
  const list = Array.isArray(value) ? value : String(value || '').split(',')
  const normalized = Array.from(new Set(list.map((item) => String(item || '').trim()).filter(Boolean)))
  return normalized.length ? normalized : fallback
}

const customTemplate = computed(() => props.customTemplates.find((item) => String(item.key || item.id || '') === String(props.settings.templateKey || '')))
const baseTemplateKey = computed(() => {
  const direct = String(props.settings.templateKey || 'standard')
  if (presets[direct]) return direct
  const customBase = String(customTemplate.value?.baseTemplateKey || '')
  const storedSettings = customTemplate.value?.settings as Record<string, unknown> | undefined
  const storedBase = String(storedSettings?.templateKey || '')
  return presets[customBase] ? customBase : presets[storedBase] ? storedBase : 'standard'
})

const normalizedSettings = computed<LabelSettings>(() => {
  const key = baseTemplateKey.value
  const defaults = presets[key] || presets.standard
  const customSettings = customTemplate.value?.settings && typeof customTemplate.value.settings === 'object'
    ? customTemplate.value.settings as Record<string, unknown>
    : {}
  const selectedTemplateKey = String(props.settings.templateKey || '').trim()
  const source = selectedTemplateKey === 'defaultAsset' || selectedTemplateKey === 'access'
    ? {}
    : { ...customSettings, ...props.settings }
  const fontSize = clampNumber(source.fontSize, defaults.fontSize, 5, 22)
  const rawFontSizes = Array.isArray(source.fieldFontSizes) ? source.fieldFontSizes : String(source.fieldFontSizes || '').split(',')
  const fields = stringList(source.fields, defaults.fields).slice(0, key === 'full' ? 2 : 24)
  return {
    templateKey: key,
    labelWidth: clampNumber(source.labelWidth, defaults.labelWidth, 20, 160),
    labelHeight: clampNumber(source.labelHeight, defaults.labelHeight, 12, 120),
    logoWidth: clampNumber(source.logoWidth, defaults.logoWidth, 0, 60),
    logoHeight: clampNumber(source.logoHeight, defaults.logoHeight, 0, 40),
    logoScale: Math.round(clampNumber(source.logoScale, defaults.logoScale, 50, 160)),
    logoText: String(source.logoText ?? defaults.logoText).slice(0, 12),
    logoImage: String(source.logoImage ?? defaults.logoImage),
    qrSize: clampNumber(source.qrSize, defaults.qrSize, 8, 60),
    qrTextGap: clampNumber(source.qrTextGap, defaults.qrTextGap, 0, 30),
    contentScale: clampNumber(source.contentScale, defaults.contentScale, 50, 160),
    offsetX: clampNumber(source.offsetX, defaults.offsetX, -30, 30),
    offsetY: clampNumber(source.offsetY, defaults.offsetY, -30, 30),
    fontSize,
    fieldFontSizes: rawFontSizes.map((item) => Math.round(clampNumber(item, fontSize, 5, 22))).slice(0, 12),
    columns: Math.round(clampNumber(source.columns, defaults.columns, 1, 8)),
    rows: Math.round(clampNumber(source.rows, defaults.rows, 1, 14)),
    columnGap: clampNumber(source.columnGap, defaults.columnGap, 0, 30),
    rowGap: clampNumber(source.rowGap, defaults.rowGap, 0, 30),
    fields,
    scanFields: stringList(source.scanFields, defaults.scanFields),
    customFields: String(source.customFields ?? defaults.customFields).slice(0, 600),
    showLogo: source.showLogo === undefined ? defaults.showLogo : Boolean(source.showLogo),
    ownershipText: String(source.ownershipText ?? defaults.ownershipText ?? '此资产归Access集团所有').slice(0, 40)
  }
})

const fieldValue = (asset: AssetRecord, key: string): string => {
  const values: Record<string, unknown> = {
    id: displayAssetCode(asset), name: asset.name, category: asset.category, status: displayAssetStatus(asset), owner: asset.owner,
    employeeCode: asset.employeeCode, department: asset.department, location: asset.location, brand: asset.brand, model: asset.model,
    sn: asset.sn, phone: asset.phone, email: asset.email, receiveDate: asset.receiveDate, assetTag: asset.assetTag,
    price: asset.price ? `¥${Number(asset.price).toLocaleString('zh-CN')}` : '', supplier: asset.supplier,
    purchaseMethod: asset.purchaseMethod, custodian: asset.custodian, note: asset.note, company: asset.company
  }
  const value = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : asset[key]
  return value === undefined || value === null || value === '' ? '-' : String(value)
}

const customFields = (text: string): Array<{ label: string; source: string }> => String(text)
  .split(/\n|;/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const index = line.search(/[=:：]/)
    return index === -1
      ? { label: line, source: line }
      : { label: line.slice(0, index).trim() || '自定义字段', source: line.slice(index + 1).trim() }
  })

const customValue = (asset: AssetRecord, source: string): string => source in fieldLabels || source in asset ? fieldValue(asset, source) : source || '-'
const rowFontSize = (settings: LabelSettings, index: number): number => Math.round(clampNumber(settings.fieldFontSizes[index], settings.fontSize, 5, 22))
const accessTextUnits = (value: string): number => Array.from(String(value || '')).reduce((total, character) => {
  if (/\s/.test(character)) return total + 0.28
  if (/[A-Z0-9]/.test(character)) return total + 0.62
  if (/[a-z]/.test(character)) return total + 0.52
  if (/[^\u0000-\u024f]/.test(character)) return total + 1
  return total + 0.7
}, 0)
const accessFontSize = (value: string, baseMm: number, widthMm: number, minMm: number): number => {
  const text = String(value || '')
  if (!text) return baseMm
  let measuredWidthMm = 0
  try {
    const context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
    if (context) {
      context.font = `500 ${baseMm * 96 / 25.4}px Arial, "Microsoft YaHei", "PingFang SC", sans-serif`
      measuredWidthMm = context.measureText(text).width / (96 / 25.4)
    }
  } catch {
    measuredWidthMm = 0
  }
  const estimatedWidthMm = measuredWidthMm || accessTextUnits(text) * baseMm
  const safeWidthMm = Math.max(1, widthMm - 0.8)
  return Math.round(Math.max(minMm, Math.min(baseMm, baseMm * safeWidthMm / estimatedWidthMm)) * 100) / 100
}
const rowsFor = (asset: AssetRecord, settings: LabelSettings): LabelRow[] => [
  ...settings.fields.map((key, index) => ({ label: fieldLabels[key] || key, value: fieldValue(asset, key), fontSize: rowFontSize(settings, index) })),
  ...customFields(settings.customFields).map((field, index) => ({ label: field.label, value: customValue(asset, field.source), fontSize: rowFontSize(settings, settings.fields.length + index) }))
].filter((row) => row.value && row.value !== '-')

const scanTextFor = (asset: AssetRecord, settings: LabelSettings): string => {
  const rows = settings.scanFields.map((key) => `${fieldLabels[key] || key}:${fieldValue(asset, key)}`)
  customFields(settings.customFields).forEach((field) => rows.push(`${field.label}:${customValue(asset, field.source)}`))
  return rows.filter(Boolean).join('\n') || `资产编码:${displayAssetCode(asset)}`
}

const entries = computed<LabelEntry[]>(() => props.assets.map((asset) => {
  const scanText = scanTextFor(asset, normalizedSettings.value)
  return {
    asset,
    rows: rowsFor(asset, normalizedSettings.value),
    scanText,
    qr: createQrGraphic(scanText),
    accessQr: createQrGraphic(displayAssetCode(asset))
  }
}))
const perPage = computed(() => Math.max(1, normalizedSettings.value.columns * normalizedSettings.value.rows))
const pages = computed(() => {
  const chunks: LabelEntry[][] = []
  for (let index = 0; index < entries.value.length; index += perPage.value) chunks.push(entries.value.slice(index, index + perPage.value))
  return chunks
})
const countText = computed(() => `共 ${props.assets.length} 张 / ${Math.max(1, pages.value.length)} 页`)
const cssVars = computed<Record<string, string>>(() => {
  const settings = normalizedSettings.value
  const logoScale = settings.logoScale / 100
  const maxQr = Math.max(8, Math.min(settings.labelWidth - 4, settings.labelHeight - 4, 72))
  const printQr = Math.round(Math.min(settings.qrSize * 1.2, maxQr) * 10) / 10
  return {
    '--label-width': `${settings.labelWidth}mm`, '--label-height': `${settings.labelHeight}mm`,
    '--label-logo-width': `${settings.logoWidth * logoScale}mm`, '--label-logo-height': `${settings.logoHeight * logoScale}mm`,
    '--label-qr-size': `${settings.qrSize}mm`, '--label-print-qr-size': `${printQr}mm`, '--label-qr-text-gap': `${settings.qrTextGap}mm`,
    '--label-font-size': `${settings.fontSize}px`, '--label-content-scale': `${settings.contentScale / 100}`,
    '--label-offset-x': `${settings.offsetX}mm`, '--label-offset-y': `${settings.offsetY}mm`, '--label-columns': `${settings.columns}`,
    '--label-column-gap': `${settings.columnGap}mm`, '--label-row-gap': `${settings.rowGap}mm`,
    '--label-access-qr-size': `${Math.min(settings.qrSize, 24)}mm`
  }
})
const templateRows = (entry: LabelEntry, count: number): LabelRow[] => {
  const settings = normalizedSettings.value
  const keys = settings.fields.filter(Boolean).slice(0, count)
  const fallback = ['name', 'id', 'category'].slice(0, count)
  return (keys.length ? keys : fallback).map((key, index) => ({ label: fieldLabels[key] || key, value: fieldValue(entry.asset, key), fontSize: rowFontSize(settings, index) }))
}
</script>

<template>
  <div class="asset-label-print-workspace direct-label-print">
    <div class="asset-label-direct-actions">
      <button
        type="button"
        class="btn primary asset-label-direct-print-button"
        @click="emit('print', {
          labelWidth: normalizedSettings.labelWidth,
          labelHeight: normalizedSettings.labelHeight,
          columns: normalizedSettings.columns,
          rows: normalizedSettings.rows,
          columnGap: normalizedSettings.columnGap,
          rowGap: normalizedSettings.rowGap
        })"
      >打 印</button>
    </div>
    <div class="asset-label-preview-panel">
      <div class="asset-label-preview-scroll">
        <div class="asset-label-direct-count">{{ countText }}</div>
        <div class="asset-label-print-area">
          <section v-for="(page, pageIndex) in pages" :key="pageIndex" class="asset-label-sheet" :style="cssVars" :data-label-page="pageIndex + 1">
            <article v-for="entry in page" :key="entry.asset.id" class="asset-print-label template-print-label" :class="`is-${baseTemplateKey}-template`">
              <template v-if="baseTemplateKey === 'standard'">
                <span v-if="normalizedSettings.logoImage" class="template-print-logo has-image"><img :src="normalizedSettings.logoImage" :alt="normalizedSettings.logoText || 'Logo'"></span>
                <span v-else-if="normalizedSettings.showLogo" class="template-print-logo">{{ normalizedSettings.logoText || 'AM' }}</span>
                <div class="standard-template-print-content">
                  <div class="standard-template-print-qr"><svg class="asset-label-qr" :viewBox="entry.qr.viewBox" role="img" :aria-label="entry.qr.label"><rect width="100%" height="100%" fill="#fff"/><path :d="entry.qr.path" fill="#000"/></svg></div>
                  <div class="standard-template-print-fields"><span v-for="row in templateRows(entry, 3)" :key="row.label" :style="{ '--template-row-font-size': `${row.fontSize}px` }">{{ row.value }}</span></div>
                </div>
              </template>
              <template v-else-if="baseTemplateKey === 'compact'">
                <div class="compact-template-print-content">
                  <div class="compact-template-print-qr"><svg class="asset-label-qr" :viewBox="entry.qr.viewBox" role="img" :aria-label="entry.qr.label"><rect width="100%" height="100%" fill="#fff"/><path :d="entry.qr.path" fill="#000"/></svg></div>
                  <div class="compact-template-print-fields"><span v-for="row in templateRows(entry, 4)" :key="row.label" :style="{ '--template-row-font-size': `${row.fontSize}px` }">{{ row.value }}</span></div>
                </div>
              </template>
              <template v-else-if="baseTemplateKey === 'full'">
                <div class="full-template-print-body">
                  <div class="full-template-print-qr"><svg class="asset-label-qr" :viewBox="entry.qr.viewBox" role="img" :aria-label="entry.qr.label"><rect width="100%" height="100%" fill="#fff"/><path :d="entry.qr.path" fill="#000"/></svg></div>
                  <div class="full-template-print-fields"><span v-for="row in templateRows(entry, 2)" :key="row.label" :style="{ '--template-row-font-size': `${row.fontSize}px` }">{{ row.value }}</span></div>
                </div>
              </template>
              <template v-else-if="baseTemplateKey === 'access'">
                <div class="access-template-svg-print-content">
                  <img class="access-template-svg-art" :src="accessTemplateUrl" alt="">
                  <div class="access-template-svg-overlay">
                    <div class="access-template-svg-qr"><svg class="asset-label-qr" :viewBox="entry.accessQr.viewBox" role="img" :aria-label="entry.accessQr.label"><rect width="100%" height="100%" fill="#fff"/><path :d="entry.accessQr.path" fill="#000"/></svg></div>
                    <strong class="access-template-svg-code" :style="{ fontSize: `${accessFontSize(displayAssetCode(entry.asset), 4, 35.1, 2.4)}mm` }">{{ displayAssetCode(entry.asset) }}</strong>
                    <strong class="access-template-svg-name" :style="{ fontSize: `${accessFontSize(entry.asset.name || '-', 3.8, 35.1, 1.4)}mm` }">{{ entry.asset.name || '-' }}</strong>
                    <span class="access-template-svg-owner" :style="{ fontSize: `${accessFontSize(normalizedSettings.ownershipText || '', 3.3, 53.8, 2)}mm` }">{{ normalizedSettings.ownershipText }}</span>
                  </div>
                </div>
              </template>
              <div v-else class="asset-label-content">
                <div class="asset-label-main">
                  <header class="asset-label-header">
                    <span v-if="normalizedSettings.showLogo" class="asset-label-logo" :class="{ 'has-image': normalizedSettings.logoImage }"><img v-if="normalizedSettings.logoImage" :src="normalizedSettings.logoImage" :alt="normalizedSettings.logoText || 'Logo'"><template v-else>{{ normalizedSettings.logoText || 'AM' }}</template></span>
                    <strong>{{ displayAssetCode(entry.asset) }}</strong>
                  </header>
                  <div class="asset-label-name">{{ entry.asset.name || '-' }}</div>
                  <div class="asset-label-fields"><div v-for="row in entry.rows" :key="row.label" :style="{ '--label-row-font-size': `${row.fontSize}px` }"><span>{{ row.label }}</span><strong>{{ row.value }}</strong></div></div>
                </div>
                <aside class="asset-label-scan">
                  <svg class="asset-label-qr" :viewBox="entry.qr.viewBox" role="img" :aria-label="entry.qr.label"><rect width="100%" height="100%" fill="#fff"/><path :d="entry.qr.path" fill="#000"/></svg>
                  <small>{{ entry.scanText.split('\n').slice(0, 2).join(' / ') }}</small>
                </aside>
              </div>
            </article>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
