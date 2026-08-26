<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules, type TableInstance } from 'element-plus'
import { usePortalSession } from '../../../core/auth/portal-session'
import { useTerminalMode } from '../../../core/auth/terminal-mode'
import { searchDirectoryPeople } from '../api/assets.api'
import { buildManagedCatalogTree, flattenManagedCatalog, managedCatalogNames, type ManagedCatalogOption, type ManagedCatalogTreeOption } from '../composables/managedCatalog'
import type { AssetImportMode } from '../composables/parseAssetWorkbook'
import { useAssets } from '../composables/useAssets'
import { displayAssetCode, displayAssetStatus, type AssetCommand, type AssetDraft, type AssetImportRow, type AssetOperationRecord, type AssetRecord, type DirectoryPerson } from '../types/assets'
import { hasPortalPermission } from '../../../authz/permission-aliases'
import { matchesPinyinSearch } from '../../../shared/search/pinyin-search'
import type { AssetOrderPrintKind } from './AssetOrderPrintPreview.vue'
import type { RequestOperator } from '../../approvals/api/approvals.api'

const AssetLabelPrintPreview = defineAsyncComponent(() => import('./AssetLabelPrintPreview.vue'))
const AssetOrderPrintPreview = defineAsyncComponent(() => import('./AssetOrderPrintPreview.vue'))
const AssetDisposalCreateDrawer = defineAsyncComponent(() => import('../../disposals/components/AssetDisposalCreateDrawer.vue'))

type Mode = 'list' | 'inbound' | 'receive-return' | 'borrow-return' | 'handover'
type ColumnKey = 'id' | 'name' | 'category' | 'status' | 'owner' | 'department' | 'location' | 'brand' | 'model' | 'sn' | 'supplier' | 'price' | 'purchaseDate'
type ListColumnKey = 'status' | 'code' | 'name' | 'category' | 'brand' | 'model' | 'sn' | 'phone' | 'email' | 'date' | 'location' | 'price' | 'purchase' | 'rent' | 'supplier' | 'owner'
type HandoverDocumentColumnKey = 'status' | 'order' | 'operator' | 'receiver' | 'receiverCompany' | 'receiverDepartment' | 'date' | 'handoverType' | 'targetLocation' | 'note' | 'signer' | 'signatureImage' | 'actions'
type HandoverAssetColumnKey = 'assetImage' | 'assetId' | 'assetCategory' | 'assetName' | 'assetBrand' | 'assetModel' | 'assetSn' | 'assetOwnerCompany' | 'assetLocation' | 'handoverPerson' | 'handoverCompany' | 'handoverDepartment'
type HandoverColumnKey = HandoverDocumentColumnKey | HandoverAssetColumnKey
type HandoverColumnOption = { key: HandoverColumnKey; label: string; width: number; required?: boolean; defaultVisible?: boolean }
type TableDensity = 'compact' | 'standard' | 'roomy'
type ReceiveReturnTab = 'receive' | 'return' | 'employee' | 'handover'
type BorrowReturnTab = 'borrow' | 'return'
type AdvancedPanelTab = 'search' | 'columns'
type DateRange = [string, string] | null
type ActionForm = {
  action: AssetCommand
  assetIds: string[]
  person: string
  personSubject: string
  company: string
  department: string
  operator: string
  handoverType: 'personal' | 'public'
  location: string
  date: string
  expectedReturnDate: string
  expectedReturnDates: Record<string, string>
  note: string
}
type EditForm = {
  name: string
  category: string
  company: string
  department: string
  ownerCompany: string
  condition: string
  location: string
  custodian: string
  brand: string
  model: string
  price?: number
  purchaseDate: string
  purchaseMethod: string
  orderNo: string
  unit: string
  usageMonths: string
  rent?: number
  note: string
}
type ManagedOption = ManagedCatalogOption

const props = withDefaults(defineProps<{ mode?: Mode }>(), { mode: 'list' })
const router = useRouter()
const { state, assets, operations, business, store, load, loadAssets, loadOperations, loadStore, create, copy, importMany, replaceAll, command } = useAssets()
const { user } = usePortalSession()
const { isEmployeeTerminal } = useTerminalMode()
const query = ref('')
const status = ref('全部')
const category = ref('全部')
const page = ref(1)
const pageSize = ref(20)
const receiveReturnTab = ref<ReceiveReturnTab>(props.mode === 'handover' ? 'handover' : 'receive')
const borrowReturnTab = ref<BorrowReturnTab>('borrow')
const selected = ref<AssetRecord[]>([])
const detail = ref<AssetRecord | null>(null)
const createOpen = ref(false)
const actionOpen = ref(false)
const pickerOpen = ref(false)
const editOpen = ref(false)
const advancedOpen = ref(false)
const importOpen = ref(false)
const printOpen = ref(false)
const disposalOpen = ref(false)
const disposalPresetAssetIds = ref<string[]>([])
const orderPrintOpen = ref(false)
const orderPrintKind = ref<AssetOrderPrintKind>('inbound')
const orderPrintRows = ref<AssetRecord[]>([])
const labelPrintRows = ref<AssetRecord[]>([])
const authorizedAdministrators = ref<RequestOperator[]>([])
const authorizedAdministratorsLoading = ref(false)
let authorizedAdministratorsPending: Promise<void> | null = null
const submitting = ref(false)
const parsing = ref(false)
const createFormRef = ref<FormInstance>()
const pickerTableRef = ref<TableInstance>()
const copySourceId = ref('')
const editAction = ref<'edit' | 'batch-edit'>('edit')
const editIds = ref<string[]>([])
const importRows = ref<AssetImportRow[]>([])
const importFileName = ref('')
const importFileSize = ref('')
const importMode = ref<AssetImportMode>('asset')
const importFileInput = ref<HTMLInputElement>()
const importDragActive = ref(false)
const importTemplateLink = ref<HTMLAnchorElement>()
const importTemplateUrl = ref('')
const pickerAction = ref<AssetCommand>('receive')
const pickerSelection = ref<AssetRecord[]>([])
const exportLink = ref<HTMLAnchorElement>()
const exportUrl = ref('')
const actionSelectedIds = ref<string[]>([])

const viewClass = computed(() => {
  if (props.mode === 'list') return 'asset-list-page asset-directory-view'
  if (props.mode === 'inbound') return 'asset-list-page asset-inbound-ledger asset-directory-view'
  if (props.mode === 'borrow-return') return 'asset-list-page receive-return-ledger borrow-return-ledger asset-directory-view'
  if (props.mode === 'handover') return 'asset-list-page receive-return-ledger handover-ledger asset-directory-view'
  return 'asset-list-page receive-return-ledger asset-directory-view'
})
const isReceiveFlowMode = computed(() => props.mode === 'receive-return' || props.mode === 'handover')
const permissions = computed(() => new Set(user.value?.permissionCodes || []))
const employeeTerminalPermissions = new Set(['asset:item:view', 'asset:item:advancedSearch', 'asset:item:columnSettings'])
const can = (code: string): boolean => hasPortalPermission(permissions.value, code)
  && (!isEmployeeTerminal.value || employeeTerminalPermissions.has(code))
const actionPermission = (action: AssetCommand): string => ({
  receive: 'asset:item:receive',
  return: 'asset:item:return',
  borrow: 'asset:item:borrow',
  'borrow-return': 'asset:item:borrowReturn',
  handover: 'asset:item:handover'
} as Partial<Record<AssetCommand, string>>)[action] || ''
const canRunAction = (action: AssetCommand): boolean => Boolean(actionPermission(action)) && can(actionPermission(action))
const actionStatuses: Partial<Record<AssetCommand, string[]>> = {
  receive: ['空闲'],
  borrow: ['空闲'],
  return: ['领用'],
  'borrow-return': ['借用', '借用中'],
  handover: ['领用', '借用', '借用中']
}
const assetsAllowAction = (items: AssetRecord[], action: AssetCommand): boolean => {
  const allowed = actionStatuses[action]
  return !allowed || items.every((item) => allowed.includes(item.status))
}
const actionStatusWarning = (action: AssetCommand): string => ({
  receive: '领用只能选择空闲资产',
  borrow: '借用只能选择空闲资产',
  return: '退库只能选择领用资产',
  'borrow-return': '归还只能选择借用资产',
  handover: '交接只能选择领用或借用资产'
} as Partial<Record<AssetCommand, string>>)[action] || '所选资产当前状态不能执行此操作'
const canCreateRequest = computed(() => permissions.value.has('asset:request:create'))
const openEmployeeRequest = (): void => { void router.push('/requests') }

const columnOptions: Array<{ key: ColumnKey; label: string }> = [
  { key: 'id', label: '资产编码' }, { key: 'name', label: '资产名称' }, { key: 'category', label: '资产分类' },
  { key: 'status', label: '状态' }, { key: 'owner', label: '使用人' }, { key: 'department', label: '使用部门' },
  { key: 'location', label: '所在位置' }, { key: 'brand', label: '品牌' }, { key: 'model', label: '型号' },
  { key: 'sn', label: '序列号' }, { key: 'supplier', label: '供应商' }, { key: 'price', label: '金额' },
  { key: 'purchaseDate', label: '购置日期' }
]
const defaultColumns: ColumnKey[] = ['id', 'name', 'category', 'status', 'owner', 'department', 'location', 'model', 'sn']
const unassignedStatuses = new Set(['空闲', '闲置', '上架', '待验收'])
const hasCurrentUsage = (item: AssetRecord): boolean => !unassignedStatuses.has(item.status)
const storedColumns = localStorage.getItem(`asset-table-columns:${props.mode}`)
const parseStoredColumns = (): ColumnKey[] => {
  try {
    const value = storedColumns ? JSON.parse(storedColumns) as unknown : null
    return Array.isArray(value) ? value.filter((item): item is ColumnKey => columnOptions.some((column) => column.key === item)) : [...defaultColumns]
  } catch { return [...defaultColumns] }
}
const visibleColumns = ref<ColumnKey[]>(parseStoredColumns())
const hasColumn = (key: ColumnKey): boolean => visibleColumns.value.includes(key)
watch(visibleColumns, (value) => localStorage.setItem(`asset-table-columns:${props.mode}`, JSON.stringify(value)), { deep: true })

const listColumns: Array<{ key: ListColumnKey; label: string; width: number }> = [
  { key: 'status', label: '资产状态', width: 86 }, { key: 'code', label: '资产编码', width: 112 },
  { key: 'name', label: '资产名称', width: 118 }, { key: 'category', label: '资产分类', width: 92 },
  { key: 'brand', label: '品牌', width: 82 }, { key: 'model', label: '型号', width: 112 },
  { key: 'sn', label: '设备序列号', width: 126 },
  { key: 'phone', label: '手机号', width: 92 }, { key: 'email', label: '电子邮箱', width: 118 },
  { key: 'date', label: '领用日期', width: 90 }, { key: 'location', label: '所在位置', width: 92 },
  { key: 'price', label: '金额', width: 64 }, { key: 'purchase', label: '购置方式', width: 82 },
  { key: 'rent', label: '租金', width: 56 }, { key: 'supplier', label: '供应商', width: 104 },
  { key: 'owner', label: '使用人', width: 78 }
]
const listColumnKeys = listColumns.map((item) => item.key)
const parseListSettings = (): { columns: ListColumnKey[]; density: TableDensity } => {
  try {
    const value = JSON.parse(localStorage.getItem('assetListSettings') || '{}') as { visibleColumns?: unknown; density?: unknown }
    const columns = Array.isArray(value.visibleColumns)
      ? value.visibleColumns.filter((item): item is ListColumnKey => listColumnKeys.includes(item as ListColumnKey))
      : listColumnKeys
    const density = ['compact', 'standard', 'roomy'].includes(String(value.density)) ? value.density as TableDensity : 'compact'
    return { columns: columns.length ? columns : listColumnKeys, density }
  } catch { return { columns: listColumnKeys, density: 'compact' } }
}
const listSettings = parseListSettings()
const listVisibleColumns = ref<ListColumnKey[]>(listSettings.columns)
const listDensity = ref<TableDensity>(listSettings.density)
const listDisplayedColumns = computed(() => listColumns.filter((item) => listVisibleColumns.value.includes(item.key)))
const listTableMinWidth = computed(() => 36 + listDisplayedColumns.value.reduce((sum, item) => sum + item.width, 0))
const saveListSettings = (): void => localStorage.setItem('assetListSettings', JSON.stringify({
  visibleColumns: listVisibleColumns.value,
  density: listDensity.value,
  columnLayoutVersion: 'compact-v2',
  columnWidths: {}
}))
watch([listVisibleColumns, listDensity], saveListSettings, { deep: true })
const toggleListColumn = (key: ListColumnKey, checked: boolean): void => {
  const columns = new Set(listVisibleColumns.value)
  if (checked) columns.add(key)
  else if (columns.size > 1) columns.delete(key)
  listVisibleColumns.value = listColumnKeys.filter((item) => columns.has(item))
}
const resetListSettings = (): void => { listVisibleColumns.value = [...listColumnKeys]; listDensity.value = 'compact' }

const handoverDocumentColumns: HandoverColumnOption[] = [
  { key: 'status', label: '交接状态', width: 92, required: true, defaultVisible: true },
  { key: 'order', label: '交接单号', width: 180, required: true, defaultVisible: true },
  { key: 'operator', label: '经办人', width: 88, required: true, defaultVisible: true },
  { key: 'receiver', label: '接收人', width: 88, defaultVisible: true },
  { key: 'receiverCompany', label: '接收公司', width: 160, defaultVisible: true },
  { key: 'receiverDepartment', label: '接收部门', width: 120, defaultVisible: true },
  { key: 'date', label: '交接日期', width: 100, defaultVisible: true },
  { key: 'handoverType', label: '交接类型', width: 100, defaultVisible: true },
  { key: 'targetLocation', label: '交接后位置', width: 140, defaultVisible: true },
  { key: 'note', label: '交接备注', width: 140, defaultVisible: true },
  { key: 'signer', label: '签字人', width: 90, defaultVisible: true },
  { key: 'signatureImage', label: '签字图片', width: 90, defaultVisible: true },
  { key: 'actions', label: '操作', width: 100, required: true, defaultVisible: true }
]
const handoverAssetColumns: HandoverColumnOption[] = [
  { key: 'assetImage', label: '资产图片', width: 76, defaultVisible: true },
  { key: 'assetId', label: '资产编码', width: 110, defaultVisible: true },
  { key: 'assetCategory', label: '资产分类', width: 100, defaultVisible: true },
  { key: 'assetName', label: '资产名称', width: 140, defaultVisible: true },
  { key: 'assetBrand', label: '品牌', width: 90, defaultVisible: true },
  { key: 'assetModel', label: '型号', width: 140, defaultVisible: true },
  { key: 'assetSn', label: '设备序列号', width: 140, defaultVisible: true },
  { key: 'assetOwnerCompany', label: '所属/承租公司', width: 160, defaultVisible: true },
  { key: 'assetLocation', label: '所在位置', width: 140, defaultVisible: true },
  { key: 'handoverPerson', label: '交接人', width: 90 },
  { key: 'handoverCompany', label: '交接人公司', width: 150 },
  { key: 'handoverDepartment', label: '交接人部门', width: 120 }
]
const handoverColumns = [...handoverDocumentColumns, ...handoverAssetColumns]
const handoverColumnKeys = handoverColumns.map((item) => item.key)
const handoverRequiredColumnKeys = handoverColumns.filter((item) => item.required).map((item) => item.key)
const handoverDefaultColumnKeys = handoverColumns.filter((item) => item.defaultVisible || item.required).map((item) => item.key)
const parseHandoverColumns = (): HandoverColumnKey[] => {
  try {
    const stored = JSON.parse(localStorage.getItem('assetHandoverColumnSettingsV1') || 'null') as unknown
    const selected = Array.isArray(stored)
      ? stored.filter((item): item is HandoverColumnKey => handoverColumnKeys.includes(item as HandoverColumnKey))
      : handoverDefaultColumnKeys
    const normalized = new Set([...selected, ...handoverRequiredColumnKeys])
    return handoverColumnKeys.filter((item) => normalized.has(item))
  } catch { return [...handoverDefaultColumnKeys] }
}
const handoverVisibleColumns = ref<HandoverColumnKey[]>(parseHandoverColumns())
const handoverDisplayedColumns = computed(() => {
  const selected = new Set(handoverVisibleColumns.value)
  const documents = handoverDocumentColumns.filter((item) => item.key !== 'actions' && selected.has(item.key))
  const assets = handoverAssetColumns.filter((item) => selected.has(item.key))
  const actions = handoverDocumentColumns.filter((item) => item.key === 'actions' && selected.has(item.key))
  return [...documents, ...assets, ...actions]
})
const handoverTableMinWidth = computed(() => 36 + handoverDisplayedColumns.value.reduce((sum, item) => sum + item.width, 0))
const handoverDocumentVisibleCount = computed(() => handoverDocumentColumns.filter((item) => handoverVisibleColumns.value.includes(item.key)).length)
const handoverAssetVisibleCount = computed(() => handoverAssetColumns.filter((item) => handoverVisibleColumns.value.includes(item.key)).length)
watch(handoverVisibleColumns, (value) => localStorage.setItem('assetHandoverColumnSettingsV1', JSON.stringify(value)), { deep: true })
const toggleHandoverColumn = (key: HandoverColumnKey, checked: boolean): void => {
  if (handoverRequiredColumnKeys.includes(key)) return
  const selected = new Set(handoverVisibleColumns.value)
  if (checked) selected.add(key)
  else selected.delete(key)
  handoverVisibleColumns.value = handoverColumnKeys.filter((item) => selected.has(item))
}
const setHandoverColumnGroup = (columns: HandoverColumnOption[], checked: boolean): void => {
  const selected = new Set(handoverVisibleColumns.value)
  columns.forEach((item) => {
    if (checked || item.required) selected.add(item.key)
    else selected.delete(item.key)
  })
  handoverVisibleColumns.value = handoverColumnKeys.filter((item) => selected.has(item))
}
const resetHandoverColumnGroup = (columns: HandoverColumnOption[]): void => {
  const selected = new Set(handoverVisibleColumns.value)
  columns.forEach((item) => {
    if (item.defaultVisible || item.required) selected.add(item.key)
    else selected.delete(item.key)
  })
  handoverVisibleColumns.value = handoverColumnKeys.filter((item) => selected.has(item))
}

const categories = computed(() => Array.from(new Set(assets.value.map((item) => item.category).filter(Boolean))).sort())
const managedCategories = computed<ManagedOption[]>(() => {
  const configured = flattenManagedCatalog(store.value.assetCategoryTree || [], [], true)
  const values = configured.length ? configured : categories.value.map((value) => ({ value, label: value }))
  const selected = [String(createDraft.category || ''), String(editForm.category || '')].filter(Boolean)
  selected.forEach((value) => { if (!values.some((item) => item.value === value)) values.push({ value, label: value }) })
  return values
})
const managedLocations = computed<ManagedOption[]>(() => {
  const configured = flattenManagedCatalog(store.value.assetLocationTree || [])
  const fallback = Array.from(new Set(assets.value.map((item) => item.location).filter(Boolean))).sort().map((value) => ({ value, label: value }))
  const values = configured.length ? configured : fallback
  const selected = [String(createDraft.location || ''), editForm.location, actionForm.location].filter(Boolean)
  selected.forEach((value) => { if (!values.some((item) => item.value === value)) values.push({ value, label: value }) })
  return values
})
const treeContainsValue = (nodes: ManagedCatalogTreeOption[], value: string): boolean => nodes.some((node) => (
  node.value === value || treeContainsValue(node.children || [], value)
))
const includeSelectedTreeValues = (nodes: ManagedCatalogTreeOption[], values: string[]): ManagedCatalogTreeOption[] => {
  const result = [...nodes]
  values.filter(Boolean).forEach((value) => {
    if (!treeContainsValue(result, value)) result.push({ value, label: value })
  })
  return result
}
const managedCategoryTree = computed<ManagedCatalogTreeOption[]>(() => {
  const configured = buildManagedCatalogTree(store.value.assetCategoryTree || [], [], true)
  const fallback = categories.value.map((value) => ({ value, label: value }))
  return includeSelectedTreeValues(configured.length ? configured : fallback, [String(createDraft.category || ''), String(editForm.category || '')])
})
const managedLocationTree = computed<ManagedCatalogTreeOption[]>(() => {
  const configured = buildManagedCatalogTree(store.value.assetLocationTree || [])
  const fallback = Array.from(new Set(assets.value.map((item) => item.location).filter(Boolean))).sort().map((value) => ({ value, label: value }))
  return includeSelectedTreeValues(configured.length ? configured : fallback, [String(createDraft.location || ''), editForm.location])
})
const formCompanies = computed(() => Array.from(new Set([
  user.value?.company,
  ...assets.value.flatMap((item) => [item.company, String(item.ownerCompany || '')])
].filter(Boolean) as string[])))
const formDepartments = computed(() => Array.from(new Set([
  user.value?.department,
  ...assets.value.map((item) => item.department)
].filter(Boolean) as string[])))
const formAdministrators = computed(() => Array.from(new Set([
  ...authorizedAdministrators.value.map((item) => item.name),
  createDraft.custodian,
  editForm.custodian,
  ...(authorizedAdministrators.value.length ? [] : [user.value?.name])
].filter(Boolean) as string[])))
const assetConditions = ['正常', '全新', '良好', '维修中', '待验收']
const purchaseMethods = ['采购', '租赁', '自购', '调拨入库']
const uniqueStrings = (values: unknown[]): string[] => Array.from(new Set(values
  .map((value) => String(value || '').trim())
  .filter(Boolean)))
  .sort((left, right) => left.localeCompare(right, 'zh-CN'))
const assetAdvancedOptions = computed(() => ({
  statuses: uniqueStrings(assets.value.map((item) => item.status)),
  categories: uniqueStrings(assets.value.map((item) => item.category)),
  types: uniqueStrings(assets.value.map((item) => item.type)),
  departments: uniqueStrings(assets.value.map((item) => item.department)),
  locations: uniqueStrings([...managedLocations.value.map((item) => item.value), ...assets.value.map((item) => item.location)]),
  risks: uniqueStrings(assets.value.map((item) => item.risk)),
  tags: uniqueStrings(assets.value.flatMap((item) => item.tags || []))
}))
const defaultAssetAdvanced = () => ({ status: [] as string[], id: '', name: '', category: '', type: '', model: '', sn: '', owner: '', department: '', location: '', supplier: '', risk: '', tag: '' })
const defaultInboundAdvanced = () => ({ status: '', id: '', type: '', dateRange: null as DateRange, operator: '', purchaser: '', company: '' })
const defaultReceiveAdvanced = () => ({ status: '', id: '', dateRange: null as DateRange, handler: '', receiver: '', company: '', department: '', location: '', note: '', assetId: '', assetName: '', brand: '', model: '', sn: '', owner: '', manager: '', ownerCompany: '' })
const defaultBorrowAdvanced = () => ({ status: '', id: '', handler: '', borrower: '', borrowDateRange: null as DateRange, expectedReturnDateRange: null as DateRange, assetId: '', sn: '', company: '', department: '', employeeCode: '', phone: '', email: '', location: '' })
const assetAdvanced = reactive(defaultAssetAdvanced())
const assetAdvancedDraft = reactive(defaultAssetAdvanced())
const inboundAdvanced = reactive(defaultInboundAdvanced())
const inboundAdvancedDraft = reactive(defaultInboundAdvanced())
const receiveAdvanced = reactive(defaultReceiveAdvanced())
const receiveAdvancedDraft = reactive(defaultReceiveAdvanced())
const borrowAdvanced = reactive(defaultBorrowAdvanced())
const borrowAdvancedDraft = reactive(defaultBorrowAdvanced())
const searchable = (item: AssetRecord): unknown[] => [displayAssetCode(item), item.id, item.name, item.assetTag, item.owner, item.department, item.location, item.model, item.sn]
const contains = (value: unknown, expected: string): boolean => matchesPinyinSearch([value], expected)
const equals = (value: unknown, expected: string): boolean => !expected || String(value || '').trim() === expected.trim()
const matchesAny = (value: unknown, expected: readonly string[]): boolean => !expected.length || expected.includes(String(value || '').trim())
const dateInRange = (value: unknown, range: DateRange): boolean => {
  if (!range) return true
  const current = String(value || '')
  return Boolean(current) && (!range[0] || current >= range[0]) && (!range[1] || current <= range[1])
}

const filteredAssets = computed(() => {
  const keyword = query.value
  return assets.value.filter((item) => {
    const modeMatch = isReceiveFlowMode.value
      ? ['闲置', '空闲', '领用', '领用中'].includes(item.status)
      : props.mode === 'borrow-return'
        ? ['闲置', '空闲', '借用', '借用中'].includes(item.status)
        : true
    return modeMatch
      && matchesPinyinSearch(searchable(item), keyword)
      && (status.value === '全部' || item.status === status.value)
      && (category.value === '全部' || item.category === category.value)
      && matchesAny(item.status, assetAdvanced.status) && equals(item.category, assetAdvanced.category)
      && contains(displayAssetCode(item), assetAdvanced.id) && contains(item.name, assetAdvanced.name)
      && equals(item.type, assetAdvanced.type)
      && contains(item.model, assetAdvanced.model) && contains(item.sn, assetAdvanced.sn) && contains(item.owner, assetAdvanced.owner)
      && equals(item.department, assetAdvanced.department) && equals(item.location, assetAdvanced.location)
      && contains(item.supplier, assetAdvanced.supplier) && equals(item.risk, assetAdvanced.risk)
      && (!assetAdvanced.tag || (item.tags || []).some((tag) => equals(tag, assetAdvanced.tag)))
  })
})
const operationAsset = (record: AssetOperationRecord): AssetRecord => {
  const current = assets.value.find((item) => item.id === record.assetId)
  return {
    ...current,
    id: record.assetId,
    name: String(record.assetName || current?.name || '-'),
    status: String(record.status || current?.status || '-'),
    category: String(record.assetCategory || current?.category || '-'),
    type: current?.type || '设备',
    owner: String(record.party || current?.owner || '未分配'),
    ownerSubject: String(record.partySubject || current?.ownerSubject || ''),
    department: String(record.department || current?.department || ''),
    company: String(record.company || current?.company || current?.ownerCompany || ''),
    location: String(record.location || current?.location || ''),
    custodian: String(record.operator || current?.custodian || ''),
    model: String(record.assetModel || current?.model || ''),
    brand: String(record.assetBrand || current?.brand || ''),
    sn: String(record.assetSn || current?.sn || ''),
    assetTag: current?.assetTag || '',
    supplier: current?.supplier || '',
    price: Number(record.assetPrice || current?.price || 0),
    purchaseDate: current?.purchaseDate || '',
    warrantyDate: current?.warrantyDate || '',
    operationId: record.id,
    operationType: record.type,
    operationDate: formatOperationTime(record.createdAt || record.date),
    operationStatus: record.status || '-',
    purchaseMethod: record.sourceType || (String(current?.purchaseMethod || '').includes('导入') ? 'excel批量导入' : '新增资产'),
    createdDate: formatOperationTime(record.createdAt || record.date),
    operator: record.operator || '-',
    employeeCode: record.employeeCode || '-',
    expectedReturnDate: record.expectedReturnDate || current?.expectedReturnDate || '-',
    returnOrderId: record.returnOrderId || '',
    canSign: record.canSign === true,
    signedAt: record.signedAt || '',
    signer: record.signer || '',
    signatureImage: record.signatureImage || '',
    rejectionReason: record.rejectionReason || '',
    noticeContent: record.noticeContent || '',
    note: record.note || current?.note || '',
    handoverType: record.handoverType || '',
    previousParty: record.previousParty || '',
    previousCompany: record.previousCompany || '',
    previousDepartment: record.previousDepartment || '',
    previousLocation: record.previousLocation || '',
    assetOwnerCompany: record.assetOwnerCompany || current?.ownerCompany || current?.company || '',
    purchaser: record.purchaser || current?.purchaser || '',
    phone: record.phone || current?.phone || '',
    email: record.email || current?.email || '',
    ownerCompany: current?.ownerCompany || current?.company || record.company || '',
    assetCode: current?.assetCode || String(record.assetCode || record.legacyAssetCode || '')
  }
}
const operationRows = (type: AssetOperationRecord['type']): AssetRecord[] => operations.value
  .filter((record): record is AssetOperationRecord => Boolean(record && typeof record === 'object' && record.type === type))
  .map(operationAsset)
const matchesFlowQuery = (item: AssetRecord): boolean => {
  return matchesPinyinSearch([...searchable(item), item.operationId], query.value)
}
const matchesInboundFilters = (item: AssetRecord): boolean => matchesFlowQuery(item)
  && equals(item.operationStatus, inboundAdvanced.status)
  && contains(item.operationId, inboundAdvanced.id)
  && contains(item.purchaseMethod, inboundAdvanced.type)
  && dateInRange(item.operationDate, inboundAdvanced.dateRange)
  && contains(item.operator, inboundAdvanced.operator)
  && contains(item.purchaser, inboundAdvanced.purchaser)
  && contains(item.company, inboundAdvanced.company)
const matchesReceiveFilters = (item: AssetRecord): boolean => matchesFlowQuery(item)
  && equals(item.operationStatus || item.status, receiveAdvanced.status)
  && contains(item.operationId, receiveAdvanced.id)
  && dateInRange(item.operationDate, receiveAdvanced.dateRange)
  && contains(item.operator || item.custodian, receiveAdvanced.handler)
  && contains(item.owner, receiveAdvanced.receiver)
  && contains(item.company, receiveAdvanced.company)
  && contains(item.department, receiveAdvanced.department)
  && equals(item.location, receiveAdvanced.location)
  && contains(item.note, receiveAdvanced.note)
  && contains(displayAssetCode(item), receiveAdvanced.assetId)
  && contains(item.name, receiveAdvanced.assetName)
  && contains(item.brand, receiveAdvanced.brand)
  && contains(item.model, receiveAdvanced.model)
  && contains(item.sn, receiveAdvanced.sn)
  && contains(item.owner, receiveAdvanced.owner)
  && contains(item.custodian, receiveAdvanced.manager)
  && contains(item.ownerCompany || item.company, receiveAdvanced.ownerCompany)
const matchesBorrowFilters = (item: AssetRecord): boolean => matchesFlowQuery(item)
  && equals(item.operationStatus || item.status, borrowAdvanced.status)
  && contains(item.operationId, borrowAdvanced.id)
  && contains(item.operator || item.custodian, borrowAdvanced.handler)
  && contains(item.owner, borrowAdvanced.borrower)
  && dateInRange(item.operationDate, borrowAdvanced.borrowDateRange)
  && dateInRange(item.expectedReturnDate, borrowAdvanced.expectedReturnDateRange)
  && contains(displayAssetCode(item), borrowAdvanced.assetId)
  && contains(item.sn, borrowAdvanced.sn)
  && contains(item.company || item.ownerCompany, borrowAdvanced.company)
  && contains(item.department, borrowAdvanced.department)
  && contains(item.employeeCode, borrowAdvanced.employeeCode)
  && contains(item.phone, borrowAdvanced.phone)
  && contains(item.email, borrowAdvanced.email)
  && equals(item.location, borrowAdvanced.location)
const employeeRequestRows = computed<AssetRecord[]>(() => (Array.isArray(business.value.requests) ? business.value.requests : [])
  .filter((request) => request.type === '资产领用' && Array.isArray(request.assetIds))
  .flatMap((request) => (request.assetIds as string[]).flatMap((assetId) => {
    const asset = assets.value.find((item) => item.id === assetId)
    return asset ? [{ ...asset, status: String(request.status || '待处理'), operationId: request.id, operationDate: request.date || '-', custodian: String(request.decisionOperator || '-'), owner: String(request.applicant || '-'), requestId: request.id } as AssetRecord] : []
  })))
const receiveSourceRows = computed<AssetRecord[]>(() => {
  if (receiveReturnTab.value === 'receive') return operationRows('RECEIVE')
  if (receiveReturnTab.value === 'return') return operationRows('RETURN')
  if (receiveReturnTab.value === 'handover') return operationRows('HANDOVER')
  return employeeRequestRows.value
})
const borrowSourceRows = computed<AssetRecord[]>(() => borrowReturnTab.value === 'return'
  ? [...operationRows('BORROW').filter((item) => item.status === '待归还'), ...operationRows('BORROW_RETURN')]
  : operationRows('BORROW'))
const modeRows = computed<AssetRecord[]>(() => {
  if (props.mode === 'inbound') return operationRows('INBOUND').filter(matchesInboundFilters)
  if (isReceiveFlowMode.value) return receiveSourceRows.value.filter(matchesReceiveFilters)
  if (props.mode === 'borrow-return') return borrowSourceRows.value.filter(matchesBorrowFilters)
  return filteredAssets.value
})
const displayedRows = computed(() => modeRows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const pageCount = computed(() => Math.max(1, Math.ceil(modeRows.value.length / pageSize.value)))
const paginationItems = computed<Array<number | 'ellipsis'>>(() => {
  if (pageCount.value <= 7) return Array.from({ length: pageCount.value }, (_, index) => index + 1)
  const pages = Array.from(new Set([1, pageCount.value, page.value - 1, page.value, page.value + 1]))
    .filter((item) => item >= 1 && item <= pageCount.value).sort((left, right) => left - right)
  return pages.flatMap((item, index) => index && item - pages[index - 1] > 1 ? ['ellipsis' as const, item] : [item])
})
const jumpPage = ref<number | undefined>()
watch([query, status, category], () => { page.value = 1 })
watch([modeRows, pageSize], () => { page.value = Math.min(page.value, pageCount.value) })
watch([receiveReturnTab, borrowReturnTab], () => { page.value = 1; selected.value = [] })

const selectedIds = computed(() => new Set(selected.value.map((item) => item.id)))
const allPageSelected = computed(() => displayedRows.value.length > 0 && displayedRows.value.every((item) => selectedIds.value.has(item.id)))
const toggleAssetSelection = (item: AssetRecord, checked: boolean): void => {
  selected.value = checked
    ? [...selected.value.filter((row) => row.id !== item.id), item]
    : selected.value.filter((row) => row.id !== item.id)
}
const togglePageSelection = (checked: boolean): void => {
  const pageIds = new Set(displayedRows.value.map((item) => item.id))
  selected.value = checked
    ? [...selected.value.filter((item) => !pageIds.has(item.id)), ...displayedRows.value]
    : selected.value.filter((item) => !pageIds.has(item.id))
}
const goToJumpPage = (): void => {
  if (jumpPage.value === undefined) return
  page.value = Math.min(Math.max(Math.trunc(jumpPage.value), 1), pageCount.value)
  jumpPage.value = undefined
}

const assetStatusLabel = (value: unknown): string => {
  const status = String(value ?? '').trim()
  if (!status) return '-'
  return status === '借用中' ? '借用' : status
}

const listOwnerValue = (value: unknown): string => {
  const owner = String(value ?? '').trim()
  return owner && owner !== '未分配' ? owner : ''
}

const listCellValue = (item: AssetRecord, key: ListColumnKey): string | number => {
  if (key === 'code') return displayAssetCode(item)
  if (key === 'date') return String(item.receiveDate || '-')
  if (key === 'purchase') return String(item.purchaseMethod || '-')
  if (key === 'rent') return Number(item.rent || 0)
  if (key === 'status') return displayAssetStatus(item)
  if (key === 'owner') return listOwnerValue(item.owner)
  const value = item[key]
  return value === undefined || value === null || value === '' ? '-' : String(value)
}
const statusColorClass: Record<string, string> = {
  空闲: 'status-available',
  闲置: 'status-idle',
  上架: 'status-listed',
  待验收: 'status-pending-acceptance',
  领用: 'status-received',
  领用中: 'status-receive-in-progress',
  借用: 'status-borrowed',
  借用中: 'status-borrow-in-progress',
  维修中: 'status-maintenance',
  调拨中: 'status-transfer',
  审批中: 'status-approval',
  领用审批中: 'status-receive-approval',
  借用审批中: 'status-borrow-approval',
  交接审批中: 'status-handover-approval',
  退库审批中: 'status-return-approval',
  领用待签字: 'status-receive-signature',
  借用待签字: 'status-borrow-signature',
  交接待签字: 'status-handover-signature',
  流程中: 'status-workflow',
  退还中: 'status-returning',
  待归还: 'status-pending-return',
  已归还: 'status-returned',
  已入库: 'status-inbound',
  已取消: 'status-cancelled',
  处置中: 'status-disposal',
  已处置: 'status-disposed',
  已报废: 'status-scrapped'
}

const assetStatusClass = (value: unknown): string => {
  const status = String(value ?? '').trim()
  if (status.startsWith('状态待确认')) return 'status-unconfirmed'
  if (status.startsWith('已处置')) return 'status-disposed'
  const label = status.replace(/（.*$/, '').trim()
  return statusColorClass[label] || 'status-other'
}
function padTimePart(value: number): string { return String(value).padStart(2, '0') }
function isPreciseOperationTime(value: unknown): boolean {
  const text = String(value || '').trim()
  if (!text) return false
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) return true
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(text)
}
function isReliableOperationTime(value: unknown): boolean {
  if (!isPreciseOperationTime(value)) return false
  const text = String(value || '').trim().replace(' ', 'T')
  const parsed = new Date(text)
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now() + 5 * 60 * 1000
}
function formatOperationTime(value: unknown): string {
  const text = String(value || '').trim()
  if (!text) return '-'
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) return text
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(0, 7)
  if (/^\d{4}-\d{2}$/.test(text)) return text
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return text
  return `${parsed.getFullYear()}-${padTimePart(parsed.getMonth() + 1)}-${padTimePart(parsed.getDate())} ${padTimePart(parsed.getHours())}:${padTimePart(parsed.getMinutes())}`
}
function formatHistoricalOperationTime(value: unknown): string {
  if (isReliableOperationTime(value)) return formatOperationTime(value)
  const now = new Date()
  return `${now.getFullYear()}-${padTimePart(now.getMonth() + 1)}-${padTimePart(now.getDate())}`
}
function operationDate(item: AssetRecord): string { return formatOperationTime(item.operationDate || item.receiveDate || item.borrowDate || item.purchaseDate) }
const handoverCellValue = (item: AssetRecord, key: HandoverColumnKey): string => {
  const values: Partial<Record<HandoverColumnKey, unknown>> = {
    operator: item.operator || item.custodian,
    receiver: item.owner,
    receiverCompany: item.company,
    receiverDepartment: item.department,
    date: operationDate(item),
    handoverType: item.handoverType,
    targetLocation: item.location,
    note: item.note,
    signer: item.signer,
    assetId: item.id,
    assetCategory: item.category,
    assetName: item.name,
    assetBrand: item.brand,
    assetModel: item.model,
    assetSn: item.sn,
    assetOwnerCompany: item.assetOwnerCompany || item.ownerCompany,
    assetLocation: item.previousLocation || item.location,
    handoverPerson: item.previousParty,
    handoverCompany: item.previousCompany,
    handoverDepartment: item.previousDepartment
  }
  const value = values[key]
  return value === undefined || value === null || value === '' ? '-' : String(value)
}
const operationId = (item: AssetRecord, prefix: string): string => String(
  props.mode === 'borrow-return' && borrowReturnTab.value === 'return' && item.operationType === 'BORROW' && item.returnOrderId
    ? item.returnOrderId
    : item.operationId || item.inboundOrderId || `${prefix}-${item.id}`
)
const receiveAction = computed<AssetCommand>(() => receiveReturnTab.value === 'return' ? 'return' : receiveReturnTab.value === 'handover' ? 'handover' : 'receive')
const pickerCandidates = computed(() => assets.value.filter((item) => {
  if (pickerAction.value === 'receive' || pickerAction.value === 'borrow') return item.status === '空闲'
  if (pickerAction.value === 'return') return ['领用', '领用中'].includes(item.status)
  if (pickerAction.value === 'handover') return ['领用', '借用', '借用中', '交接待签字'].includes(item.status)
  if (pickerAction.value === 'borrow-return') return ['借用', '借用中'].includes(item.status)
  return false
}))
const confirmAssetPicker = (): void => {
  if (!pickerSelection.value.length) { ElMessage.warning('请至少选择一项资产'); return }
  pickerOpen.value = false
  actionForm.assetIds = pickerSelection.value.map((item) => item.id)
  if (actionForm.action === 'borrow') {
    const fallback = actionForm.expectedReturnDate || new Date().toISOString().slice(0, 10)
    actionForm.expectedReturnDates = Object.fromEntries(actionForm.assetIds.map((id) => [id, actionForm.expectedReturnDates[id] || fallback]))
  }
  actionSelectedIds.value = []
}

const workflowStatuses = ['待提交', '审批中', '审批通过', '审批驳回', '待确认', '执行中', '部分完成', '已完成', '已取消', '已撤销', '待签字']
const cloneDateRange = (range: DateRange): DateRange => range ? [...range] : null
const advancedDrawerSize = 'min(520px, 94vw)'
const advancedTab = ref<AdvancedPanelTab>('search')
const advancedDrawerTitle = computed(() => advancedTab.value === 'columns' ? '自定义列' : '高级搜索')
const receiveAdvancedLabels = computed(() => {
  if (receiveReturnTab.value === 'handover') return { status: '交接状态', order: '交接单号', date: '交接日期', person: '接收人', company: '接收公司', department: '接收部门', location: '接收后所在位置', note: '交接备注' }
  if (receiveReturnTab.value === 'return') return { status: '退库状态', order: '退库单号', date: '退库日期', person: '领用人', company: '原使用公司', department: '原使用部门', location: '退库后所在位置', note: '退库备注' }
  if (receiveReturnTab.value === 'employee') return { status: '申领状态', order: '申领单号', date: '申领日期', person: '申领人', company: '申领后使用公司', department: '申领后使用部门', location: '申领后所在位置', note: '申领备注' }
  return { status: '领用状态', order: '领用单号', date: '领用日期', person: '领用人', company: '领用后使用公司', department: '领用后使用部门', location: '领用后所在位置', note: '领用备注' }
})
const inboundColumnLabels = ['入库状态', '入库单号', '入库类型', '入库日期', '入库人', '采购人', '创建日期', '所属公司', '入库备注', '操作']
const receiveColumnLabels = computed(() => receiveReturnTab.value === 'handover'
  ? ['交接状态', '交接单号', '经办人', '接收人', '接收公司', '接收部门', '操作']
  : ['状态', '单号', '日期', '经办人', '领用人', '工号', '位置', '所属公司', '资产编码', '操作'])
const borrowColumnLabels = ['借用状态', '借用单号', '经办人', '借用人', '借用日期', '借用人公司', '借用人部门', '工号', '手机号', '邮箱', '借用后位置', '签字人', '签字图片', '借用备注', '资产编码', '资产分类', '资产名称', '品牌', '型号', '设备序列号', '操作']
const allListColumnsSelected = computed(() => listVisibleColumns.value.length === listColumnKeys.length)
const updateAdvancedDateRange = (range: DateRange, index: 0 | 1, value: string): DateRange => {
  const next: [string, string] = [range?.[0] || '', range?.[1] || '']
  next[index] = value
  return next[0] || next[1] ? next : null
}
const syncAdvancedDraft = (): void => {
  if (props.mode === 'list') Object.assign(assetAdvancedDraft, assetAdvanced, { status: [...assetAdvanced.status] })
  else if (props.mode === 'inbound') Object.assign(inboundAdvancedDraft, inboundAdvanced, { dateRange: cloneDateRange(inboundAdvanced.dateRange) })
  else if (isReceiveFlowMode.value) Object.assign(receiveAdvancedDraft, receiveAdvanced, { dateRange: cloneDateRange(receiveAdvanced.dateRange) })
  else Object.assign(borrowAdvancedDraft, borrowAdvanced, { borrowDateRange: cloneDateRange(borrowAdvanced.borrowDateRange), expectedReturnDateRange: cloneDateRange(borrowAdvanced.expectedReturnDateRange) })
}
const openAdvancedSearch = (): void => {
  advancedTab.value = 'search'
  syncAdvancedDraft()
  advancedOpen.value = true
}
const openAdvancedColumns = (): void => {
  advancedTab.value = 'columns'
  advancedOpen.value = true
}
const selectAdvancedTab = (tab: AdvancedPanelTab): void => {
  advancedTab.value = tab
  if (tab === 'search') syncAdvancedDraft()
}
const setAllListColumns = (checked: boolean): void => {
  if (checked) listVisibleColumns.value = [...listColumnKeys]
  else listVisibleColumns.value = [listColumnKeys[0]]
}
const applyAdvanced = (): void => {
  if (props.mode === 'list') Object.assign(assetAdvanced, assetAdvancedDraft, { status: [...assetAdvancedDraft.status] })
  else if (props.mode === 'inbound') Object.assign(inboundAdvanced, inboundAdvancedDraft, { dateRange: cloneDateRange(inboundAdvancedDraft.dateRange) })
  else if (isReceiveFlowMode.value) Object.assign(receiveAdvanced, receiveAdvancedDraft, { dateRange: cloneDateRange(receiveAdvancedDraft.dateRange) })
  else Object.assign(borrowAdvanced, borrowAdvancedDraft, { borrowDateRange: cloneDateRange(borrowAdvancedDraft.borrowDateRange), expectedReturnDateRange: cloneDateRange(borrowAdvancedDraft.expectedReturnDateRange) })
  advancedOpen.value = false
  page.value = 1
}
const clearAdvanced = (): void => {
  if (props.mode === 'list') { Object.assign(assetAdvanced, defaultAssetAdvanced()); Object.assign(assetAdvancedDraft, defaultAssetAdvanced()) }
  else if (props.mode === 'inbound') { Object.assign(inboundAdvanced, defaultInboundAdvanced()); Object.assign(inboundAdvancedDraft, defaultInboundAdvanced()) }
  else if (isReceiveFlowMode.value) { Object.assign(receiveAdvanced, defaultReceiveAdvanced()); Object.assign(receiveAdvancedDraft, defaultReceiveAdvanced()) }
  else { Object.assign(borrowAdvanced, defaultBorrowAdvanced()); Object.assign(borrowAdvancedDraft, defaultBorrowAdvanced()) }
  page.value = 1
  advancedOpen.value = false
}

const returnToAssetList = async (): Promise<void> => {
  if (props.mode !== 'list') return

  // AssetListPage is cached. Clear its local view state before returning so a
  // completed operation never leaves the operator in a previous person's view.
  query.value = ''
  status.value = '全部'
  category.value = '全部'
  Object.assign(assetAdvanced, defaultAssetAdvanced())
  Object.assign(assetAdvancedDraft, defaultAssetAdvanced())
  page.value = 1
  jumpPage.value = undefined
  selected.value = []
  detail.value = null
  advancedOpen.value = false

  await router.replace('/assets')
}

const createDraft = reactive<AssetDraft>({
  name: '', category: '', type: '', status: '空闲', location: '', company: '', department: '', owner: '', ownerSubject: '',
  custodian: '', brand: '', model: '', sn: '', assetTag: '', supplier: '', purchaseDate: new Date().toISOString().slice(0, 10)
})
const createRules: FormRules = {
  name: [{ required: true, message: '请输入资产名称', trigger: 'blur' }],
  category: [{ required: true, message: '请选择资产分类', trigger: 'change' }],
  company: [{ required: true, message: '请选择使用公司', trigger: 'change' }],
  custodian: [{ required: true, message: '请选择管理员', trigger: 'change' }],
  brand: [{ required: true, message: '请输入品牌', trigger: 'blur' }],
  ownerCompany: [{ required: true, message: '请选择所属/承租公司', trigger: 'change' }],
  condition: [{ required: true, message: '请选择资产状况', trigger: 'change' }],
  location: [{ required: true, message: '请选择所在位置', trigger: 'change' }],
  purchaseDate: [{ required: true, message: '请选择购置/起租日期', trigger: 'change' }],
  purchaseMethod: [{ required: true, message: '请选择购置方式', trigger: 'change' }]
}
const emptyDraft = (): AssetDraft => ({
  id: '', name: '', category: '', type: '', status: '空闲', location: '', company: user.value?.company || '',
  department: '', owner: '', ownerSubject: '', ownerCompany: user.value?.company || '',
  custodian: user.value?.name || '', brand: '', model: '', sn: '', assetTag: '', supplier: '', price: undefined,
  purchaseDate: new Date().toISOString().slice(0, 10), receiveDate: new Date().toISOString().slice(0, 10),
  purchaseMethod: '', condition: '', usageMonths: '', orderNo: '', unit: '台', rent: undefined, note: ''
})
const loadAuthorizedAdministrators = async (): Promise<void> => {
  if (authorizedAdministrators.value.length) return
  if (authorizedAdministratorsPending) return authorizedAdministratorsPending
  authorizedAdministratorsPending = (async () => {
    authorizedAdministratorsLoading.value = true
    try {
      const { fetchRequestOperators } = await import('../../approvals/api/approvals.api')
      authorizedAdministrators.value = await fetchRequestOperators()
    } catch (error) {
      authorizedAdministrators.value = []
      console.error('[asset-portal] Unable to load ECP asset administrators', error)
    } finally {
      authorizedAdministratorsLoading.value = false
      authorizedAdministratorsPending = null
    }
  })()
  return authorizedAdministratorsPending
}
const openCreate = (source?: AssetRecord): void => {
  void loadAuthorizedAdministrators()
  copySourceId.value = source?.id || ''
  Object.assign(createDraft, source ? {
    ...emptyDraft(), ...source, id: '', name: `${source.name} - 副本`, owner: source.owner === '未分配' ? '' : source.owner,
    ownerCompany: source.ownerCompany || source.company || user.value?.company || '', condition: source.condition || '正常',
    assetTag: '', sn: ''
  } : emptyDraft())
  createOpen.value = true
}
const applyCategoryDefaults = (category: string, target: AssetDraft | EditForm): void => {
  const option = managedCategories.value.find((item) => item.value === category)
  if (!option) return
  if (!target.unit && option.unit) target.unit = option.unit
  if (!target.usageMonths && option.usefulLife) target.usageMonths = option.usefulLife
}
const directorySearch = async (keyword: string, callback: (values: Array<DirectoryPerson & { value: string }>) => void): Promise<void> => {
  const query = keyword.trim()
  if (!query) {
    callback([])
    return
  }
  try {
    const matches = await searchDirectoryPeople(query)
    callback(matches.map((item) => ({ ...item, value: `${item.name} · ${item.account || item.email}` })))
  } catch { callback([]) }
}
const selectCreatePerson = (person: DirectoryPerson): void => {
  createDraft.owner = person.name
  createDraft.ownerSubject = person.subject
  createDraft.company = person.company || createDraft.company
  createDraft.department = person.department || ''
}
const clearCreatePersonIdentity = (): void => {
  createDraft.ownerSubject = ''
  createDraft.department = ''
}
const submitCreate = async (): Promise<void> => {
  if (!await createFormRef.value?.validate().catch(() => false)) return
  const ownerSelected = Boolean(createDraft.ownerSubject)
  const payload: AssetDraft = {
    ...createDraft,
    type: createDraft.category,
    owner: ownerSelected ? String(createDraft.owner || '') : '未分配',
    status: createDraft.condition === '维修中' ? '维修中' : ownerSelected ? '领用' : '空闲',
    receiveDate: ownerSelected ? createDraft.receiveDate : ''
  }
  if (!String(payload.id || '').trim()) delete payload.id
  submitting.value = true
  try {
    if (copySourceId.value) await copy(copySourceId.value, payload)
    else await create(payload)
    createOpen.value = false
    ElMessage.success(copySourceId.value ? '资产已复制' : '资产已新增')
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '保存资产失败') }
  finally { submitting.value = false }
}

const actionForm = reactive<ActionForm>({
  action: 'receive', assetIds: [], person: '', personSubject: '', company: '', department: '', operator: '',
  handoverType: 'personal', location: '', date: new Date().toISOString().slice(0, 10), expectedReturnDate: '', expectedReturnDates: {}, note: ''
})
const actionLabels: Partial<Record<AssetCommand, string>> = { receive: '领用', return: '退库', borrow: '借用', 'borrow-return': '归还', handover: '交接', delete: '删除', edit: '编辑', 'batch-edit': '批量修改', 'cancel-inbound': '撤销入库', 'repair-start': '报修', 'repair-complete': '完成维修', 'update-import': '更新导入', 'receive-import': '领用导入' }
const actionLabel = (action: AssetCommand): string => actionLabels[action] || action
const actionDialogTitle = computed(() => ({
  receive: '新增领用单', return: '新增退库单', borrow: '新增借用单', 'borrow-return': '新增归还单', handover: '新增交接单',
  'cancel-inbound': '取消入库'
} as Partial<Record<AssetCommand, string>>)[actionForm.action] || `${actionLabel(actionForm.action)}资产`)
const actionLocationPlaceholder = computed(() => ({
  receive: '请选择领用后位置',
  return: '请选择退库后位置',
  borrow: '请选择借用后位置',
  'borrow-return': '请选择归还后位置',
  handover: '请选择接收位置'
} as Partial<Record<AssetCommand, string>>)[actionForm.action] || '请选择位置')
const actionAssets = computed(() => actionForm.assetIds.map((id) => assets.value.find((item) => item.id === id)).filter((item): item is AssetRecord => Boolean(item)))
const selectedActionAssetIds = computed(() => actionForm.assetIds.filter((id) => actionSelectedIds.value.includes(id)))
const allActionAssetsSelected = computed(() => actionAssets.value.length > 0 && actionAssets.value.every((item) => actionSelectedIds.value.includes(item.id)))
const canSubmitAction = computed(() => actionForm.action === 'cancel-inbound' || selectedActionAssetIds.value.length > 0)
const needsPerson = computed(() => actionForm.action === 'receive' || actionForm.action === 'borrow' || (actionForm.action === 'handover' && actionForm.handoverType === 'personal'))
const initializeActionForm = (items: AssetRecord[], action: AssetCommand): void => {
  const first = items[0]
  const clearsDepartment = action === 'receive' || action === 'borrow' || action === 'handover'
  const clearsUsage = action === 'return' || action === 'borrow-return'
  Object.assign(actionForm, {
    action, assetIds: items.map((item) => item.id), person: '', personSubject: '',
    company: clearsUsage ? '' : first?.company || user.value?.company || '',
    department: clearsDepartment || clearsUsage ? '' : first?.department || '',
    operator: user.value?.name || '', handoverType: 'personal', location: first?.location || '',
    date: new Date().toISOString().slice(0, 10), expectedReturnDate: action === 'borrow' ? new Date().toISOString().slice(0, 10) : '',
    expectedReturnDates: action === 'borrow' ? Object.fromEntries(items.map((item) => [item.id, new Date().toISOString().slice(0, 10)])) : {}, note: ''
  })
  actionSelectedIds.value = []
  actionOpen.value = true
}
const openActionForIds = (items: AssetRecord[], action: AssetCommand): void => {
  if (!items.length) { ElMessage.warning('请先选择资产'); return }
  if (!assetsAllowAction(items, action)) { ElMessage.warning(actionStatusWarning(action)); return }
  initializeActionForm(items, action)
}
const openBlankAction = (action: AssetCommand): void => initializeActionForm([], action)
const openAction = (item: AssetRecord, action: AssetCommand): void => openActionForIds([item], action)
const personSearch = directorySearch
const selectPerson = (person: DirectoryPerson): void => {
  actionForm.person = person.name
  actionForm.personSubject = person.subject
  actionForm.company = person.company || actionForm.company
  actionForm.department = person.department || ''
}
const clearActionPersonIdentity = (): void => {
  actionForm.personSubject = ''
  if (actionForm.action === 'receive' || actionForm.action === 'borrow' || (actionForm.action === 'handover' && actionForm.handoverType === 'personal')) {
    actionForm.department = ''
  }
}
const reopenActionPicker = (): void => {
  pickerAction.value = actionForm.action
  pickerSelection.value = [...actionAssets.value]
  pickerOpen.value = true
  void nextTick(() => {
    pickerTableRef.value?.clearSelection()
    actionAssets.value.forEach((item) => pickerTableRef.value?.toggleRowSelection(item, true))
  })
}
const removeActionAssets = (): void => {
  const removed = new Set(actionSelectedIds.value)
  actionForm.assetIds = actionForm.assetIds.filter((id) => !removed.has(id))
  actionSelectedIds.value = []
}
const toggleAllActionAssets = (checked: boolean): void => { actionSelectedIds.value = checked ? [...actionForm.assetIds] : [] }
const submitAction = async (): Promise<void> => {
  if (!actionForm.assetIds.length) { ElMessage.warning('请先选择资产'); return }
  const assetIds = actionForm.action === 'cancel-inbound' ? actionForm.assetIds : selectedActionAssetIds.value
  if (!assetIds.length) { ElMessage.warning('请勾选至少一项资产'); return }
  if (needsPerson.value && !actionForm.personSubject) { ElMessage.warning('请搜索并选择 ECP 人员'); return }
  if (actionForm.action !== 'cancel-inbound' && !actionForm.location) { ElMessage.warning('请选择资产位置'); return }
  if (actionForm.action === 'borrow' && assetIds.some((id) => !actionForm.expectedReturnDates[id])) { ElMessage.warning('请填写资产明细中的预计归还日期'); return }
  submitting.value = true
  try {
    const fields: Record<string, unknown> = {
      location: actionForm.location, date: actionForm.date, note: actionForm.note,
      operator: actionForm.operator
    }
    if (actionForm.action === 'receive') Object.assign(fields, { receiver: actionForm.person, receiverSubject: actionForm.personSubject, company: actionForm.company, department: actionForm.department })
    if (actionForm.action === 'borrow') Object.assign(fields, { borrower: actionForm.person, borrowerSubject: actionForm.personSubject, company: actionForm.company, department: actionForm.department, expectedReturnDate: actionForm.expectedReturnDate, expectedReturnDates: actionForm.expectedReturnDates })
    if (actionForm.action === 'handover') Object.assign(fields, {
      receiver: actionForm.handoverType === 'personal' ? actionForm.person : '公共区域',
      receiverSubject: actionForm.handoverType === 'personal' ? actionForm.personSubject : '',
      handoverType: actionForm.handoverType === 'personal' ? '员工交接' : '公共交接',
      company: actionForm.company, department: actionForm.department
    })
    await command(actionForm.action, assetIds, fields)
    actionOpen.value = false
    selected.value = []
    await returnToAssetList()
    ElMessage.success(`${actionLabel(actionForm.action)}操作已完成`)
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '资产操作失败') }
  finally { submitting.value = false }
}

const emptyEditForm = (): EditForm => ({
  name: '', category: '', company: '', department: '', ownerCompany: '', condition: '', location: '', custodian: '', brand: '', model: '',
  price: undefined, purchaseDate: '', purchaseMethod: '', orderNo: '', unit: '', usageMonths: '', rent: undefined, note: ''
})
const editForm = reactive<EditForm>(emptyEditForm())
const editSource = computed(() => assets.value.find((item) => item.id === editIds.value[0]))
const openEdit = (items: AssetRecord[], batch = false): void => {
  if (!items.length) { ElMessage.warning('请先选择资产'); return }
  void loadAuthorizedAdministrators()
  editAction.value = batch ? 'batch-edit' : 'edit'
  editIds.value = items.map((item) => item.id)
  const source = items[0]
  Object.assign(editForm, batch ? emptyEditForm() : {
    ...emptyEditForm(), ...source, ownerCompany: source.ownerCompany || source.company || '', condition: source.condition || source.status || ''
  })
  editOpen.value = true
}
const submitEdit = async (): Promise<void> => {
  const allowedBatchFields = new Set(['company', 'department', 'condition', 'location', 'purchaseMethod', 'note'])
  const entries = Object.entries(editForm).filter(([key, value]) =>
    (editAction.value === 'edit' ? key !== 'condition' : allowedBatchFields.has(key)) && (editAction.value === 'edit' || value !== '' && value !== null && value !== undefined)
  )
  if (editAction.value === 'edit' && (!editForm.name || !editForm.category || !editForm.custodian || !editForm.brand || !editForm.ownerCompany || !editForm.location || !editForm.purchaseDate || !editForm.purchaseMethod)) {
    ElMessage.warning('请完整填写必填的资产信息')
    return
  }
  if (editAction.value === 'batch-edit' && !entries.length) { ElMessage.warning('请至少填写一个修改字段'); return }
  submitting.value = true
  try {
    const fields = Object.fromEntries(entries)
    if (editAction.value === 'edit') fields.type = editForm.category
    else fields.date = new Date().toISOString().slice(0, 10)
    await command(editAction.value, editIds.value, fields)
    editOpen.value = false
    selected.value = []
    await returnToAssetList()
    ElMessage.success(editAction.value === 'edit' ? '资产已更新' : '批量修改已完成')
  }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '修改资产失败') }
  finally { submitting.value = false }
}
const removeAssets = async (items: AssetRecord[]): Promise<void> => {
  if (!items.length) { ElMessage.warning('请先选择资产'); return }
  await ElMessageBox.confirm(`确定删除选中的 ${items.length} 项资产吗？仅空闲资产可删除。`, '删除资产', { type: 'warning' })
  try { await command('delete', items.map((item) => item.id), {}); selected.value = []; ElMessage.success('资产已删除') }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '删除资产失败') }
}

const validImportRows = computed(() => importRows.value.filter((row) => row.draft).map((row) => row.draft as AssetDraft))
const invalidImportCount = computed(() => importRows.value.filter((row) => row.errors.length).length)
const importTitle = computed(() => ({ asset: '资产导入', update: '更新导入', receive: '批量领用导入', replace: '全量替换资产' })[importMode.value])
const importTemplateName = computed(() => ({ asset: '资产导入模板.xlsx', update: '资产更新模板.xls', receive: '批量领用模板.xls', replace: '完整资产清单.xlsx' })[importMode.value])
const escapeSpreadsheetXml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const downloadImportTemplate = async (): Promise<void> => {
  if (importMode.value === 'asset' || importMode.value === 'replace') return
  const columns = importMode.value === 'update'
    ? ['资产编码*', '资产名称', '资产分类', '品牌', '型号', '金额', '购置方式', '租金', '管理员', '资产状况', '订单号', '计量单位', '所属/承租公司', '购置/起租日期', '领用日期', '所在位置', '使用公司', '使用部门', '使用人', 'ECP人员Subject', '备注']
    : ['资产编码*', '领用人', 'ECP人员Subject*', '领用日期*', '领用后位置*', '领用备注']
  const instructions = importMode.value === 'update'
    ? ['必填项；按资产编码匹配，其余空白字段不修改', ...columns.slice(1).map(() => '')]
    : ['必填项', '', '必填项；填写 ECP unionId subject', '必填项；YYYY-MM-DD', '必填项；填写位置完整路径', '']
  const row = (values: string[]) => `<Row>${values.map((value) => `<Cell><Data ss:Type="String">${escapeSpreadsheetXml(value)}</Data></Cell>`).join('')}</Row>`
  const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${importMode.value === 'update' ? '资产更新' : '批量领用'}"><Table>${row(columns)}${row(instructions)}</Table></Worksheet></Workbook>`
  importTemplateUrl.value = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' }))
  await nextTick()
  importTemplateLink.value?.click()
  window.setTimeout(() => { URL.revokeObjectURL(importTemplateUrl.value); importTemplateUrl.value = '' }, 0)
}
const openImport = (mode: AssetImportMode): void => {
  importMode.value = mode
  importRows.value = []
  importFileName.value = ''
  importFileSize.value = ''
  importOpen.value = true
}
const validateImportRows = async (rows: AssetImportRow[]): Promise<AssetImportRow[]> => {
  const configuredCategoryNames = managedCatalogNames(store.value.assetCategoryTree || [])
  // Imports may use configured parent categories; keep validation aligned with the full tree.
  const knownCategories = new Set(configuredCategoryNames.length
    ? configuredCategoryNames
    : importMode.value === 'replace' ? [] : categories.value)
  const knownLocations = new Set(managedLocations.value.map((item) => item.value))
  const knownAssets = new Map(assets.value.map((item) => [item.id, item]))
  const seen = new Set<string>()
  const validated: AssetImportRow[] = []
  for (const row of rows) {
    if (!row.draft) { validated.push(row); continue }
    const draft = row.draft
    const errors = [...row.errors]
    const id = String(draft.id || '').trim()
    if (id && seen.has(id)) errors.push(`资产编码“${id}”重复`)
    if (id) seen.add(id)
    if (importMode.value === 'asset' && id && knownAssets.has(id)) errors.push(`资产编码“${id}”已存在`)
    if (['update', 'receive'].includes(importMode.value) && !knownAssets.has(id)) errors.push(`资产编码“${id}”不存在或不在当前数据范围`)
    if (draft.category && knownCategories.size && !knownCategories.has(draft.category)) errors.push(`资产分类“${draft.category}”不存在`)
    if (draft.location && knownLocations.size && !knownLocations.has(draft.location)) errors.push(`所在位置“${draft.location}”不存在`)
    if (importMode.value === 'receive' && id && knownAssets.has(id) && knownAssets.get(id)?.status !== '空闲') errors.push(`资产“${id}”不是空闲状态，不能领用`)
    if (importMode.value === 'replace' && draft.status && !['领用', '空闲', '领用审批中', '交接审批中', '交接待签字', '借用', '退库审批中'].includes(String(draft.status))) {
      errors.push(`资产状态“${draft.status}”不受支持`)
    }
    if (importMode.value === 'asset' && draft.owner && draft.owner !== '未分配' && !draft.ownerSubject) {
      const matches = (await searchDirectoryPeople(String(draft.owner))).filter((person) => person.name === draft.owner)
      if (matches.length !== 1) errors.push(`使用人“${draft.owner}”无法唯一匹配 ECP 账号目录`)
      else Object.assign(draft, { ownerSubject: matches[0].subject, owner: matches[0].name, company: matches[0].company || draft.company, department: matches[0].department || draft.department })
    }
    validated.push(errors.length ? { ...row, draft: null, errors } : row)
  }
  return validated
}
const formatImportFileSize = (size: number): string => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`
const handleImportFile = async (file?: File): Promise<void> => {
  if (!file) return
  parsing.value = true; importFileName.value = file.name; importFileSize.value = formatImportFileSize(file.size); importRows.value = []
  try {
    const { parseAssetWorkbook } = await import('../composables/parseAssetWorkbook')
    importRows.value = await validateImportRows(await parseAssetWorkbook(file, importMode.value))
  }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '工作簿解析失败') }
  finally { parsing.value = false }
}
const readImportFile = (event: Event): void => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  void handleImportFile(file)
}
const dropImportFile = (event: DragEvent): void => {
  importDragActive.value = false
  void handleImportFile(event.dataTransfer?.files?.[0])
}
const submitImport = async (): Promise<void> => {
  if (!validImportRows.value.length) { ElMessage.warning('没有可导入的数据'); return }
  if (importMode.value === 'replace' && invalidImportCount.value) {
    ElMessage.warning('导入文件仍有错误，请修正后重新上传')
    return
  }
  submitting.value = true
  try {
    if (importMode.value === 'replace') {
      await ElMessageBox.confirm(`将用文件中的 ${validImportRows.value.length} 条资产建立新的资产基础库，并清空当前交接、签收、审批及其他业务历史。此操作不可恢复，是否继续？`, '全量替换资产', { type: 'warning', confirmButtonText: '确认替换' })
      const count = await replaceAll(validImportRows.value)
      importOpen.value = false
      selected.value = []
      ElMessage.success(`资产基础库已重置，共 ${count} 条新资产`)
      return
    }
    if (importMode.value === 'asset') {
      const count = await importMany(validImportRows.value)
      importOpen.value = false
      ElMessage.success(`已导入 ${count} 条资产`)
      return
    }
    const ids = validImportRows.value.map((item) => String(item.id || '').trim())
    if (new Set(ids).size !== ids.length) throw new Error('导入文件中存在重复的资产编码')
    const operations: Record<string, Record<string, unknown>> = {}
    if (importMode.value === 'update') {
      validImportRows.value.forEach((item) => {
        const id = String(item.id || '').trim()
        operations[id] = Object.fromEntries(Object.entries(item).filter(([field, value]) => field !== 'id' && value !== '' && value !== undefined && value !== null))
        operations[id].date = new Date().toISOString().slice(0, 10)
      })
      await command('update-import', ids, { operations })
    } else {
      await Promise.all(validImportRows.value.map(async (item) => {
        const id = String(item.id || '').trim()
        const owner = String(item.owner || '').trim()
        let ownerSubject = String(item.ownerSubject || '').trim()
        let matched: DirectoryPerson | undefined
        if (!ownerSubject) {
          const matches = (await searchDirectoryPeople(owner)).filter((person) => person.name === owner)
          if (matches.length !== 1) throw new Error(`领用人“${owner}”无法唯一匹配 ECP 账号目录`)
          matched = matches[0]
          ownerSubject = matched.subject
        }
        operations[id] = {
          receiver: matched?.name || owner || '待服务端解析', receiverSubject: ownerSubject,
          company: matched?.company || item.company || '', department: matched?.department || item.department || '',
          location: item.location, date: item.receiveDate, note: item.note || ''
        }
      }))
      await command('receive-import', ids, { operations })
    }
    selected.value = []
    importOpen.value = false
    ElMessage.success(`${importTitle.value}完成，共处理 ${ids.length} 条资产`)
  }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '资产导入失败') }
  finally { submitting.value = false }
}

const csvCell = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`
const exportAssets = async (): Promise<void> => {
  const rows = selected.value.length ? selected.value : filteredAssets.value
  if (!rows.length) { ElMessage.warning('没有可导出的资产'); return }
  const columns = props.mode === 'list' ? listDisplayedColumns.value : columnOptions.filter((item) => hasColumn(item.key))
  const csv = `\uFEFF${columns.map((item) => csvCell(item.label)).join(',')}\n${rows.map((row) => columns.map((item) => csvCell(props.mode === 'list' ? listCellValue(row, item.key as ListColumnKey) : row[item.key])).join(',')).join('\n')}`
  exportUrl.value = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  await nextTick(); exportLink.value?.click(); window.setTimeout(() => { URL.revokeObjectURL(exportUrl.value); exportUrl.value = '' }, 0)
  ElMessage.success(`已导出 ${rows.length} 条资产`)
}
const printSettings = computed(() => store.value.assetLabelPrintSettingsV2 || {})
const printTemplates = computed(() => store.value.assetLabelCustomTemplatesV1 || [])
const openPrint = (rows: AssetRecord[] = selected.value): void => {
  if (!rows.length) { ElMessage.warning('请选择打印资产'); return }
  void loadStore()
  labelPrintRows.value = [...rows]
  printOpen.value = true
}
const printableRows = (): AssetRecord[] => selected.value.length ? selected.value : displayedRows.value
const orderPrintTitles: Record<AssetOrderPrintKind, string> = {
  inbound: '打印入库单', receive: '打印领用单', return: '打印领用退库单', employee: '打印员工申领单', handover: '打印交接单'
}
const orderPrintEmptyNouns: Record<AssetOrderPrintKind, string> = {
  inbound: '入库单', receive: '领用信息', return: '退库信息', employee: '员工申领信息', handover: '交接信息'
}
const orderPrintTitle = computed(() => orderPrintTitles[orderPrintKind.value])
const labelPrintTitle = computed(() => props.mode === 'inbound' ? '打印资产标签' : '打印标签')
const openOrderPrint = (kind: AssetOrderPrintKind): void => {
  const rows = printableRows()
  if (!rows.length) { ElMessage.warning(`暂无可打印的${orderPrintEmptyNouns[kind]}`); return }
  orderPrintKind.value = kind
  orderPrintRows.value = [...rows]
  orderPrintOpen.value = true
}
const flowOrderPrintKind = computed<AssetOrderPrintKind>(() => receiveReturnTab.value === 'return'
  ? 'return'
  : receiveReturnTab.value === 'employee' ? 'employee' : receiveReturnTab.value === 'handover' ? 'handover' : 'receive')
const notifyBorrowPrint = (): void => { ElMessage.success('已生成借用归还单打印预览') }
const printNow = (): void => {
  const settings = printSettings.value as Record<string, unknown>
  const numberSetting = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback
  }
  const labelWidth = numberSetting(settings.labelWidth, 40, 20, 160)
  const labelHeight = numberSetting(settings.labelHeight, 30, 12, 120)
  const columns = Math.round(numberSetting(settings.columns, 1, 1, 8))
  const rows = Math.round(numberSetting(settings.rows, 1, 1, 14))
  const columnGap = numberSetting(settings.columnGap, 0, 0, 30)
  const rowGap = numberSetting(settings.rowGap, 0, 0, 30)
  const pageWidth = labelWidth * columns + columnGap * Math.max(0, columns - 1)
  const pageHeight = labelHeight * rows + rowGap * Math.max(0, rows - 1)
  document.getElementById('asset-label-print-page-size')?.remove()
  const pageStyle = document.createElement('style')
  pageStyle.id = 'asset-label-print-page-size'
  pageStyle.textContent = `@media print { @page { size: ${pageWidth}mm ${pageHeight}mm; margin: 0; } }`
  document.head.appendChild(pageStyle)
  const cleanup = (): void => {
    document.body.classList.remove('printing-asset-labels')
    pageStyle.remove()
  }
  document.body.classList.add('printing-asset-labels')
  window.addEventListener('afterprint', cleanup, { once: true })
  window.print()
  window.setTimeout(cleanup, 1000)
}
const printOrderNow = (): void => window.print()

const detailText = (value: unknown): string => String(value ?? '').trim() || '-'
const operationTypeForLifecycle = (action: string): AssetOperationRecord['type'] | '' => {
  if (action.includes('入库') || action.includes('清单替换')) return 'INBOUND'
  if (action.includes('退库')) return 'RETURN'
  if (action.includes('借用归还')) return 'BORROW_RETURN'
  if (action.includes('借用')) return 'BORROW'
  if (action.includes('交接')) return 'HANDOVER'
  if (action.includes('领用') || action.includes('签收')) return 'RECEIVE'
  return ''
}
const operationTimestampForLifecycle = (record: AssetOperationRecord, action: string): string => {
  const eventTime = action.includes('打回')
    ? record.rejectedAt
    : action.includes('取消') || action.includes('终止')
      ? record.cancelledAt
      : action.includes('签收') || action.includes('签字')
        ? record.signedAt
        : undefined
  return formatHistoricalOperationTime(isReliableOperationTime(eventTime) ? eventTime : record.createdAt || eventTime)
}
type DetailOperationRow = {
  time: string
  operator: string
  channel: string
  action: string
  content: string
  precise: boolean
  order: number
}
const operationActionLabel = (record: AssetOperationRecord): string => {
  const labels: Record<AssetOperationRecord['type'], string> = {
    INBOUND: '资产入库',
    RECEIVE: '资产领用',
    RETURN: '资产退库',
    BORROW: '资产借用',
    BORROW_RETURN: '借用归还',
    HANDOVER: '资产交接'
  }
  return labels[record.type] || record.type
}
const detailValue = (value: unknown): string => {
  const text = String(value ?? '').trim()
  return text && text !== '-' ? text : ''
}
const operationContent = (item: AssetRecord, record: AssetOperationRecord | undefined,
                          action: string, description: unknown): string => {
  const base = detailValue(description)
  if (base) return base
  const name = detailValue(record?.assetName || item.name) || '该资产'
  const operator = detailValue(record?.operator || item.custodian) || '系统'
  const party = detailValue(record?.party || item.owner)
  if (action.includes('退库')) return `${operator} 办理 ${name} 退库`
  if (action.includes('归还')) return `${operator} 办理 ${name} 归还`
  if (action.includes('借用')) return `${party || operator} 借用 ${name}`
  if (action.includes('交接')) return `${name} 交接至 ${party || '接收人'}`
  if (action.includes('领用')) return `${party || operator} 领用 ${name}`
  if (action.includes('入库')) return `通过资产系统录入 ${name}`
  return `${action}：${name}`
}
const detailOperationRows = (item: AssetRecord): DetailOperationRow[] => {
  const history = item.lifecycle?.length
    ? item.lifecycle
    : [[item.purchaseDate || '', '资产入库', '资产进入资产台账']]
  const candidates = operations.value
    .filter((record) => record.assetId === item.id)
    .sort((left, right) => String(left.createdAt || left.date).localeCompare(String(right.createdAt || right.date)))
  const used = new Set<string>()
  const rows: DetailOperationRow[] = history.map(([time, action, description], index) => {
    const legacyDate = /^\d{4}-\d{2}-\d{2}$/.test(String(time || '').trim())
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(time || '').trim())) {
      const type = operationTypeForLifecycle(action)
      const candidate = type
        ? candidates.find((record) => !used.has(record.id) && record.type === type && (!record.date || record.date === time))
          || candidates.find((record) => !used.has(record.id) && record.type === type)
        : undefined
      if (candidate) {
        used.add(candidate.id)
        return {
          time: operationTimestampForLifecycle(candidate, action),
          operator: detailValue(candidate.operator) || detailValue(item.custodian) || '-',
          channel: detailValue(candidate.sourceType) || '网页',
          action,
          content: operationContent(item, candidate, action, description),
          precise: isReliableOperationTime(candidate.createdAt) || isReliableOperationTime(candidate.signedAt)
            || isReliableOperationTime(candidate.cancelledAt) || isReliableOperationTime(candidate.rejectedAt),
          order: index
        }
      }
    }
    return {
      time: formatHistoricalOperationTime(time),
      operator: detailValue(item.custodian) || '-',
      channel: '网页',
      action,
      content: operationContent(item, undefined, action, description),
      precise: !legacyDate && isReliableOperationTime(time),
      order: index
    }
  })
  candidates.forEach((record) => {
    if (used.has(record.id)) return
    const action = operationActionLabel(record)
    rows.push({
      time: operationTimestampForLifecycle(record, action),
      operator: detailValue(record.operator) || detailValue(item.custodian) || '-',
      channel: detailValue(record.sourceType) || '网页',
      action,
      content: operationContent(item, record, action, ''),
      precise: true,
      order: history.length + rows.length
    })
  })
  return rows.sort((left, right) => {
    if (left.precise !== right.precise) return left.precise ? -1 : 1
    if (left.precise) return right.time.localeCompare(left.time)
    return right.order - left.order
  })
}
const terminateReceipt = async (item: AssetRecord): Promise<void> => {
  try {
    const isHandover = item.operationType === 'HANDOVER'
    await ElMessageBox.confirm(isHandover ? '撤回后资产将恢复到发起交接前的状态，是否继续？' : '终止后资产将恢复到发起签收前的状态，是否继续？', isHandover ? '撤回交接单' : '终止待签收单', { type: 'warning' })
    await command(isHandover ? 'handover-cancel' : 'receipt-cancel', [item.id], {
      date: new Date().toISOString().slice(0, 10),
      operationId: item.operationId
    })
    ElMessage.success(isHandover ? '交接单已撤回' : '待签收单已终止')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '终止失败')
  }
}
const disposeSelected = (): void => {
  if (!selected.value.length) { ElMessage.warning('请先选择空闲资产'); return }
  if (selected.value.some((item) => item.status !== '空闲')) { ElMessage.warning('仅空闲资产可以发起处置'); return }
  disposalPresetAssetIds.value = selected.value.map((item) => item.id)
  disposalOpen.value = true
}
const handleAssetDisposalCreated = (): void => { selected.value = [] }
onMounted(() => {
  if (props.mode === 'list') void Promise.all([loadAssets(), loadOperations()])
  else void load()
})
</script>

<template>
  <section :class="viewClass">
    <template v-if="mode === 'list'">
      <div class="asset-list-toolbar">
        <div class="asset-list-actions">
          <button v-if="isEmployeeTerminal && canCreateRequest" class="table-action primary" type="button" @click="openEmployeeRequest">发起领用申请</button>
          <template v-else>
          <button v-if="can('asset:item:create')" class="table-action primary" type="button" @click="openCreate()">＋ 新增</button>
          <el-dropdown placement="bottom-start" trigger="click">
            <button class="table-action has-caret" type="button">操作<span class="action-caret" aria-hidden="true"></span></button>
            <template #dropdown><el-dropdown-menu>
              <el-dropdown-item v-if="can('asset:item:receive')" :disabled="selected.length > 0 && !assetsAllowAction(selected, 'receive')" @click="openActionForIds(selected, 'receive')">领用</el-dropdown-item>
              <el-dropdown-item v-if="can('asset:item:borrow')" :disabled="selected.length > 0 && !assetsAllowAction(selected, 'borrow')" @click="openActionForIds(selected, 'borrow')">借用</el-dropdown-item>
              <el-dropdown-item v-if="can('asset:item:return')" :disabled="selected.length > 0 && !assetsAllowAction(selected, 'return')" @click="openActionForIds(selected, 'return')">领用退还</el-dropdown-item>
              <el-dropdown-item v-if="can('asset:item:borrowReturn')" :disabled="selected.length > 0 && !assetsAllowAction(selected, 'borrow-return')" @click="openActionForIds(selected, 'borrow-return')">借用归还</el-dropdown-item>
              <el-dropdown-item v-if="can('asset:item:handover')" :disabled="selected.length > 0 && !assetsAllowAction(selected, 'handover')" @click="openActionForIds(selected, 'handover')">资产交接</el-dropdown-item>
              <el-dropdown-item v-if="can('asset:disposal:create')" :disabled="!selected.length || selected.some((item) => item.status !== '空闲')" @click="disposeSelected">处置</el-dropdown-item>
            </el-dropdown-menu></template>
          </el-dropdown>
          <el-dropdown placement="bottom-start" trigger="click">
            <button class="table-action has-caret" type="button">编辑<span class="action-caret" aria-hidden="true"></span></button>
            <template #dropdown><el-dropdown-menu>
              <el-dropdown-item v-if="can('asset:item:update')" @click="openEdit(selected)">修改</el-dropdown-item>
              <el-dropdown-item v-if="can('asset:item:delete')" @click="removeAssets(selected)">删除</el-dropdown-item>
              <el-dropdown-item v-if="can('asset:item:copy')" @click="selected[0] ? openCreate(selected[0]) : ElMessage.warning('请先选择资产')">复制资产</el-dropdown-item>
              <el-dropdown-item v-if="can('asset:item:batchUpdate')" @click="openEdit(selected, true)">批量修改</el-dropdown-item>
            </el-dropdown-menu></template>
          </el-dropdown>
          <el-dropdown placement="bottom-start" trigger="click">
            <button class="table-action has-caret" type="button">导入/导出<span class="action-caret" aria-hidden="true"></span></button>
            <template #dropdown><el-dropdown-menu>
              <el-dropdown-item v-if="can('asset:item:assetImport')" @click="openImport('asset')">资产导入</el-dropdown-item>
              <el-dropdown-item v-if="can('asset:item:updateImport')" @click="openImport('update')">更新导入</el-dropdown-item>
              <el-dropdown-item v-if="can('asset:item:receiveImport')" @click="openImport('receive')">批量领用导入</el-dropdown-item>
              <el-dropdown-item v-if="can('asset:item:assetImport')" divided @click="openImport('replace')">全量替换资产</el-dropdown-item>
              <el-dropdown-item v-if="can('asset:item:export')" @click="exportAssets">导出资产</el-dropdown-item>
            </el-dropdown-menu></template>
          </el-dropdown>
          <button v-if="can('asset:item:printLabel')" class="table-action" type="button" @click="openPrint()">打印标签</button>
          <a v-if="exportUrl" ref="exportLink" :href="exportUrl" :download="`资产列表_${new Date().toISOString().slice(0, 10)}.csv`" hidden>下载</a>
          </template>
        </div>
        <div class="asset-list-search">
          <input v-model="query" class="local-search" type="search" placeholder="搜索" autocomplete="off" aria-label="搜索资产">
          <button class="table-action primary" type="button" aria-label="查询资产" @click="page = 1">⌕</button>
        </div>
      </div>

      <el-alert v-if="state.errorMessage" :title="state.errorMessage" type="error" show-icon :closable="false" />
      <div v-loading="state.loading" class="asset-table-shell" :class="`density-${listDensity}`">
        <div class="asset-table-actions">
          <button v-if="can('asset:item:advancedSearch')" class="link" type="button" @click="openAdvancedSearch">高级搜索</button>
          <button v-if="can('asset:item:columnSettings')" class="list-settings-button" type="button" title="列表设置" aria-label="列表设置" @click="openAdvancedColumns">⚙</button>
        </div>
        <div class="asset-table-scroll">
          <table v-resizable-columns="'assets:list'" class="asset-list-table" :style="{ minWidth: `${listTableMinWidth}px` }">
            <colgroup><col style="width: 36px"><col v-for="column in listDisplayedColumns" :key="column.key" :style="{ width: `${column.width}px` }"></colgroup>
            <thead><tr><th class="asset-list-select-cell"><input type="checkbox" aria-label="全选" :checked="allPageSelected" :disabled="!displayedRows.length" @change="togglePageSelection(($event.target as HTMLInputElement).checked)"></th><th v-for="column in listDisplayedColumns" :key="column.key" :data-column-key="column.key">{{ column.label }}</th></tr></thead>
            <tbody>
              <tr v-for="item in displayedRows" :key="item.id">
                <td class="asset-list-select-cell"><input type="checkbox" :aria-label="`选择${item.id}`" :checked="selectedIds.has(item.id)" @change="toggleAssetSelection(item, ($event.target as HTMLInputElement).checked)"></td>
                <td v-for="column in listDisplayedColumns" :key="column.key">
                  <span v-if="column.key === 'status'" class="asset-status-pill" :class="assetStatusClass(displayAssetStatus(item))">{{ displayAssetStatus(item) }}</span>
                  <button v-else-if="column.key === 'code'" class="link asset-code-text" type="button" @click="detail = item">{{ displayAssetCode(item) }}</button>
                  <template v-else>{{ listCellValue(item, column.key) }}</template>
                </td>
              </tr>
              <tr v-if="!displayedRows.length" class="empty-row"><td :colspan="listDisplayedColumns.length + 1">{{ query ? '没有匹配的资产结果。' : '当前账号下暂无资产。' }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="asset-list-pagination">
        <span>共 {{ modeRows.length }} 条</span>
        <button class="page-btn" type="button" aria-label="上一页" :disabled="page <= 1" @click="page--">‹</button>
        <template v-for="(item, index) in paginationItems" :key="`${item}-${index}`"><span v-if="item === 'ellipsis'" class="page-ellipsis">…</span><button v-else class="page-btn" :class="{ active: item === page }" type="button" :aria-current="item === page ? 'page' : undefined" @click="page = item">{{ item }}</button></template>
        <button class="page-btn" type="button" aria-label="下一页" :disabled="page >= pageCount" @click="page++">›</button>
        <el-select v-model="pageSize" class="asset-page-size-select" aria-label="每页条数" placement="top-start" :fallback-placements="['top-start']" popper-class="portal-upward-select-popper"><el-option label="20 条/页" :value="20" /><el-option label="50 条/页" :value="50" /></el-select>
        <span>跳至</span><input v-model.number="jumpPage" aria-label="跳转页码" inputmode="numeric" @keydown.enter="goToJumpPage"><span>页</span>
      </div>
    </template>

    <template v-else-if="mode === 'inbound'">
      <div class="asset-list-toolbar asset-inbound-toolbar">
        <div class="asset-list-actions">
          <el-dropdown placement="bottom-start" trigger="click"><button class="table-action primary has-caret" type="button">新增<span class="action-caret" aria-hidden="true"></span></button><template #dropdown><el-dropdown-menu><el-dropdown-item v-if="can('asset:item:create')" @click="openCreate()">新增资产</el-dropdown-item><el-dropdown-item v-if="can('asset:item:assetImport')" @click="openImport('asset')">批量导入</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
          <el-dropdown placement="bottom-start" trigger="click"><button class="table-action has-caret" type="button">打印<span class="action-caret" aria-hidden="true"></span></button><template #dropdown><el-dropdown-menu><el-dropdown-item @click="openOrderPrint('inbound')">打印入库单</el-dropdown-item><el-dropdown-item @click="openPrint(printableRows())">打印资产标签</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
          <button v-if="can('asset:item:export')" class="table-action inbound-export" type="button" @click="exportAssets">⇱ 导出</button>
        </div>
        <div class="asset-list-search inbound-search"><input v-model="query" class="local-search" type="search" placeholder="模糊查询" autocomplete="off"><button class="table-action primary" type="button" aria-label="搜索" @click="page = 1">⌕</button></div>
      </div>
      <el-alert v-if="state.errorMessage" :title="state.errorMessage" type="error" show-icon :closable="false" />
      <div v-loading="state.loading" class="asset-table-shell inbound-table-shell">
        <div class="asset-table-actions inbound-table-actions"><button v-if="can('asset:item:advancedSearch')" class="link" type="button" @click="openAdvancedSearch">高级搜索</button><button class="list-settings-button" type="button" title="列表设置" aria-label="列表设置" @click="openAdvancedColumns">⚙</button></div>
        <div class="asset-table-scroll inbound-table-scroll"><table v-resizable-columns="'assets:inbound'" class="asset-list-table inbound-order-table" style="min-width: 1080px"><thead><tr><th class="inbound-select-cell"><input type="checkbox" aria-label="全选入库单" :checked="allPageSelected" :disabled="!displayedRows.length" @change="togglePageSelection(($event.target as HTMLInputElement).checked)"></th><th>入库状态</th><th>入库单号</th><th>入库类型</th><th>入库日期</th><th>入库人</th><th>采购人</th><th>创建日期</th><th>所属公司</th><th>入库备注</th><th>操作</th></tr></thead><tbody>
          <tr v-for="item in displayedRows" :key="operationId(item, 'RK')"><td class="inbound-select-cell"><input type="checkbox" :aria-label="`选择${operationId(item, 'RK')}`" :checked="selectedIds.has(item.id)" @change="toggleAssetSelection(item, ($event.target as HTMLInputElement).checked)"></td><td><span class="inbound-status-pill" :class="assetStatusClass(item.status)">{{ assetStatusLabel(item.status || '已入库') }}</span></td><td><button class="link inbound-order-link" type="button" @click="detail = item">{{ operationId(item, 'RK') }}</button></td><td>{{ item.purchaseMethod || '新增资产' }}</td><td>{{ operationDate(item) }}</td><td>{{ item.custodian || '-' }}</td><td>{{ item.purchaser || '-' }}</td><td>{{ item.createdDate || operationDate(item) }}</td><td>{{ item.ownerCompany || item.company || '-' }}</td><td>{{ item.note || '-' }}</td><td><button v-if="can('asset:inbound:cancel') && item.status !== '已取消'" class="link inbound-cancel-link" type="button" @click="openAction(item, 'cancel-inbound')">取消入库</button><span v-else class="muted-text">已取消</span></td></tr>
          <tr v-if="!displayedRows.length" class="empty-row"><td colspan="11">{{ query ? '没有匹配的入库单。' : '暂无入库单，点击新增录入资产。' }}</td></tr>
        </tbody></table></div>
      </div>
    </template>

    <template v-else-if="isReceiveFlowMode">
      <div v-if="mode === 'receive-return'" class="receive-return-tabs"><button v-for="tab in ([['receive','领用'],['return','退库'],['employee','员工申领']] as const)" :key="tab[0]" class="receive-return-tab" :class="{ active: receiveReturnTab === tab[0] }" type="button" @click="receiveReturnTab = tab[0]">{{ tab[1] }}</button></div>
      <div class="asset-list-toolbar receive-return-toolbar"><div class="asset-list-actions"><button v-if="receiveReturnTab !== 'employee' && canRunAction(receiveAction)" class="table-action primary" type="button" @click="openBlankAction(receiveAction)">＋ 新增</button><el-dropdown placement="bottom-start" trigger="click"><button class="table-action has-caret" type="button">打印<span class="action-caret" aria-hidden="true"></span></button><template #dropdown><el-dropdown-menu><el-dropdown-item @click="openOrderPrint(flowOrderPrintKind)">打印{{ receiveReturnTab === 'handover' ? '交接单' : receiveReturnTab === 'employee' ? '员工申领单' : receiveReturnTab === 'return' ? '领用退库单' : '领用单' }}</el-dropdown-item></el-dropdown-menu></template></el-dropdown><button v-if="can('asset:item:export')" class="table-action receive-return-export" type="button" @click="exportAssets">⇱ 导出</button></div><div class="asset-list-search receive-return-search"><input v-model="query" class="local-search" type="search" placeholder="模糊查询" autocomplete="off"><button class="table-action primary" type="button" aria-label="搜索" @click="page = 1">⌕</button></div></div>
      <div v-loading="state.loading" class="asset-table-shell receive-return-table-shell">
        <div class="asset-table-actions receive-return-table-actions"><button v-if="can('asset:item:advancedSearch')" class="link" type="button" @click="openAdvancedSearch">高级搜索</button><button class="list-settings-button" type="button" title="列表设置" aria-label="列表设置" @click="openAdvancedColumns">⚙</button></div>
        <div class="asset-table-scroll receive-return-table-scroll">
          <table v-if="receiveReturnTab === 'handover'" v-resizable-columns="'assets:handover:custom-v1'" class="asset-list-table receive-return-table handover-custom-table" :style="{ minWidth: `${handoverTableMinWidth}px` }">
            <thead><tr><th class="receive-return-select-cell"><input type="checkbox" aria-label="全选交接单" :checked="allPageSelected" :disabled="!displayedRows.length" @change="togglePageSelection(($event.target as HTMLInputElement).checked)"></th><th v-for="column in handoverDisplayedColumns" :key="column.key" :data-column-key="column.key" :style="{ width: `${column.width}px` }">{{ column.label }}</th></tr></thead>
            <tbody>
              <tr v-for="item in displayedRows" :key="operationId(item, 'JJ')">
                <td class="receive-return-select-cell"><input type="checkbox" :aria-label="`选择${operationId(item, 'JJ')}`" :checked="selectedIds.has(item.id)" @change="toggleAssetSelection(item, ($event.target as HTMLInputElement).checked)"></td>
                <td v-for="column in handoverDisplayedColumns" :key="column.key">
                  <span v-if="column.key === 'status'" class="receive-return-status-pill" :class="assetStatusClass(item.status)">{{ assetStatusLabel(item.status) }}</span>
                  <button v-else-if="column.key === 'order'" class="link receive-return-order-link" type="button" @click="detail = item">{{ operationId(item, 'JJ') }}</button>
                  <template v-else-if="column.key === 'assetImage'"><img v-if="item.image" class="handover-table-image" :src="String(item.image)" :alt="item.name"><span v-else>-</span></template>
                  <template v-else-if="column.key === 'signatureImage'"><button v-if="item.signatureImage" class="link receive-return-action-link" type="button" @click="detail = item">查看</button><span v-else>-</span></template>
                  <template v-else-if="column.key === 'actions'"><button class="link receive-return-action-link" type="button" @click="detail = item">查看</button><button v-if="item.operationStatus === '待签字' && can('asset:receive_return:cancel')" class="link receive-return-action-link" type="button" @click="terminateReceipt(item)">撤回</button></template>
                  <span v-else-if="column.key === 'assetId'" class="asset-code-text">{{ handoverCellValue(item, column.key) }}</span>
                  <template v-else>{{ handoverCellValue(item, column.key) }}</template>
                </td>
              </tr>
              <tr v-if="!displayedRows.length" class="empty-row"><td :colspan="handoverDisplayedColumns.length + 1">{{ query ? '没有匹配的交接记录。' : '暂无交接记录。' }}</td></tr>
            </tbody>
          </table>
          <table v-else v-resizable-columns="`assets:receive-return:${receiveReturnTab}`" class="asset-list-table receive-return-table" style="min-width: 1040px"><thead><tr><th class="receive-return-select-cell"><input type="checkbox" aria-label="全选领用退库单" :checked="allPageSelected" :disabled="!displayedRows.length" @change="togglePageSelection(($event.target as HTMLInputElement).checked)"></th><th>{{ receiveReturnTab === 'employee' ? '申领状态' : receiveReturnTab === 'return' ? '退库状态' : '领用状态' }}</th><th>{{ receiveReturnTab === 'employee' ? '申领单号' : receiveReturnTab === 'return' ? '退库单号' : '领用单号' }}</th><th>{{ receiveReturnTab === 'employee' ? '申领日期' : receiveReturnTab === 'return' ? '退库日期' : '领用日期' }}</th><th>经办人</th><th>{{ receiveReturnTab === 'employee' ? '申领人' : '领用人' }}</th><th>工号</th><th>{{ receiveReturnTab === 'employee' ? '申领后位置' : receiveReturnTab === 'return' ? '退库后位置' : '领用后位置' }}</th><th>所属公司</th><th>资产编码</th><th>操作</th></tr></thead><tbody>
            <tr v-for="item in displayedRows" :key="operationId(item, 'FLOW')"><td class="receive-return-select-cell"><input type="checkbox" :aria-label="`选择${operationId(item, 'FLOW')}`" :checked="selectedIds.has(item.id)" @change="toggleAssetSelection(item, ($event.target as HTMLInputElement).checked)"></td><td><span class="receive-return-status-pill" :class="assetStatusClass(item.status)">{{ assetStatusLabel(item.status) }}</span></td><td><button class="link receive-return-order-link" type="button" @click="detail = item">{{ operationId(item, receiveReturnTab === 'return' ? 'TK' : 'LY') }}</button></td><td>{{ operationDate(item) }}</td><td>{{ item.custodian || '-' }}</td><td>{{ item.owner || '-' }}</td><td>{{ item.employeeCode || '-' }}</td><td>{{ item.location || '-' }}</td><td>{{ item.company || item.ownerCompany || '-' }}</td><td><span class="asset-code-text">{{ displayAssetCode(item) }}</span></td><td><button class="link receive-return-action-link" type="button" @click="detail = item">查看</button><button v-if="item.operationStatus === '待签字' && can('asset:receive_return:cancel')" class="link receive-return-action-link" type="button" @click="terminateReceipt(item)">{{ item.operationType === 'HANDOVER' ? '撤回' : '终止' }}</button></td></tr>
            <tr v-if="!displayedRows.length" class="empty-row"><td colspan="11">{{ query ? '没有匹配的领用退库记录。' : '暂无领用退库记录。' }}</td></tr>
          </tbody></table>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="receive-return-tabs"><button class="receive-return-tab" :class="{ active: borrowReturnTab === 'borrow' }" type="button" @click="borrowReturnTab = 'borrow'">借用</button><button class="receive-return-tab" :class="{ active: borrowReturnTab === 'return' }" type="button" @click="borrowReturnTab = 'return'">归还</button></div>
      <div class="asset-list-toolbar receive-return-toolbar"><div class="asset-list-actions"><button v-if="canRunAction('borrow')" class="table-action primary" type="button" @click="openBlankAction('borrow')">＋ 新增</button><el-dropdown placement="bottom-start" trigger="click"><button class="table-action has-caret" type="button">打印<span class="action-caret" aria-hidden="true"></span></button><template #dropdown><el-dropdown-menu><el-dropdown-item @click="notifyBorrowPrint">打印借用归还单</el-dropdown-item></el-dropdown-menu></template></el-dropdown><button v-if="can('asset:item:export')" class="table-action receive-return-export" type="button" @click="exportAssets">⇱ 导出</button></div><div class="asset-list-search receive-return-search"><input v-model="query" class="local-search" type="search" placeholder="模糊查询" autocomplete="off"><button class="table-action primary" type="button" aria-label="搜索" @click="page = 1">⌕</button></div></div>
      <div v-loading="state.loading" class="asset-table-shell receive-return-table-shell"><div class="asset-table-actions receive-return-table-actions"><button v-if="can('asset:item:advancedSearch')" class="link" type="button" @click="openAdvancedSearch">高级搜索</button><button class="list-settings-button" type="button" title="列表设置" aria-label="列表设置" @click="openAdvancedColumns">⚙</button></div><div class="asset-table-scroll receive-return-table-scroll"><table v-resizable-columns="`assets:borrow-return:${borrowReturnTab}`" class="asset-list-table receive-return-table borrow-return-table" style="min-width: 1900px"><thead><tr><th class="receive-return-select-cell"><input type="checkbox" aria-label="全选借用归还单" :checked="allPageSelected" :disabled="!displayedRows.length" @change="togglePageSelection(($event.target as HTMLInputElement).checked)"></th><th>借用状态</th><th>借用单号</th><th>经办人</th><th>借用人</th><th>借用日期</th><th>借用人公司</th><th>借用人部门</th><th>工号</th><th>手机号</th><th>邮箱</th><th>借用后位置</th><th>签字人</th><th>签字图片</th><th>借用备注</th><th>资产编码</th><th>资产分类</th><th>资产名称</th><th>品牌</th><th>型号</th><th>设备序列号</th><th>操作</th></tr></thead><tbody>
        <tr v-for="item in displayedRows" :key="operationId(item, 'JY')"><td class="receive-return-select-cell"><input type="checkbox" :aria-label="`选择${operationId(item, 'JY')}`" :checked="selectedIds.has(item.id)" @change="toggleAssetSelection(item, ($event.target as HTMLInputElement).checked)"></td><td><span class="receive-return-status-pill" :class="assetStatusClass(item.status)">{{ assetStatusLabel(item.status) }}</span></td><td><button class="link receive-return-order-link" type="button" @click="detail = item">{{ operationId(item, 'JY') }}</button></td><td>{{ item.custodian || '-' }}</td><td>{{ item.owner || '-' }}</td><td>{{ operationDate(item) }}</td><td>{{ item.company || '-' }}</td><td>{{ item.department || '-' }}</td><td>{{ item.employeeCode || '-' }}</td><td>{{ item.phone || '-' }}</td><td>{{ item.email || '-' }}</td><td>{{ item.location || '-' }}</td><td>{{ item.signer || '-' }}</td><td><button v-if="item.signatureImage" class="link" type="button" @click="detail = item">查看</button><span v-else>-</span></td><td>{{ item.note || '-' }}</td><td><span class="asset-code-text">{{ displayAssetCode(item) }}</span></td><td>{{ item.category || '-' }}</td><td>{{ item.name || '-' }}</td><td>{{ item.brand || '-' }}</td><td>{{ item.model || '-' }}</td><td>{{ item.sn || '-' }}</td><td><template v-if="item.operationStatus === '待签字'"><button class="link receive-return-action-link" type="button" @click="detail = item">查看</button><button v-if="can('asset:receive_return:cancel')" class="link receive-return-action-link" type="button" @click="terminateReceipt(item)">{{ item.operationType === 'HANDOVER' ? '撤回' : '终止' }}</button></template><template v-else-if="borrowReturnTab === 'return' && item.operationType === 'BORROW'"><button class="link receive-return-action-link" type="button" @click="openAction(item, 'borrow-return')">归还</button><button class="link receive-return-action-link" type="button" @click="openAction(item, 'borrow')">延期</button></template><button v-else class="link receive-return-action-link" type="button" @click="detail = item">查看</button></td></tr>
        <tr v-if="!displayedRows.length" class="empty-row"><td colspan="22">{{ query ? (borrowReturnTab === 'return' ? '没有匹配的归还记录。' : '没有匹配的借用记录。') : (borrowReturnTab === 'return' ? '暂无可归还记录。' : '暂无借用记录。') }}</td></tr>
      </tbody></table></div></div>
    </template>

    <div v-if="mode !== 'list'" class="asset-list-pagination"><span>共 {{ modeRows.length }} 条</span><button class="page-btn" type="button" aria-label="上一页" :disabled="page <= 1" @click="page--">‹</button><template v-for="(item, index) in paginationItems" :key="`${item}-${index}`"><span v-if="item === 'ellipsis'" class="page-ellipsis">…</span><button v-else class="page-btn" :class="{ active: item === page }" type="button" @click="page = item">{{ item }}</button></template><button class="page-btn" type="button" aria-label="下一页" :disabled="page >= pageCount" @click="page++">›</button><el-select v-model="pageSize" class="asset-page-size-select" aria-label="每页条数" placement="top-start" :fallback-placements="['top-start']" popper-class="portal-upward-select-popper"><el-option label="20 条/页" :value="20" /><el-option label="50 条/页" :value="50" /></el-select><span>跳至</span><input v-model.number="jumpPage" aria-label="跳转页码" @keydown.enter="goToJumpPage"><span>页</span></div>

    <el-drawer v-model="advancedOpen" class="asset-advanced-search-drawer" :size="advancedDrawerSize" :show-close="false" append-to-body>
      <template #header="{ close, titleId, titleClass }">
        <div class="asset-advanced-drawer-title"><span class="eyebrow">列表操作</span><h2 :id="titleId" :class="titleClass">{{ advancedDrawerTitle }}</h2></div>
        <button class="asset-advanced-drawer-close" type="button" aria-label="关闭" @click="close">×</button>
      </template>
      <form class="advanced-search-form" @submit.prevent="applyAdvanced">
        <div class="advanced-search-tabs">
          <button type="button" :class="{ active: advancedTab === 'search' }" @click="selectAdvancedTab('search')">高级搜索</button>
          <button type="button" :class="{ active: advancedTab === 'columns' }" @click="selectAdvancedTab('columns')">自定义列</button>
        </div>

        <template v-if="advancedTab === 'search'">
          <template v-if="mode === 'list'">
            <p class="advanced-search-hint">系统支持多种字段组合筛选，选择要精确匹配的字段后点击查询。</p>
            <div class="advanced-filter-section">
              <label class="advanced-filter-field"><span>资产状态</span><el-select v-model="assetAdvancedDraft.status" class="asset-status-multiselect advanced-filter-default-select" multiple clearable aria-label="资产状态" placeholder="全部"><el-option v-for="item in assetAdvancedOptions.statuses" :key="item" :label="assetStatusLabel(item)" :value="item" /></el-select></label>
              <label class="advanced-filter-field"><span>资产编码</span><input v-model="assetAdvancedDraft.id" placeholder="例如 AST-0001"></label>
              <label class="advanced-filter-field"><span>资产名称</span><input v-model="assetAdvancedDraft.name" placeholder="例如 测试笔记本"></label>
              <label class="advanced-filter-field"><span>资产分类</span><el-select v-model="assetAdvancedDraft.category" class="advanced-filter-default-select" aria-label="资产分类" placeholder="全部"><el-option v-for="item in assetAdvancedOptions.categories" :key="item" :label="item" :value="item" /></el-select></label>
              <label class="advanced-filter-field"><span>品牌/类型</span><el-select v-model="assetAdvancedDraft.type" class="advanced-filter-default-select" aria-label="品牌/类型" placeholder="全部"><el-option v-for="item in assetAdvancedOptions.types" :key="item" :label="item" :value="item" /></el-select></label>
              <label class="advanced-filter-field"><span>型号</span><input v-model="assetAdvancedDraft.model" placeholder="例如 X1 Carbon"></label>
              <label class="advanced-filter-field"><span>设备序列号</span><input v-model="assetAdvancedDraft.sn" placeholder="SN / 序列号"></label>
              <label class="advanced-filter-field"><span>使用人</span><input v-model="assetAdvancedDraft.owner" placeholder="姓名或未分配"></label>
              <label class="advanced-filter-field"><span>所属部门</span><el-select v-model="assetAdvancedDraft.department" class="advanced-filter-default-select" aria-label="所属部门" placeholder="全部"><el-option v-for="item in assetAdvancedOptions.departments" :key="item" :label="item" :value="item" /></el-select></label>
              <label class="advanced-filter-field"><span>所在位置</span><el-select v-model="assetAdvancedDraft.location" class="advanced-filter-default-select" aria-label="所在位置" placeholder="全部"><el-option v-for="item in assetAdvancedOptions.locations" :key="item" :label="item" :value="item" /></el-select></label>
              <label class="advanced-filter-field"><span>供应商</span><input v-model="assetAdvancedDraft.supplier" placeholder="采购或租赁供应商"></label>
              <label class="advanced-filter-field"><span>风险状态</span><el-select v-model="assetAdvancedDraft.risk" class="advanced-filter-default-select" aria-label="风险状态" placeholder="全部"><el-option v-for="item in assetAdvancedOptions.risks" :key="item" :label="item" :value="item" /></el-select></label>
              <label class="advanced-filter-field"><span>资产标签</span><el-select v-model="assetAdvancedDraft.tag" class="advanced-filter-default-select" aria-label="资产标签" placeholder="全部"><el-option v-for="item in assetAdvancedOptions.tags" :key="item" :label="item" :value="item" /></el-select></label>
            </div>
          </template>

          <template v-else-if="mode === 'inbound'">
            <p class="advanced-search-hint">入库搜索只筛选当前入库板块，可按入库单据字段组合查询。</p>
            <div class="advanced-filter-section inbound-advanced-fields">
              <label class="advanced-filter-field"><span>入库状态</span><el-select v-model="inboundAdvancedDraft.status" class="advanced-filter-default-select" aria-label="入库状态" placeholder="全部"><el-option v-for="item in workflowStatuses" :key="item" :label="item" :value="item" /></el-select></label>
              <label class="advanced-filter-field"><span>入库单号</span><input v-model="inboundAdvancedDraft.id" placeholder="请输入"></label>
              <label class="advanced-filter-field"><span>入库类型</span><input v-model="inboundAdvancedDraft.type" placeholder="入库类型"></label>
              <label class="advanced-filter-field advanced-filter-date-range"><span>入库日期</span><div class="advanced-date-range-control"><input type="date" :value="inboundAdvancedDraft.dateRange?.[0] || ''" aria-label="入库日期开始日期" @input="inboundAdvancedDraft.dateRange = updateAdvancedDateRange(inboundAdvancedDraft.dateRange, 0, ($event.target as HTMLInputElement).value)"><span>→</span><input type="date" :value="inboundAdvancedDraft.dateRange?.[1] || ''" aria-label="入库日期结束日期" @input="inboundAdvancedDraft.dateRange = updateAdvancedDateRange(inboundAdvancedDraft.dateRange, 1, ($event.target as HTMLInputElement).value)"></div></label>
              <label class="advanced-filter-field"><span>入库人</span><input v-model="inboundAdvancedDraft.operator" placeholder="入库人"></label>
              <label class="advanced-filter-field"><span>采购人</span><input v-model="inboundAdvancedDraft.purchaser" placeholder="请输入"></label>
              <label class="advanced-filter-field"><span>所属公司</span><input v-model="inboundAdvancedDraft.company" placeholder="默认公司"></label>
            </div>
          </template>

          <template v-else-if="isReceiveFlowMode">
            <div class="advanced-filter-section receive-return-advanced-fields">
              <label class="advanced-filter-field"><span>{{ receiveAdvancedLabels.status }}</span><el-select v-model="receiveAdvancedDraft.status" class="advanced-filter-default-select" :aria-label="receiveAdvancedLabels.status" placeholder="全部"><el-option v-for="item in workflowStatuses" :key="item" :label="item" :value="item" /></el-select></label>
              <label class="advanced-filter-field"><span>{{ receiveAdvancedLabels.order }}</span><input v-model="receiveAdvancedDraft.id" placeholder="请输入"></label>
              <label class="advanced-filter-field advanced-filter-date-range"><span>{{ receiveAdvancedLabels.date }}</span><div class="advanced-date-range-control"><input type="date" :value="receiveAdvancedDraft.dateRange?.[0] || ''" :aria-label="`${receiveAdvancedLabels.date}开始日期`" @input="receiveAdvancedDraft.dateRange = updateAdvancedDateRange(receiveAdvancedDraft.dateRange, 0, ($event.target as HTMLInputElement).value)"><span>→</span><input type="date" :value="receiveAdvancedDraft.dateRange?.[1] || ''" :aria-label="`${receiveAdvancedLabels.date}结束日期`" @input="receiveAdvancedDraft.dateRange = updateAdvancedDateRange(receiveAdvancedDraft.dateRange, 1, ($event.target as HTMLInputElement).value)"></div></label>
              <label class="advanced-filter-field"><span>经办人</span><input v-model="receiveAdvancedDraft.handler" placeholder="请输入"></label>
              <label class="advanced-filter-field"><span>{{ receiveReturnTab === 'handover' ? '接收人' : '领用人' }}</span><input v-model="receiveAdvancedDraft.receiver" placeholder="请输入"></label>
              <label class="advanced-filter-field"><span>{{ receiveAdvancedLabels.company }}</span><input v-model="receiveAdvancedDraft.company" placeholder="默认公司"></label>
              <label class="advanced-filter-field"><span>{{ receiveAdvancedLabels.department }}</span><input v-model="receiveAdvancedDraft.department" placeholder="默认部门"></label>
              <label class="advanced-filter-field"><span>{{ receiveAdvancedLabels.location }}</span><el-select v-model="receiveAdvancedDraft.location" class="advanced-filter-default-select" :aria-label="receiveAdvancedLabels.location" placeholder="全部"><el-option v-for="item in managedLocations" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
              <label class="advanced-filter-field"><span>{{ receiveAdvancedLabels.note }}</span><input v-model="receiveAdvancedDraft.note" placeholder="请输入"></label>
              <label class="advanced-filter-field"><span>资产编码</span><input v-model="receiveAdvancedDraft.assetId" placeholder="请输入"></label>
              <label class="advanced-filter-field"><span>资产名称</span><input v-model="receiveAdvancedDraft.assetName" placeholder="请输入"></label>
              <label class="advanced-filter-field"><span>品牌</span><input v-model="receiveAdvancedDraft.brand" placeholder="请输入"></label>
              <label class="advanced-filter-field"><span>型号</span><input v-model="receiveAdvancedDraft.model" placeholder="请输入"></label>
              <label class="advanced-filter-field"><span>设备序列号</span><input v-model="receiveAdvancedDraft.sn" placeholder="请输入"></label>
              <label v-if="receiveReturnTab !== 'handover'" class="advanced-filter-field"><span>使用人</span><input v-model="receiveAdvancedDraft.owner" placeholder="请输入"></label>
              <label class="advanced-filter-field"><span>管理员</span><input v-model="receiveAdvancedDraft.manager" placeholder="管理员"></label>
              <label class="advanced-filter-field"><span>所属/承租公司</span><input v-model="receiveAdvancedDraft.ownerCompany" placeholder="默认公司"></label>
            </div>
          </template>

          <template v-else>
            <div class="advanced-filter-section borrow-return-advanced-fields">
              <label class="advanced-filter-field"><span>借用状态</span><el-select v-model="borrowAdvancedDraft.status" class="advanced-filter-default-select" aria-label="借用状态" placeholder="全部"><el-option v-for="item in workflowStatuses" :key="item" :label="item" :value="item" /></el-select></label>
              <label class="advanced-filter-field"><span>借用单号</span><input v-model="borrowAdvancedDraft.id" placeholder="请输入"></label>
              <label class="advanced-filter-field"><span>经办人</span><input v-model="borrowAdvancedDraft.handler" placeholder="经办人"></label>
              <label class="advanced-filter-field"><span>借用人</span><input v-model="borrowAdvancedDraft.borrower" placeholder="请输入"></label>
              <label class="advanced-filter-field advanced-filter-date-range"><span>借用日期</span><div class="advanced-date-range-control"><input type="date" :value="borrowAdvancedDraft.borrowDateRange?.[0] || ''" aria-label="借用日期开始日期" @input="borrowAdvancedDraft.borrowDateRange = updateAdvancedDateRange(borrowAdvancedDraft.borrowDateRange, 0, ($event.target as HTMLInputElement).value)"><span>→</span><input type="date" :value="borrowAdvancedDraft.borrowDateRange?.[1] || ''" aria-label="借用日期结束日期" @input="borrowAdvancedDraft.borrowDateRange = updateAdvancedDateRange(borrowAdvancedDraft.borrowDateRange, 1, ($event.target as HTMLInputElement).value)"></div></label>
              <label class="advanced-filter-field advanced-filter-date-range"><span>预计归还</span><div class="advanced-date-range-control"><input type="date" :value="borrowAdvancedDraft.expectedReturnDateRange?.[0] || ''" aria-label="预计归还开始日期" @input="borrowAdvancedDraft.expectedReturnDateRange = updateAdvancedDateRange(borrowAdvancedDraft.expectedReturnDateRange, 0, ($event.target as HTMLInputElement).value)"><span>→</span><input type="date" :value="borrowAdvancedDraft.expectedReturnDateRange?.[1] || ''" aria-label="预计归还结束日期" @input="borrowAdvancedDraft.expectedReturnDateRange = updateAdvancedDateRange(borrowAdvancedDraft.expectedReturnDateRange, 1, ($event.target as HTMLInputElement).value)"></div></label>
              <label class="advanced-filter-field"><span>资产编码</span><input v-model="borrowAdvancedDraft.assetId" placeholder="请输入"></label>
              <label class="advanced-filter-field"><span>设备序列号</span><input v-model="borrowAdvancedDraft.sn" placeholder="请输入"></label>
              <label class="advanced-filter-field"><span>借用人公司</span><input v-model="borrowAdvancedDraft.company" placeholder="默认公司"></label>
              <label class="advanced-filter-field"><span>借用人部门</span><input v-model="borrowAdvancedDraft.department" placeholder="默认部门"></label>
              <label class="advanced-filter-field"><span>工号</span><input v-model="borrowAdvancedDraft.employeeCode" placeholder="请输入"></label>
              <label class="advanced-filter-field"><span>手机号</span><input v-model="borrowAdvancedDraft.phone" placeholder="请输入"></label>
              <label class="advanced-filter-field"><span>邮箱</span><input v-model="borrowAdvancedDraft.email" placeholder="请输入"></label>
              <label class="advanced-filter-field"><span>借用后位置</span><el-select v-model="borrowAdvancedDraft.location" class="advanced-filter-default-select" aria-label="借用后位置" placeholder="全部"><el-option v-for="item in managedLocations" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
            </div>
          </template>

          <div class="advanced-search-actions"><button type="submit" class="btn primary">查询</button><button type="button" class="btn" @click="clearAdvanced">重置</button></div>
        </template>

        <template v-else>
          <div v-if="mode === 'list'" class="custom-column-panel">
            <p class="advanced-search-hint">对资产进行列设置，根据实际情况勾选关键信息展示资产列表。</p>
            <div class="custom-column-toolbar"><label><input type="checkbox" :checked="allListColumnsSelected" @change="setAllListColumns(($event.target as HTMLInputElement).checked)"> 全选</label><span>({{ listVisibleColumns.length }}/{{ listColumnKeys.length }})</span><button type="button" @click="resetListSettings">重置</button></div>
            <div class="custom-column-list"><label v-for="item in listColumns" :key="item.key"><input type="checkbox" :checked="listVisibleColumns.includes(item.key)" @change="toggleListColumn(item.key, ($event.target as HTMLInputElement).checked)"> {{ item.label }}</label></div>
            <div class="list-setting-section compact-setting"><h3>表格密度</h3><div class="density-options"><button v-for="item in ([['compact','紧凑'],['standard','标准'],['roomy','宽松']] as const)" :key="item[0]" type="button" :class="{ active: listDensity === item[0] }" @click="listDensity = item[0]">{{ item[1] }}</button></div></div>
          </div>
          <div v-else-if="mode === 'handover'" class="custom-column-panel handover-custom-column-panel">
            <section class="handover-column-section" data-column-group="document">
              <div class="handover-column-section-title"><h3>单据字段</h3><button type="button" @click="resetHandoverColumnGroup(handoverDocumentColumns)">重置</button></div>
              <div class="custom-column-toolbar"><label><input type="checkbox" aria-label="全选单据字段" :checked="handoverDocumentVisibleCount === handoverDocumentColumns.length" :indeterminate.prop="handoverDocumentVisibleCount > 0 && handoverDocumentVisibleCount < handoverDocumentColumns.length" @change="setHandoverColumnGroup(handoverDocumentColumns, ($event.target as HTMLInputElement).checked)"> 全选</label><span>({{ handoverDocumentVisibleCount }}/{{ handoverDocumentColumns.length }})</span></div>
              <div class="custom-column-list"><label v-for="item in handoverDocumentColumns" :key="item.key"><input type="checkbox" :checked="handoverVisibleColumns.includes(item.key)" :disabled="item.required" @change="toggleHandoverColumn(item.key, ($event.target as HTMLInputElement).checked)"> {{ item.label }}</label></div>
            </section>
            <section class="handover-column-section" data-column-group="asset">
              <div class="handover-column-section-title"><h3>资产明细</h3><button type="button" @click="resetHandoverColumnGroup(handoverAssetColumns)">重置</button></div>
              <div class="custom-column-toolbar"><label><input type="checkbox" aria-label="全选资产明细" :checked="handoverAssetVisibleCount === handoverAssetColumns.length" :indeterminate.prop="handoverAssetVisibleCount > 0 && handoverAssetVisibleCount < handoverAssetColumns.length" @change="setHandoverColumnGroup(handoverAssetColumns, ($event.target as HTMLInputElement).checked)"> 全选</label><span>({{ handoverAssetVisibleCount }}/{{ handoverAssetColumns.length }})</span></div>
              <div class="custom-column-list"><label v-for="item in handoverAssetColumns" :key="item.key"><input type="checkbox" :checked="handoverVisibleColumns.includes(item.key)" @change="toggleHandoverColumn(item.key, ($event.target as HTMLInputElement).checked)"> {{ item.label }}</label></div>
            </section>
          </div>
          <div v-else class="custom-column-panel">
            <p class="advanced-search-hint">当前列设置只覆盖本业务单据字段，不影响资产列表。</p>
            <div class="custom-column-list"><label v-for="item in (mode === 'inbound' ? inboundColumnLabels : isReceiveFlowMode ? receiveColumnLabels : borrowColumnLabels)" :key="item"><input type="checkbox" checked disabled> {{ item }}</label></div>
          </div>
        </template>
      </form>
    </el-drawer>

    <el-drawer :model-value="Boolean(detail)" class="asset-detail-drawer" aria-label="资产详情" title="资产详情" size="min(1120px, 96vw)" append-to-body @close="detail = null">
      <div v-if="detail" class="asset-detail-page">
        <div class="asset-detail-content">
          <div class="asset-detail-title-row"><h3>资产详情</h3><el-tag class="asset-status-pill asset-status-detail" :class="assetStatusClass(displayAssetStatus(detail))">{{ displayAssetStatus(detail) }}</el-tag></div>
          <section class="asset-detail-section"><h3>领用信息</h3><div class="asset-detail-form-grid">
            <label class="asset-detail-form-item"><span>人员姓名：</span><div class="asset-detail-readonly"><strong>{{ detailText(detail.owner === '未分配' ? '' : detail.owner) }}</strong></div></label>
            <label class="asset-detail-form-item"><span>使用公司：</span><div class="asset-detail-readonly"><strong>{{ detailText(hasCurrentUsage(detail) ? detail.company : '') }}</strong></div></label>
            <label class="asset-detail-form-item"><span>使用部门：</span><div class="asset-detail-readonly"><strong>{{ detailText(hasCurrentUsage(detail) ? detail.department : '') }}</strong></div></label>
            <label class="asset-detail-form-item"><span>领用/借用日期：</span><div class="asset-detail-readonly"><strong>{{ detailText(hasCurrentUsage(detail) ? detail.receiveDate || detail.borrowDate : '') }}</strong></div></label>
          </div></section>
          <section class="asset-detail-section"><h3>基本信息</h3><div class="asset-detail-form-grid">
            <label v-for="field in ([['资产编码', displayAssetCode(detail)], ['资产名称', detail.name], ['资产分类', detail.category || detail.type], ['管理员', detail.custodian], ['品牌', detail.brand], ['型号', detail.model], ['所属/承租公司', detail.ownerCompany || detail.company], ['资产状况', displayAssetStatus(detail)], ['老系统状态码', detail.legacyAssetStatus], ['老系统单据状态码', detail.legacyQuoteStatus], ['状态核验', detail.legacyStatusVerified === false ? '待确认' : '已确认'], ['所在位置', detail.location], ['购置/起租日期', detail.purchaseDate], ['订单号', detail.orderNo], ['计量单位', detail.unit], ['购置方式', detail.purchaseMethod]] as Array<[string, unknown]>)" :key="field[0]" class="asset-detail-form-item"><span>{{ field[0] }}：</span><div class="asset-detail-readonly"><strong :class="{ 'asset-code-text': field[0] === '资产编码' }">{{ detailText(field[1]) }}</strong></div></label>
            <label class="asset-detail-form-item"><span>使用期限：</span><div class="asset-detail-readonly"><strong>{{ detailText(detail.usageMonths) }}</strong><em>月</em></div></label>
            <label class="asset-detail-form-item"><span>金额：</span><div class="asset-detail-readonly"><strong>{{ Number(detail.price || 0).toLocaleString('zh-CN') }}</strong><em>元</em></div></label>
            <label class="asset-detail-form-item wide"><span>备注：</span><div class="asset-detail-readonly tall"><strong>{{ detailText(detail.note) }}</strong></div></label>
          </div></section>
          <section class="asset-detail-section"><h3>资产图片</h3><div class="asset-detail-image-panel"><img v-if="detail.image" :src="detail.image" :alt="detail.name"><div v-else class="asset-detail-empty-image"><span aria-hidden="true">▧</span><strong>暂无图片</strong></div></div></section>
          <section class="asset-detail-section"><h3>扩展信息</h3><div class="asset-detail-form-grid"><label class="asset-detail-form-item"><span>设备序列号：</span><div class="asset-detail-readonly"><strong>{{ detailText(detail.sn) }}</strong></div></label></div></section>
          <section v-if="detail.signatureImage || detail.rejectionReason || detail.operationStatus === '待签字'" class="asset-detail-section"><h3>员工签收</h3><div class="asset-detail-form-grid">
            <label class="asset-detail-form-item"><span>签收状态：</span><div class="asset-detail-readonly"><strong>{{ detailText(detail.operationStatus) }}</strong></div></label>
            <label class="asset-detail-form-item"><span>签字人：</span><div class="asset-detail-readonly"><strong>{{ detailText(detail.signer) }}</strong></div></label>
            <label v-if="detail.rejectionReason" class="asset-detail-form-item wide"><span>打回原因：</span><div class="asset-detail-readonly"><strong>{{ detailText(detail.rejectionReason) }}</strong></div></label>
            <label v-if="detail.signatureImage" class="asset-detail-form-item wide"><span>签字图片：</span><div class="asset-detail-readonly tall"><img :src="String(detail.signatureImage)" alt="员工签字图片" style="max-width: 420px; max-height: 180px; object-fit: contain" /></div></label>
          </div></section>
          <section class="asset-detail-section"><h3>维保信息</h3><div class="asset-detail-form-grid">
            <label v-for="field in ([['供应商', detail.supplier], ['联系人', detail.supplierContact || detail.contact], ['联系方式', detail.supplierPhone || detail.contactPhone || detail.phone || detail.email], ['维保到期时间', detail.warrantyDate === '未设置' ? '' : detail.warrantyDate]] as Array<[string, unknown]>)" :key="field[0]" class="asset-detail-form-item"><span>{{ field[0] }}：</span><div class="asset-detail-readonly"><strong>{{ detailText(field[1]) }}</strong></div></label>
            <label class="asset-detail-form-item wide"><span>维保说明：</span><div class="asset-detail-readonly tall"><strong>{{ detailText(detail.maintenanceNote || detail.repairNote) }}</strong></div></label>
          </div></section>
          <section class="asset-detail-section asset-detail-operations"><h3>操作记录</h3><div class="asset-detail-table-wrap"><table v-resizable-columns="'assets:detail:operations'" class="asset-detail-operation-table"><thead><tr><th>操作时间</th><th>操作人</th><th>渠道</th><th>操作类型</th><th>操作内容</th></tr></thead><tbody><tr v-for="(row, index) in detailOperationRows(detail)" :key="index"><td>{{ row.time }}</td><td>{{ row.operator }}</td><td>{{ row.channel }}</td><td>{{ row.action }}</td><td>{{ row.content }}</td></tr></tbody></table></div><div class="asset-detail-operation-footer"><span>共 {{ detailOperationRows(detail).length }} 条</span><button class="page-btn" type="button" disabled>‹</button><button class="page-btn active" type="button">1</button><button class="page-btn" type="button" disabled>›</button><el-select model-value="20" class="asset-page-size-select" aria-label="每页条数" disabled><el-option label="20 条/页" value="20" /></el-select></div></section>
        </div>
        <div class="asset-detail-footer-actions">
          <button v-if="detail.status === '空闲' && can('asset:item:receive')" class="table-action primary" type="button" @click="openAction(detail, 'receive')">领用</button>
          <button v-if="detail.status === '领用' && can('asset:item:return')" class="table-action primary" type="button" @click="openAction(detail, 'return')">退库</button>
          <button v-if="detail.status === '空闲' && can('asset:item:borrow')" class="table-action primary" type="button" @click="openAction(detail, 'borrow')">借用</button>
          <button v-if="['借用', '借用中'].includes(detail.status) && can('asset:item:borrowReturn')" class="table-action primary" type="button" @click="openAction(detail, 'borrow-return')">归还</button>
          <button v-if="['领用', '借用', '借用中'].includes(detail.status) && can('asset:item:handover')" class="table-action" type="button" @click="openAction(detail, 'handover')">交接</button>
        </div>
      </div>
    </el-drawer>

    <el-dialog v-model="pickerOpen" :title="`选择${actionLabel(pickerAction)}资产`" width="min(980px, 94vw)" append-to-body>
      <div class="asset-picker-toolbar"><span>共 {{ pickerCandidates.length }} 项可选资产</span></div>
      <el-table ref="pickerTableRef" :data="pickerCandidates" max-height="460" row-key="id" @selection-change="pickerSelection = $event">
        <el-table-column type="selection" width="48" /><el-table-column label="资产编码" min-width="130"><template #default="{ row }"><span class="asset-code-text">{{ displayAssetCode(row) }}</span></template></el-table-column><el-table-column prop="name" label="资产名称" min-width="160" /><el-table-column prop="category" label="资产分类" min-width="120" /><el-table-column prop="status" label="状态" min-width="160"><template #default="{ row }">{{ displayAssetStatus(row) }}</template></el-table-column><el-table-column prop="owner" label="使用人" width="110" /><el-table-column prop="location" label="所在位置" min-width="140" />
      </el-table>
      <template #footer><el-button @click="pickerOpen = false">取消</el-button><el-button type="primary" @click="confirmAssetPicker">下一步</el-button></template>
    </el-dialog>

    <el-dialog v-model="createOpen" :title="copySourceId ? '复制资产' : '新增资产'" width="min(1240px, 96vw)" class="asset-dialog asset-create-dialog" destroy-on-close append-to-body>
      <el-form ref="createFormRef" :model="createDraft" :rules="createRules" label-position="left" class="asset-create-form" @submit.prevent="submitCreate">
        <section class="asset-form-section">
          <div class="asset-form-section-head"><h3>使用信息</h3></div>
          <div class="asset-form-grid">
            <el-form-item class="field" label="人员姓名">
              <el-autocomplete v-model="createDraft.owner" clearable :fetch-suggestions="directorySearch" :trigger-on-focus="false" placeholder="搜索姓名、工号、邮箱或手机号" @input="clearCreatePersonIdentity" @select="selectCreatePerson">
                <template #default="{ item }"><div class="standard-person-option"><strong>{{ item.name }}</strong><span>{{ item.account }} · {{ item.department }}</span></div></template>
              </el-autocomplete>
            </el-form-item>
            <el-form-item class="field" label="使用公司" prop="company"><el-select v-model="createDraft.company" filterable allow-create placement="bottom-start"><el-option v-for="item in formCompanies" :key="item" :label="item" :value="item" /></el-select></el-form-item>
            <el-form-item class="field" label="使用部门"><el-select v-model="createDraft.department" :disabled="!createDraft.ownerSubject" filterable allow-create placement="bottom-start" placeholder=""><el-option v-for="item in formDepartments" :key="item" :label="item" :value="item" /></el-select></el-form-item>
            <el-form-item class="field" label="领用/借用日期"><el-date-picker v-model="createDraft.receiveDate" value-format="YYYY-MM-DD" /></el-form-item>
          </div>
        </section>

        <section class="asset-form-section">
          <div class="asset-form-section-head"><h3>基本信息</h3><button type="button" class="asset-template-link">选择模板</button></div>
          <div class="asset-form-grid">
            <el-form-item class="field" label="资产编码"><el-input v-model="createDraft.id" placeholder="未填写按自动编码规则生成" /></el-form-item>
            <el-form-item class="field" label="资产名称" prop="name"><el-input v-model="createDraft.name" placeholder="请输入" /></el-form-item>
            <el-form-item class="field" label="资产分类" prop="category"><el-tree-select v-model="createDraft.category" :data="managedCategoryTree" node-key="value" filterable :default-expand-all="false" placement="bottom-start" placeholder="资产分类" @change="applyCategoryDefaults($event, createDraft)" /></el-form-item>
            <el-form-item class="field" label="管理员" prop="custodian"><el-select v-model="createDraft.custodian" filterable :loading="authorizedAdministratorsLoading" placement="bottom-start" placeholder="请选择管理员"><el-option v-for="item in formAdministrators" :key="item" :label="item" :value="item" /></el-select></el-form-item>
            <el-form-item class="field" label="品牌" prop="brand"><el-input v-model="createDraft.brand" placeholder="请输入" /></el-form-item>
            <el-form-item class="field" label="型号"><el-input v-model="createDraft.model" placeholder="请输入" /></el-form-item>
            <el-form-item class="field" label="所属/承租公司" prop="ownerCompany"><el-select v-model="createDraft.ownerCompany" filterable allow-create placement="bottom-start"><el-option v-for="item in formCompanies" :key="item" :label="item" :value="item" /></el-select></el-form-item>
            <el-form-item class="field" label="资产状况" prop="condition"><el-select v-model="createDraft.condition" placement="bottom-start" placeholder="请选择"><el-option v-for="item in assetConditions" :key="item" :label="item" :value="item" /></el-select></el-form-item>
            <el-form-item class="field" label="所在位置" prop="location"><el-tree-select v-model="createDraft.location" :data="managedLocationTree" node-key="value" filterable check-strictly :default-expand-all="false" placement="bottom-start" placeholder="所在位置" /></el-form-item>
            <el-form-item class="field" label="使用期限"><el-input v-model="createDraft.usageMonths" type="number" min="0" placeholder="请输入"><template #append>月</template></el-input></el-form-item>
            <el-form-item class="field" label="金额"><div class="asset-unit-control"><el-input-number v-model="createDraft.price" :min="0" :precision="2" controls-position="right" placeholder="请输入" /><span class="asset-unit-control__suffix">元</span></div></el-form-item>
            <el-form-item class="field" label="购置/起租日期" prop="purchaseDate"><el-date-picker v-model="createDraft.purchaseDate" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item class="field" label="订单号"><el-input v-model="createDraft.orderNo" placeholder="请输入" /></el-form-item>
            <el-form-item class="field" label="计量单位"><el-input v-model="createDraft.unit" placeholder="请输入" /></el-form-item>
            <el-form-item class="field" label="购置方式" prop="purchaseMethod"><el-select v-model="createDraft.purchaseMethod" placement="bottom-start" placeholder="请选择"><el-option v-for="item in purchaseMethods" :key="item" :label="item" :value="item" /></el-select></el-form-item>
            <el-form-item class="field" label="备注"><el-input v-model="createDraft.note" type="textarea" :rows="1" placeholder="请输入" /></el-form-item>
            <el-form-item class="field" label="租金"><div class="asset-unit-control"><el-input-number v-model="createDraft.rent" :min="0" :precision="2" controls-position="right" placeholder="请输入" /><span class="asset-unit-control__suffix">元</span></div></el-form-item>
          </div>
        </section>
      </el-form>
      <template #footer><el-button @click="createOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitCreate">确定</el-button></template>
    </el-dialog>

    <el-dialog v-model="editOpen" :title="editAction === 'edit' ? '编辑资产' : '批量修改资产'" width="min(1240px, 96vw)" class="asset-dialog asset-flow-dialog" append-to-body>
      <el-form label-position="left" class="asset-create-form asset-edit-form">
        <template v-if="editAction === 'edit'">
          <section class="asset-form-section">
            <div class="asset-form-section-head"><h3>使用信息</h3></div>
            <div class="asset-form-grid">
              <el-form-item class="field" label="人员姓名"><el-input :model-value="editSource?.owner === '未分配' ? '' : editSource?.owner" readonly /></el-form-item>
              <el-form-item class="field" label="使用公司" required><el-select v-model="editForm.company" filterable allow-create placement="bottom-start"><el-option v-for="item in formCompanies" :key="item" :label="item" :value="item" /></el-select></el-form-item>
              <el-form-item class="field" label="使用部门"><el-select v-model="editForm.department" filterable allow-create placement="bottom-start"><el-option v-for="item in formDepartments" :key="item" :label="item" :value="item" /></el-select></el-form-item>
              <el-form-item class="field" label="领用/借用日期"><el-input :model-value="editSource?.receiveDate || editSource?.borrowDate || ''" type="date" readonly /></el-form-item>
            </div>
          </section>
          <section class="asset-form-section">
            <div class="asset-form-section-head"><h3>基本信息</h3><button type="button" class="asset-template-link">选择模板</button></div>
            <div class="asset-form-grid">
              <el-form-item class="field" label="资产编码"><el-input :model-value="editSource?.id" readonly /></el-form-item>
              <el-form-item class="field" label="资产名称" required><el-input v-model="editForm.name" placeholder="请输入" /></el-form-item>
              <el-form-item class="field" label="资产分类" required><el-tree-select v-model="editForm.category" :data="managedCategoryTree" node-key="value" filterable :default-expand-all="false" placement="bottom-start" @change="applyCategoryDefaults($event, editForm)" /></el-form-item>
              <el-form-item class="field" label="管理员" required><el-select v-model="editForm.custodian" filterable :loading="authorizedAdministratorsLoading" placement="bottom-start" placeholder="请选择管理员"><el-option v-for="item in formAdministrators" :key="item" :label="item" :value="item" /></el-select></el-form-item>
              <el-form-item class="field" label="品牌" required><el-input v-model="editForm.brand" placeholder="请输入" /></el-form-item>
              <el-form-item class="field" label="型号"><el-input v-model="editForm.model" placeholder="请输入" /></el-form-item>
              <el-form-item class="field" label="所属/承租公司" required><el-select v-model="editForm.ownerCompany" filterable allow-create placement="bottom-start"><el-option v-for="item in formCompanies" :key="item" :label="item" :value="item" /></el-select></el-form-item>
              <el-form-item class="field" label="资产状况"><el-input v-model="editForm.condition" readonly /></el-form-item>
              <el-form-item class="field" label="所在位置" required><el-tree-select v-model="editForm.location" :data="managedLocationTree" node-key="value" filterable check-strictly :default-expand-all="false" placement="bottom-start" /></el-form-item>
              <el-form-item class="field" label="使用期限"><el-input v-model="editForm.usageMonths" type="number" min="0" placeholder="请输入"><template #append>月</template></el-input></el-form-item>
              <el-form-item class="field" label="金额"><div class="asset-unit-control"><el-input-number v-model="editForm.price" :min="0" :precision="2" controls-position="right" /><span class="asset-unit-control__suffix">元</span></div></el-form-item>
              <el-form-item class="field" label="购置/起租日期" required><el-date-picker v-model="editForm.purchaseDate" value-format="YYYY-MM-DD" /></el-form-item>
              <el-form-item class="field" label="订单号"><el-input v-model="editForm.orderNo" placeholder="请输入" /></el-form-item>
              <el-form-item class="field" label="计量单位"><el-input v-model="editForm.unit" placeholder="请输入" /></el-form-item>
              <el-form-item class="field" label="购置方式" required><el-select v-model="editForm.purchaseMethod" placement="bottom-start"><el-option v-for="item in purchaseMethods" :key="item" :label="item" :value="item" /></el-select></el-form-item>
              <el-form-item class="field wide" label="备注"><el-input v-model="editForm.note" type="textarea" :rows="2" placeholder="请输入" /></el-form-item>
              <el-form-item class="field" label="租金"><div class="asset-unit-control"><el-input-number v-model="editForm.rent" :min="0" :precision="2" controls-position="right" /><span class="asset-unit-control__suffix">元</span></div></el-form-item>
            </div>
          </section>
        </template>
        <section v-else class="asset-form-section">
          <div class="asset-form-section-head"><h3>批量修改</h3></div>
          <div class="asset-form-grid">
            <el-form-item class="field" label="使用公司"><el-select v-model="editForm.company" clearable filterable allow-create placement="bottom-start" placeholder="不修改"><el-option v-for="item in formCompanies" :key="item" :label="item" :value="item" /></el-select></el-form-item>
            <el-form-item class="field" label="使用部门"><el-select v-model="editForm.department" clearable filterable allow-create placement="bottom-start" placeholder="不修改"><el-option v-for="item in formDepartments" :key="item" :label="item" :value="item" /></el-select></el-form-item>
            <el-form-item class="field" label="资产状况"><el-select v-model="editForm.condition" clearable placement="bottom-start" placeholder="不修改"><el-option v-for="item in assetConditions" :key="item" :label="item" :value="item" /></el-select></el-form-item>
            <el-form-item class="field" label="所在位置"><el-select v-model="editForm.location" clearable filterable placement="bottom-start" placeholder="不修改"><el-option v-for="item in managedLocations" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
            <el-form-item class="field" label="购置方式"><el-select v-model="editForm.purchaseMethod" clearable placement="bottom-start" placeholder="不修改"><el-option v-for="item in purchaseMethods" :key="item" :label="item" :value="item" /></el-select></el-form-item>
            <el-form-item class="field wide" label="备注"><el-input v-model="editForm.note" type="textarea" :rows="2" placeholder="不修改" /></el-form-item>
          </div>
        </section>
        <section v-if="editAction === 'batch-edit'" class="asset-flow-section">
          <div class="asset-flow-tabs"><span>资产详情</span></div>
          <div class="asset-flow-table-wrap"><table v-resizable-columns="'assets:edit:selected'" class="asset-flow-table"><thead><tr><th>资产编码</th><th>资产分类</th><th>资产名称</th><th>品牌</th><th>型号</th><th>设备序列号</th><th>金额</th><th>所属/承租公司</th><th>使用公司</th><th>使用部门</th><th>所在位置</th><th>使用人</th><th>管理员</th><th>购置方式</th><th>备注</th></tr></thead><tbody><tr v-for="item in assets.filter((asset) => editIds.includes(asset.id))" :key="item.id"><td><span class="asset-code-text">{{ item.id }}</span></td><td>{{ item.category || '-' }}</td><td>{{ item.name }}</td><td>{{ item.brand || '-' }}</td><td>{{ item.model || '-' }}</td><td>{{ item.sn || '-' }}</td><td>{{ item.price || 0 }}</td><td>{{ item.ownerCompany || item.company || '-' }}</td><td>{{ item.company || '-' }}</td><td>{{ item.department || '-' }}</td><td>{{ item.location || '-' }}</td><td>{{ item.owner || '-' }}</td><td>{{ item.custodian || '-' }}</td><td>{{ item.purchaseMethod || '-' }}</td><td>{{ item.note || '-' }}</td></tr></tbody></table></div>
        </section>
      </el-form>
      <template #footer><el-button @click="editOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitEdit">确定</el-button></template>
    </el-dialog>

    <el-dialog v-model="actionOpen" :title="actionDialogTitle" :width="actionForm.action === 'cancel-inbound' ? 'min(620px, 94vw)' : 'min(1240px, 96vw)'" class="asset-dialog asset-flow-dialog" append-to-body>
      <el-alert v-if="actionForm.action === 'cancel-inbound'" title="撤销后对应资产将从资产列表移除，请确认尚未投入使用。" type="warning" :closable="false" />
      <el-form v-else label-position="left" class="asset-flow-form" :class="{ 'receive-flow-form': actionForm.action === 'receive', 'borrow-flow-form': actionForm.action === 'borrow', 'handover-flow-form': actionForm.action === 'handover' }">
        <section class="asset-flow-section">
          <div v-if="actionForm.action === 'handover'" class="handover-mode-row" role="radiogroup" aria-label="交接类型"><span class="handover-mode-label">交接类型：</span><el-radio-group v-model="actionForm.handoverType"><el-radio value="personal">员工交接</el-radio><el-radio value="public">公共交接</el-radio></el-radio-group></div>
          <div class="asset-flow-grid">
            <el-form-item v-if="needsPerson" class="field" :style="actionForm.action === 'handover' ? { order: 1 } : undefined" :label="actionForm.action === 'handover' ? '接收人：' : actionForm.action === 'borrow' ? '借用人：' : '领用人'" required><el-autocomplete v-model="actionForm.person" clearable :fetch-suggestions="personSearch" :trigger-on-focus="false" placeholder="搜索姓名、工号、邮箱或手机号" @input="clearActionPersonIdentity" @select="selectPerson"><template #default="{ item }"><div class="standard-person-option"><strong>{{ item.name }}</strong><span>{{ item.account }} · {{ item.department }}</span></div></template></el-autocomplete></el-form-item>
            <el-form-item v-if="actionForm.action === 'receive' || actionForm.action === 'borrow' || (actionForm.action === 'handover' && actionForm.handoverType === 'personal')" class="field" :style="actionForm.action === 'handover' ? { order: 2 } : undefined" :label="actionForm.action === 'handover' ? '接收公司：' : '所属公司'" required><el-input v-model="actionForm.company" readonly /></el-form-item>
            <el-form-item v-if="actionForm.action === 'receive' || actionForm.action === 'borrow'" class="field" :label="actionForm.action === 'borrow' ? '所在部门：' : '所在部门'"><el-input v-model="actionForm.department" readonly /></el-form-item>
            <el-form-item v-if="actionForm.action === 'handover'" class="field" :style="{ order: 3 }" label="接收部门："><el-select v-model="actionForm.department" :disabled="actionForm.handoverType === 'personal' && !actionForm.personSubject" filterable allow-create placement="bottom-start" placeholder=""><el-option v-for="item in formDepartments" :key="item" :label="item" :value="item" /></el-select></el-form-item>
            <el-form-item class="field" :style="actionForm.action === 'return' ? { order: 1 } : actionForm.action === 'handover' ? { order: 5 } : undefined" :label="actionForm.action === 'return' ? '退库日期' : actionForm.action === 'borrow-return' ? '归还日期：' : actionForm.action === 'borrow' ? '借用日期：' : actionForm.action === 'handover' ? '交接日期：' : '领用日期'" required><el-date-picker v-model="actionForm.date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item v-if="actionForm.action === 'borrow'" class="field" label="预计归还日期："><el-date-picker v-model="actionForm.expectedReturnDate" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item class="field" :style="actionForm.action === 'return' || actionForm.action === 'handover' ? { order: 4 } : undefined" :label="actionForm.action === 'return' ? '退库后位置' : actionForm.action === 'borrow-return' ? '归还后位置：' : actionForm.action === 'borrow' ? '借用后位置：' : actionForm.action === 'handover' ? '接收位置：' : '领用后位置'" required><el-tree-select v-model="actionForm.location" :data="managedLocationTree" node-key="value" filterable check-strictly :automatic-dropdown="false" :render-after-expand="false" :default-expand-all="false" :default-expanded-keys="[]" placement="bottom-start" :placeholder="actionLocationPlaceholder" /></el-form-item>
            <el-form-item class="field" :style="actionForm.action === 'return' ? { order: 5 } : actionForm.action === 'handover' ? { order: 6 } : undefined" :label="actionForm.action === 'borrow' || actionForm.action === 'borrow-return' || actionForm.action === 'handover' ? '经办人：' : '经办人'" required><el-input v-model="actionForm.operator" :readonly="actionForm.action !== 'return'" /></el-form-item>
            <el-form-item class="field full" :style="actionForm.action === 'return' ? { order: 6 } : actionForm.action === 'handover' ? { order: 7 } : undefined" :label="actionForm.action === 'return' ? '退库备注' : actionForm.action === 'borrow-return' ? '归还备注：' : actionForm.action === 'borrow' ? '借用备注：' : actionForm.action === 'handover' ? '交接备注：' : '领用备注'"><el-input v-model="actionForm.note" type="textarea" :rows="2" placeholder="请输入" /></el-form-item>
          </div>
        </section>
        <section class="asset-flow-section">
          <div class="asset-flow-tabs"><span>{{ actionForm.action === 'receive' || actionForm.action === 'borrow' ? '资产详情' : '资产明细' }}</span></div>
          <div class="asset-flow-toolbar"><el-button type="primary" @click="reopenActionPicker">选择资产</el-button><el-button :disabled="!actionSelectedIds.length" @click="removeActionAssets">删除资产</el-button></div>
          <div class="asset-flow-table-wrap"><table v-resizable-columns="`assets:action:${actionForm.action}`" class="asset-flow-table"><thead><tr><th class="asset-flow-select-cell"><input type="checkbox" :checked="allActionAssetsSelected" aria-label="全选资产明细" @change="toggleAllActionAssets(($event.target as HTMLInputElement).checked)"></th><th v-if="actionForm.action === 'borrow'">预计归还日期</th><th>资产图片</th><th>资产编码</th><th>资产分类</th><th>资产名称</th><th>品牌</th><th>型号</th><th>设备序列号</th><th>金额</th><th>所属/承租公司</th><th>使用公司</th><th>使用部门</th><th>所在位置</th><th>使用人</th><th>管理员</th><th>购置方式</th><th>订单号</th><th>供应商</th><th>备注</th></tr></thead><tbody><tr v-for="item in actionAssets" :key="item.id"><td class="asset-flow-select-cell"><input v-model="actionSelectedIds" type="checkbox" :value="item.id" :aria-label="`选择${item.id}`"></td><td v-if="actionForm.action === 'borrow'"><el-date-picker v-model="actionForm.expectedReturnDates[item.id]" class="asset-flow-date-input" value-format="YYYY-MM-DD" /></td><td><img v-if="item.image" class="asset-flow-image" :src="item.image" :alt="item.name"><span v-else>-</span></td><td><span class="asset-code-text">{{ item.id }}</span></td><td>{{ item.category || '-' }}</td><td>{{ item.name }}</td><td>{{ item.brand || '-' }}</td><td>{{ item.model || '-' }}</td><td>{{ item.sn || '-' }}</td><td>{{ item.price || 0 }}</td><td>{{ item.ownerCompany || item.company || '-' }}</td><td>{{ item.company || '-' }}</td><td>{{ item.department || '-' }}</td><td>{{ item.location || '-' }}</td><td>{{ item.owner || '-' }}</td><td>{{ item.custodian || '-' }}</td><td>{{ item.purchaseMethod || '-' }}</td><td>{{ item.orderNo || '-' }}</td><td>{{ item.supplier || '-' }}</td><td>{{ item.note || '-' }}</td></tr><tr v-if="!actionAssets.length" class="empty-row"><td :colspan="actionForm.action === 'borrow' ? 20 : 19">暂无已选择资产，请点击选择资产添加。</td></tr></tbody></table></div>
        </section>
      </el-form>
      <template #footer><el-button @click="actionOpen = false">取消</el-button><el-button type="primary" :disabled="!canSubmitAction" :loading="submitting" @click="submitAction">{{ actionForm.action === 'cancel-inbound' ? '确认撤销' : '保存并提交' }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="importOpen" :title="importTitle" width="min(820px, 94vw)" class="asset-dialog asset-import-dialog" append-to-body>
      <div class="asset-import-form">
        <label class="asset-upload-drop" :class="{ 'drag-over': importDragActive }" tabindex="0" @keydown.enter.prevent="importFileInput?.click()" @keydown.space.prevent="importFileInput?.click()" @dragenter.prevent="importDragActive = true" @dragover.prevent="importDragActive = true" @dragleave.prevent="importDragActive = false" @drop.prevent="dropImportFile"><input ref="importFileInput" type="file" accept=".xls,.xlsx" hidden @change="readImportFile"><span class="upload-cloud" aria-hidden="true">☁</span><strong>{{ importFileName ? '已选择表格' : '上传表格' }}</strong><span data-asset-upload-hint>{{ importFileName ? '点击或拖拽可重新选择文件' : '也可直接拖拽到此处上传(支持格式: xls、xlsx)' }}</span><span v-if="importFileName" class="asset-upload-file">{{ importFileName }} · {{ importFileSize }}</span></label>
        <a v-if="importMode === 'asset'" class="asset-template-download" href="/assets/asset-import-template.xlsx" :download="importTemplateName">⇩ {{ importTemplateName }}</a>
        <button v-else-if="importMode !== 'replace'" type="button" class="asset-template-download" @click="downloadImportTemplate">⇩ {{ importTemplateName }}</button>
        <a v-if="importTemplateUrl" ref="importTemplateLink" :href="importTemplateUrl" :download="importTemplateName" hidden>下载</a>
        <div v-if="parsing" class="asset-import-status">正在校验导入文件……</div>
        <div v-else-if="importRows.length" class="asset-import-status" :class="invalidImportCount ? 'error' : 'success'">可导入 {{ validImportRows.length }} 条，错误 {{ invalidImportCount }} 条。<span v-if="invalidImportCount">请修正错误后重新上传。</span></div>
        <div class="asset-import-note"><p>{{ importMode === 'asset' ? '导入前会校验资产名称、分类、位置和金额，错误行不会提交。' : importMode === 'update' ? '按资产编码更新已填写字段，空白字段保持原值。' : importMode === 'replace' ? '以文件中的资产编码集合全量替换当前资产；文件未提供的位置、金额等系统字段按编码保留。' : '按资产编码、ECP 人员和领用日期批量领用资产。' }}</p><ol><li>最大数据行数不超过5000行；</li><li>请根据错误文件的错误说明，修改原文件错误后导入；</li><li>请勿在模板中添加批注导入。</li></ol></div>
        <el-table v-if="importRows.length" :data="importRows" max-height="220"><el-table-column prop="rowNumber" label="行号" width="70" /><el-table-column label="资产编码" min-width="130"><template #default="scope">{{ scope.row.draft?.id || '-' }}</template></el-table-column><el-table-column label="资产名称" min-width="150"><template #default="scope">{{ scope.row.draft?.name || '-' }}</template></el-table-column><el-table-column label="校验结果" min-width="220"><template #default="scope"><el-tag v-if="!scope.row.errors.length" type="success">可导入</el-tag><span v-else class="standard-import-error">{{ scope.row.errors.join('；') }}</span></template></el-table-column></el-table>
      </div>
      <template #footer><el-button @click="importOpen = false">取消</el-button><el-button type="primary" :disabled="!validImportRows.length || (importMode === 'replace' && invalidImportCount > 0)" :loading="submitting" @click="submitImport">确定</el-button></template>
    </el-dialog>

    <el-dialog v-model="printOpen" :title="labelPrintTitle" width="min(760px, calc(100vw - 48px))" append-to-body class="standard-print-dialog asset-label-print-dialog">
      <AssetLabelPrintPreview :assets="labelPrintRows" :settings="printSettings" :custom-templates="printTemplates" @print="printNow" />
    </el-dialog>

    <el-dialog v-model="orderPrintOpen" :title="orderPrintTitle" width="min(1080px, 94vw)" append-to-body class="standard-print-dialog order-print-dialog">
      <AssetOrderPrintPreview :kind="orderPrintKind" :rows="orderPrintRows" :current-user="user?.name" />
      <template #footer><el-button @click="orderPrintOpen = false">取消</el-button><el-button type="primary" @click="printOrderNow">打印</el-button></template>
    </el-dialog>

    <AssetDisposalCreateDrawer v-if="mode === 'list'" v-model="disposalOpen" :preset-asset-ids="disposalPresetAssetIds" @created="handleAssetDisposalCreated" />
  </section>
</template>
