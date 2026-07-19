<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Download, Filter, Plus, Printer, Refresh, Search, Setting, Upload } from '@element-plus/icons-vue'
import { usePortalSession } from '../../../core/auth/portal-session'
import { searchDirectoryPeople } from '../api/assets.api'
import { parseAssetWorkbook, type AssetImportMode } from '../composables/parseAssetWorkbook'
import { useAssets } from '../composables/useAssets'
import type { AssetCommand, AssetDraft, AssetImportRow, AssetRecord, DirectoryPerson } from '../types/assets'

type Mode = 'list' | 'inbound' | 'receive-return' | 'borrow-return'
type ColumnKey = 'id' | 'name' | 'category' | 'status' | 'owner' | 'department' | 'location' | 'brand' | 'model' | 'sn' | 'supplier' | 'price' | 'purchaseDate'
type LegacyColumnKey = 'status' | 'code' | 'name' | 'category' | 'phone' | 'email' | 'date' | 'location' | 'price' | 'purchase' | 'rent' | 'supplier' | 'owner' | 'usage'
type TableDensity = 'compact' | 'standard' | 'roomy'
type ActionForm = { action: AssetCommand; assetIds: string[]; person: string; personSubject: string; location: string; date: string; expectedReturnDate: string; note: string }

const props = withDefaults(defineProps<{ mode?: Mode }>(), { mode: 'list' })
const { state, assets, store, load, create, copy, importMany, command } = useAssets()
const { user } = usePortalSession()
const query = ref('')
const status = ref('全部')
const category = ref('全部')
const page = ref(1)
const pageSize = ref(20)
const selected = ref<AssetRecord[]>([])
const detail = ref<AssetRecord | null>(null)
const createOpen = ref(false)
const actionOpen = ref(false)
const editOpen = ref(false)
const advancedOpen = ref(false)
const importOpen = ref(false)
const printOpen = ref(false)
const submitting = ref(false)
const parsing = ref(false)
const createFormRef = ref<FormInstance>()
const people = ref<DirectoryPerson[]>([])
const copySourceId = ref('')
const editAction = ref<'edit' | 'batch-edit'>('edit')
const editIds = ref<string[]>([])
const importRows = ref<AssetImportRow[]>([])
const importFileName = ref('')
const importMode = ref<AssetImportMode>('asset')
const exportLink = ref<HTMLAnchorElement>()
const exportUrl = ref('')

const titleByMode: Record<Mode, string> = { list: '资产列表', inbound: '资产入库', 'receive-return': '领用退库', 'borrow-return': '借用归还' }
const subtitleByMode: Record<Mode, string> = {
  list: '统一查看资产状态、归属、位置与生命周期信息。',
  inbound: '登记新资产、批量导入并查看入库记录。',
  'receive-return': '管理员工领用、退库和资产交接记录。',
  'borrow-return': '管理资产借用、预计归还日期与归还状态。'
}
const title = computed(() => titleByMode[props.mode])
const permissions = computed(() => new Set(user.value?.permissionCodes || []))
const can = (code: string): boolean => permissions.value.has(code)

const columnOptions: Array<{ key: ColumnKey; label: string }> = [
  { key: 'id', label: '资产编码' }, { key: 'name', label: '资产名称' }, { key: 'category', label: '资产分类' },
  { key: 'status', label: '状态' }, { key: 'owner', label: '使用人' }, { key: 'department', label: '使用部门' },
  { key: 'location', label: '所在位置' }, { key: 'brand', label: '品牌' }, { key: 'model', label: '型号' },
  { key: 'sn', label: '序列号' }, { key: 'supplier', label: '供应商' }, { key: 'price', label: '金额' },
  { key: 'purchaseDate', label: '购置日期' }
]
const defaultColumns: ColumnKey[] = ['id', 'name', 'category', 'status', 'owner', 'department', 'location', 'model', 'sn']
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

const legacyColumns: Array<{ key: LegacyColumnKey; label: string; width: number }> = [
  { key: 'status', label: '资产状态', width: 86 }, { key: 'code', label: '资产编码', width: 112 },
  { key: 'name', label: '资产名称', width: 118 }, { key: 'category', label: '资产分类', width: 92 },
  { key: 'phone', label: '手机号', width: 92 }, { key: 'email', label: '电子邮箱', width: 118 },
  { key: 'date', label: '领用日期', width: 90 }, { key: 'location', label: '所在位置', width: 92 },
  { key: 'price', label: '金额', width: 64 }, { key: 'purchase', label: '购置方式', width: 82 },
  { key: 'rent', label: '租金', width: 56 }, { key: 'supplier', label: '供应商', width: 104 },
  { key: 'owner', label: '使用人', width: 78 }, { key: 'usage', label: '使用信息', width: 110 }
]
const legacyColumnKeys = legacyColumns.map((item) => item.key)
const parseLegacySettings = (): { columns: LegacyColumnKey[]; density: TableDensity } => {
  try {
    const value = JSON.parse(localStorage.getItem('assetListSettings') || '{}') as { visibleColumns?: unknown; density?: unknown }
    const columns = Array.isArray(value.visibleColumns)
      ? value.visibleColumns.filter((item): item is LegacyColumnKey => legacyColumnKeys.includes(item as LegacyColumnKey))
      : legacyColumnKeys
    const density = ['compact', 'standard', 'roomy'].includes(String(value.density)) ? value.density as TableDensity : 'compact'
    return { columns: columns.length ? columns : legacyColumnKeys, density }
  } catch { return { columns: legacyColumnKeys, density: 'compact' } }
}
const legacySettings = parseLegacySettings()
const legacyVisibleColumns = ref<LegacyColumnKey[]>(legacySettings.columns)
const legacyDensity = ref<TableDensity>(legacySettings.density)
const legacyDisplayedColumns = computed(() => legacyColumns.filter((item) => legacyVisibleColumns.value.includes(item.key)))
const legacyTableMinWidth = computed(() => 36 + legacyDisplayedColumns.value.reduce((sum, item) => sum + item.width, 0))
const saveLegacySettings = (): void => localStorage.setItem('assetListSettings', JSON.stringify({
  visibleColumns: legacyVisibleColumns.value,
  density: legacyDensity.value,
  columnLayoutVersion: 'compact-v2',
  columnWidths: {}
}))
watch([legacyVisibleColumns, legacyDensity], saveLegacySettings, { deep: true })
const toggleLegacyColumn = (key: LegacyColumnKey, checked: boolean): void => {
  const columns = new Set(legacyVisibleColumns.value)
  if (checked) columns.add(key)
  else if (columns.size > 1) columns.delete(key)
  legacyVisibleColumns.value = legacyColumnKeys.filter((item) => columns.has(item))
}
const resetLegacySettings = (): void => { legacyVisibleColumns.value = [...legacyColumnKeys]; legacyDensity.value = 'compact' }

const categories = computed(() => Array.from(new Set(assets.value.map((item) => item.category).filter(Boolean))).sort())
const statuses = computed(() => Array.from(new Set(assets.value.map((item) => item.status).filter(Boolean))).sort())
const advanced = reactive({ id: '', name: '', type: '', model: '', sn: '', owner: '', department: '', location: '', supplier: '', risk: '', tag: '' })
const searchable = (item: AssetRecord): string => [item.id, item.name, item.assetTag, item.owner, item.department, item.location, item.model, item.sn]
  .map((value) => String(value || '').toLowerCase()).join(' ')
const contains = (value: unknown, expected: string): boolean => !expected || String(value || '').toLowerCase().includes(expected.trim().toLowerCase())

const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return assets.value.filter((item) => {
    const modeMatch = props.mode === 'receive-return'
      ? ['闲置', '空闲', '在用', '领用中'].includes(item.status)
      : props.mode === 'borrow-return'
        ? ['闲置', '空闲', '借用中'].includes(item.status)
        : true
    return modeMatch
      && (!keyword || searchable(item).includes(keyword))
      && (status.value === '全部' || item.status === status.value)
      && (category.value === '全部' || item.category === category.value)
      && contains(item.id, advanced.id) && contains(item.name, advanced.name) && contains(item.type, advanced.type)
      && contains(item.model, advanced.model) && contains(item.sn, advanced.sn) && contains(item.owner, advanced.owner)
      && contains(item.department, advanced.department) && contains(item.location, advanced.location)
      && contains(item.supplier, advanced.supplier) && contains(item.risk, advanced.risk)
      && (!advanced.tag || (item.tags || []).some((tag) => contains(tag, advanced.tag)))
  })
})
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)))
const paginationItems = computed<Array<number | 'ellipsis'>>(() => {
  if (pageCount.value <= 7) return Array.from({ length: pageCount.value }, (_, index) => index + 1)
  const pages = Array.from(new Set([1, pageCount.value, page.value - 1, page.value, page.value + 1]))
    .filter((item) => item >= 1 && item <= pageCount.value).sort((left, right) => left - right)
  return pages.flatMap((item, index) => index && item - pages[index - 1] > 1 ? ['ellipsis' as const, item] : [item])
})
const jumpPage = ref<number | undefined>()
watch([query, status, category], () => { page.value = 1 })
watch([filtered, pageSize], () => { page.value = Math.min(page.value, pageCount.value) })

const selectedIds = computed(() => new Set(selected.value.map((item) => item.id)))
const allPageSelected = computed(() => paged.value.length > 0 && paged.value.every((item) => selectedIds.value.has(item.id)))
const toggleAssetSelection = (item: AssetRecord, checked: boolean): void => {
  selected.value = checked
    ? [...selected.value.filter((row) => row.id !== item.id), item]
    : selected.value.filter((row) => row.id !== item.id)
}
const togglePageSelection = (checked: boolean): void => {
  const pageIds = new Set(paged.value.map((item) => item.id))
  selected.value = checked
    ? [...selected.value.filter((item) => !pageIds.has(item.id)), ...paged.value]
    : selected.value.filter((item) => !pageIds.has(item.id))
}
const goToJumpPage = (): void => {
  if (jumpPage.value === undefined) return
  page.value = Math.min(Math.max(Math.trunc(jumpPage.value), 1), pageCount.value)
  jumpPage.value = undefined
}

const legacyCellValue = (item: AssetRecord, key: LegacyColumnKey): string | number => {
  if (key === 'code') return item.id || '-'
  if (key === 'date') return String(item.receiveDate || '-')
  if (key === 'purchase') return String(item.purchaseMethod || '-')
  if (key === 'usage') return `${item.status || '-'} / ${item.department || '-'}`
  if (key === 'rent') return Number(item.rent || 0)
  const value = item[key]
  return value === undefined || value === null || value === '' ? '-' : String(value)
}
const legacyStatusClass = (value: string): string => {
  if (value.includes('审批')) return 'green'
  if (value === '空闲' || value === '闲置') return 'blue'
  if (value === '交接待签字') return 'red'
  return 'violet'
}

const clearAdvanced = (): void => { Object.assign(advanced, { id: '', name: '', type: '', model: '', sn: '', owner: '', department: '', location: '', supplier: '', risk: '', tag: '' }) }
const reset = (): void => { query.value = ''; status.value = '全部'; category.value = '全部'; clearAdvanced(); page.value = 1 }
const refresh = async (): Promise<void> => { await load(true); ElMessage.success('数据已刷新') }

const createDraft = reactive<AssetDraft>({
  name: '', category: '', type: '设备', status: '闲置', location: '', company: '', department: '', owner: '未分配',
  custodian: '', brand: '', model: '', sn: '', assetTag: '', supplier: '', price: 0, purchaseDate: new Date().toISOString().slice(0, 10)
})
const createRules: FormRules = {
  name: [{ required: true, message: '请输入资产名称', trigger: 'blur' }],
  category: [{ required: true, message: '请选择资产分类', trigger: 'change' }],
  location: [{ required: true, message: '请输入所在位置', trigger: 'blur' }]
}
const emptyDraft = (): AssetDraft => ({ name: '', category: categories.value[0] || '', type: '设备', status: '闲置', location: '', company: user.value?.company || '', department: '', owner: '未分配', custodian: user.value?.name || '', brand: '', model: '', sn: '', assetTag: '', supplier: '', price: 0, purchaseDate: new Date().toISOString().slice(0, 10), purchaseMethod: '', orderNo: '', unit: '', rent: 0, note: '' })
const openCreate = (source?: AssetRecord): void => {
  copySourceId.value = source?.id || ''
  Object.assign(createDraft, source ? { ...source, id: undefined, name: `${source.name} - 副本`, assetTag: '', sn: '' } : emptyDraft())
  createOpen.value = true
}
const submitCreate = async (): Promise<void> => {
  if (!await createFormRef.value?.validate().catch(() => false)) return
  submitting.value = true
  try {
    if (copySourceId.value) await copy(copySourceId.value, { ...createDraft })
    else await create({ ...createDraft })
    createOpen.value = false
    ElMessage.success(copySourceId.value ? '资产已复制' : '资产已新增')
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '保存资产失败') }
  finally { submitting.value = false }
}

const actionForm = reactive<ActionForm>({ action: 'receive', assetIds: [], person: '', personSubject: '', location: '', date: new Date().toISOString().slice(0, 10), expectedReturnDate: '', note: '' })
const actionLabels: Record<AssetCommand, string> = { receive: '领用', return: '退库', borrow: '借用', 'borrow-return': '归还', handover: '交接', delete: '删除', edit: '编辑', 'batch-edit': '批量修改', 'cancel-inbound': '撤销入库', 'repair-start': '报修', 'repair-complete': '完成维修', 'update-import': '更新导入', 'receive-import': '领用导入' }
const actionLabel = (action: AssetCommand): string => actionLabels[action]
const actionFor = (item: AssetRecord): AssetCommand | null => {
  if (props.mode === 'receive-return') {
    const action = ['在用', '领用中'].includes(item.status) ? 'return' : 'receive'
    return can(action === 'return' ? 'asset:item:return' : 'asset:item:receive') ? action : null
  }
  if (props.mode === 'borrow-return') {
    const action = item.status === '借用中' ? 'borrow-return' : 'borrow'
    return can(action === 'borrow-return' ? 'asset:item:borrowReturn' : 'asset:item:borrow') ? action : null
  }
  return null
}
const openActionForIds = (items: AssetRecord[], action: AssetCommand): void => {
  if (!items.length) { ElMessage.warning('请先选择资产'); return }
  Object.assign(actionForm, { action, assetIds: items.map((item) => item.id), person: '', personSubject: '', location: items[0].location || '', date: new Date().toISOString().slice(0, 10), expectedReturnDate: '', note: '' })
  actionOpen.value = true
}
const openAction = (item: AssetRecord, action: AssetCommand): void => openActionForIds([item], action)
const openSelectedWorkflow = (): void => {
  const actions = selected.value.map(actionFor)
  const action = actions[0]
  if (!action || actions.some((item) => item !== action)) { ElMessage.warning('请选择状态一致且可执行当前操作的资产'); return }
  openActionForIds(selected.value, action)
}
const needsPerson = computed(() => ['receive', 'borrow', 'handover'].includes(actionForm.action))
const personSearch = async (keyword: string, callback: (values: Array<DirectoryPerson & { value: string }>) => void): Promise<void> => {
  try { people.value = await searchDirectoryPeople(keyword); callback(people.value.map((item) => ({ ...item, value: `${item.name} · ${item.account || item.email}` }))) }
  catch { callback([]) }
}
const selectPerson = (person: DirectoryPerson): void => { actionForm.person = person.name; actionForm.personSubject = person.subject }
const submitAction = async (): Promise<void> => {
  if (needsPerson.value && !actionForm.personSubject) { ElMessage.warning('请搜索并选择 ECP 人员'); return }
  if (actionForm.action === 'borrow' && !actionForm.expectedReturnDate) { ElMessage.warning('请选择预计归还日期'); return }
  submitting.value = true
  try {
    const fields: Record<string, unknown> = { location: actionForm.location, date: actionForm.date, note: actionForm.note }
    if (actionForm.action === 'receive') Object.assign(fields, { receiver: actionForm.person, receiverSubject: actionForm.personSubject })
    if (actionForm.action === 'borrow') Object.assign(fields, { borrower: actionForm.person, borrowerSubject: actionForm.personSubject, expectedReturnDate: actionForm.expectedReturnDate })
    if (actionForm.action === 'handover') Object.assign(fields, { receiver: actionForm.person, receiverSubject: actionForm.personSubject, handoverType: '员工交接' })
    await command(actionForm.action, actionForm.assetIds, fields)
    actionOpen.value = false
    selected.value = []
    ElMessage.success(`${actionLabel(actionForm.action)}操作已完成`)
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '资产操作失败') }
  finally { submitting.value = false }
}

const editForm = reactive<{ name: string; category: string; company: string; department: string; location: string; custodian: string; brand: string; model: string; supplier: string; price?: number; purchaseDate: string; purchaseMethod: string; orderNo: string; unit: string; rent?: number; note: string }>({ name: '', category: '', company: '', department: '', location: '', custodian: '', brand: '', model: '', supplier: '', price: undefined, purchaseDate: '', purchaseMethod: '', orderNo: '', unit: '', rent: undefined, note: '' })
const openEdit = (items: AssetRecord[], batch = false): void => {
  if (!items.length) { ElMessage.warning('请先选择资产'); return }
  editAction.value = batch ? 'batch-edit' : 'edit'
  editIds.value = items.map((item) => item.id)
  const source = items[0]
  Object.assign(editForm, batch ? { name: '', category: '', company: '', department: '', location: '', custodian: '', brand: '', model: '', supplier: '', price: undefined, purchaseDate: '', purchaseMethod: '', orderNo: '', unit: '', rent: undefined, note: '' } : source)
  editOpen.value = true
}
const submitEdit = async (): Promise<void> => {
  const entries = Object.entries(editForm).filter(([, value]) => editAction.value === 'edit' || value !== '' && value !== null)
  if (editAction.value === 'batch-edit' && !entries.length) { ElMessage.warning('请至少填写一个修改字段'); return }
  submitting.value = true
  try { await command(editAction.value, editIds.value, Object.fromEntries(entries)); editOpen.value = false; selected.value = []; ElMessage.success(editAction.value === 'edit' ? '资产已更新' : '批量修改已完成') }
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
const importTitle = computed(() => ({ asset: '资产导入', update: '更新导入', receive: '批量领用导入' })[importMode.value])
const openImport = (mode: AssetImportMode): void => {
  importMode.value = mode
  importRows.value = []
  importFileName.value = ''
  importOpen.value = true
}
const readImportFile = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  parsing.value = true; importFileName.value = file.name; importRows.value = []
  try { importRows.value = await parseAssetWorkbook(file, importMode.value) }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '工作簿解析失败') }
  finally { parsing.value = false }
}
const submitImport = async (): Promise<void> => {
  if (!validImportRows.value.length) { ElMessage.warning('没有可导入的数据'); return }
  submitting.value = true
  try {
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
  const rows = selected.value.length ? selected.value : filtered.value
  if (!rows.length) { ElMessage.warning('没有可导出的资产'); return }
  const columns = props.mode === 'list' ? legacyDisplayedColumns.value : columnOptions.filter((item) => hasColumn(item.key))
  const csv = `\uFEFF${columns.map((item) => csvCell(item.label)).join(',')}\n${rows.map((row) => columns.map((item) => csvCell(props.mode === 'list' ? legacyCellValue(row, item.key as LegacyColumnKey) : row[item.key])).join(',')).join('\n')}`
  exportUrl.value = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  await nextTick(); exportLink.value?.click(); window.setTimeout(() => { URL.revokeObjectURL(exportUrl.value); exportUrl.value = '' }, 0)
  ElMessage.success(`已导出 ${rows.length} 条资产`)
}
const printRows = computed(() => selected.value.length ? selected.value : filtered.value.slice(0, 100))
const printSettings = computed(() => store.value.assetLabelPrintSettingsV2 || {})
const printFields = computed(() => Array.isArray(printSettings.value.fields) ? printSettings.value.fields as string[] : ['name', 'id', 'category', 'location'])
const printFieldLabels: Record<string, string> = { name: '资产名称', id: '资产编码', category: '资产分类', owner: '使用人', location: '所在位置', sn: '序列号' }
const printGridStyle = computed(() => ({ gridTemplateColumns: `repeat(${Math.max(1, Number(printSettings.value.columns || 2))}, minmax(0, 1fr))` }))
const printLabelStyle = computed(() => ({ minHeight: `${Math.max(15, Number(printSettings.value.labelHeight || 30)) * 3.2}px`, fontSize: `${Math.max(8, Number(printSettings.value.fontSize || 12))}px` }))
const openPrint = (): void => { if (!printRows.value.length) ElMessage.warning('没有可打印的资产'); else printOpen.value = true }
const printNow = (): void => window.print()

const statusType = (value: string): 'success' | 'warning' | 'info' | 'danger' => {
  if (value === '在用') return 'success'
  if (value === '借用中') return 'warning'
  if (value === '维修中') return 'danger'
  return 'info'
}
onMounted(() => void load())
</script>

<template>
  <section :class="mode === 'list' ? 'asset-list-page asset-directory-view' : 'standard-business-view asset-directory-view'">
    <template v-if="mode === 'list'">
      <div class="asset-list-toolbar">
        <div class="asset-list-actions">
          <button v-if="can('asset:item:create')" class="table-action primary" type="button" @click="openCreate()">＋ 新增</button>
          <el-dropdown placement="bottom-start" trigger="click">
            <button class="table-action has-caret" type="button">操作<span class="action-caret" aria-hidden="true"></span></button>
            <template #dropdown><el-dropdown-menu>
              <el-dropdown-item v-if="can('asset:item:receive')" @click="openActionForIds(selected, 'receive')">领用</el-dropdown-item>
              <el-dropdown-item v-if="can('asset:item:borrow')" @click="openActionForIds(selected, 'borrow')">借用</el-dropdown-item>
              <el-dropdown-item v-if="can('asset:item:return')" @click="openActionForIds(selected, 'return')">领用退还</el-dropdown-item>
              <el-dropdown-item v-if="can('asset:item:borrowReturn')" @click="openActionForIds(selected, 'borrow-return')">借用归还</el-dropdown-item>
              <el-dropdown-item v-if="can('asset:item:handover')" @click="openActionForIds(selected, 'handover')">资产交接</el-dropdown-item>
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
              <el-dropdown-item v-if="can('asset:item:export')" @click="exportAssets">导出资产</el-dropdown-item>
            </el-dropdown-menu></template>
          </el-dropdown>
          <button v-if="can('asset:item:printLabel')" class="table-action" type="button" @click="openPrint">打印标签</button>
          <a v-if="exportUrl" ref="exportLink" :href="exportUrl" :download="`资产列表_${new Date().toISOString().slice(0, 10)}.csv`" hidden>下载</a>
        </div>
        <div class="asset-list-search">
          <input v-model="query" class="local-search" type="search" placeholder="搜索" autocomplete="off" aria-label="搜索资产">
          <button class="table-action primary" type="button" aria-label="查询资产" @click="page = 1">⌕</button>
        </div>
      </div>

      <el-alert v-if="state.errorMessage" :title="state.errorMessage" type="error" show-icon :closable="false" />
      <div v-loading="state.loading" class="asset-table-shell" :class="`density-${legacyDensity}`">
        <div class="asset-table-actions">
          <button v-if="can('asset:item:advancedSearch')" class="link" type="button" @click="advancedOpen = true">高级搜索</button>
          <el-popover v-if="can('asset:item:columnSettings')" placement="bottom-end" :width="300" trigger="click">
            <template #reference><button class="list-settings-button" type="button" title="列表设置" aria-label="列表设置">⚙</button></template>
            <div class="standard-column-settings legacy-column-settings">
              <div class="legacy-column-settings__head"><strong>显示字段</strong><button type="button" @click="resetLegacySettings">重置</button></div>
              <div class="legacy-column-settings__grid"><el-checkbox v-for="item in legacyColumns" :key="item.key" :model-value="legacyVisibleColumns.includes(item.key)" @change="toggleLegacyColumn(item.key, $event === true)">{{ item.label }}</el-checkbox></div>
              <strong>表格密度</strong>
              <el-radio-group v-model="legacyDensity" size="small"><el-radio-button value="compact">紧凑</el-radio-button><el-radio-button value="standard">标准</el-radio-button><el-radio-button value="roomy">宽松</el-radio-button></el-radio-group>
            </div>
          </el-popover>
        </div>
        <div class="asset-table-scroll">
          <table class="asset-list-table" :style="{ minWidth: `${legacyTableMinWidth}px` }">
            <colgroup><col style="width: 36px"><col v-for="column in legacyDisplayedColumns" :key="column.key" :style="{ width: `${column.width}px` }"></colgroup>
            <thead><tr><th class="asset-list-select-cell"><input type="checkbox" aria-label="全选" :checked="allPageSelected" :disabled="!paged.length" @change="togglePageSelection(($event.target as HTMLInputElement).checked)"></th><th v-for="column in legacyDisplayedColumns" :key="column.key" :data-column-key="column.key">{{ column.label }}</th></tr></thead>
            <tbody>
              <tr v-for="item in paged" :key="item.id">
                <td class="asset-list-select-cell"><input type="checkbox" :aria-label="`选择${item.id}`" :checked="selectedIds.has(item.id)" @change="toggleAssetSelection(item, ($event.target as HTMLInputElement).checked)"></td>
                <td v-for="column in legacyDisplayedColumns" :key="column.key">
                  <span v-if="column.key === 'status'" class="asset-status-pill" :class="legacyStatusClass(item.status)">{{ item.status || '-' }}</span>
                  <button v-else-if="column.key === 'code'" class="link" type="button" @click="detail = item">{{ item.id }}</button>
                  <template v-else>{{ legacyCellValue(item, column.key) }}</template>
                </td>
              </tr>
              <tr v-if="!paged.length" class="empty-row"><td :colspan="legacyDisplayedColumns.length + 1">{{ query ? '没有匹配的资产结果。' : '当前账号下暂无资产。' }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="asset-list-pagination">
        <span>共 {{ filtered.length }} 条</span>
        <button class="page-btn" type="button" aria-label="上一页" :disabled="page <= 1" @click="page--">‹</button>
        <template v-for="(item, index) in paginationItems" :key="`${item}-${index}`"><span v-if="item === 'ellipsis'" class="page-ellipsis">…</span><button v-else class="page-btn" :class="{ active: item === page }" type="button" :aria-current="item === page ? 'page' : undefined" @click="page = item">{{ item }}</button></template>
        <button class="page-btn" type="button" aria-label="下一页" :disabled="page >= pageCount" @click="page++">›</button>
        <select v-model.number="pageSize" aria-label="每页条数"><option :value="20">20 条/页</option><option :value="50">50 条/页</option></select>
        <span>跳至</span><input v-model.number="jumpPage" aria-label="跳转页码" inputmode="numeric" @keydown.enter="goToJumpPage"><span>页</span>
      </div>
    </template>

    <template v-else>
    <header class="standard-page-header">
      <div><h1>{{ title }}</h1><p>{{ subtitleByMode[mode] }}</p></div>
      <div class="standard-header-actions">
        <el-button :icon="Refresh" @click="refresh">刷新</el-button>
        <el-button v-if="mode === 'inbound' && can('asset:item:assetImport')" :icon="Upload" @click="openImport('asset')">导入资产</el-button>
        <el-button v-if="mode === 'inbound' && can('asset:item:create')" type="primary" :icon="Plus" @click="openCreate()">新增资产</el-button>
      </div>
    </header>

    <div class="standard-toolbar">
      <el-input v-model="query" clearable :prefix-icon="Search" placeholder="搜索资产编码、名称、人员或位置" />
      <el-select v-model="category"><el-option label="全部分类" value="全部" /><el-option v-for="item in categories" :key="item" :label="item" :value="item" /></el-select>
      <el-select v-model="status"><el-option label="全部状态" value="全部" /><el-option v-for="item in statuses" :key="item" :label="item" :value="item" /></el-select>
      <el-button @click="reset">重置</el-button>
      <el-button v-if="can('asset:item:advancedSearch')" :icon="Filter" @click="advancedOpen = true">高级筛选</el-button>
      <span class="standard-toolbar-spacer"></span>
      <span v-if="selected.length" class="standard-selection-count">已选 {{ selected.length }} 项</span>
      <el-button v-if="mode !== 'inbound' && selected.length" type="primary" @click="openSelectedWorkflow">批量{{ actionFor(selected[0]) ? actionLabel(actionFor(selected[0])!) : '操作' }}</el-button>
      <el-button v-if="can('asset:item:printLabel')" :icon="Printer" @click="openPrint">打印</el-button>
      <el-button v-if="can('asset:item:export')" :icon="Download" @click="exportAssets">导出</el-button>
      <el-popover v-if="can('asset:item:columnSettings')" placement="bottom-end" :width="260" trigger="click">
        <template #reference><el-button :icon="Setting" circle aria-label="列表设置" /></template>
        <div class="standard-column-settings"><strong>显示字段</strong><el-checkbox-group v-model="visibleColumns"><el-checkbox v-for="item in columnOptions" :key="item.key" :value="item.key">{{ item.label }}</el-checkbox></el-checkbox-group><el-button link type="primary" @click="visibleColumns = [...defaultColumns]">恢复默认</el-button></div>
      </el-popover>
      <a v-if="exportUrl" ref="exportLink" :href="exportUrl" :download="`资产列表_${new Date().toISOString().slice(0, 10)}.csv`" hidden>下载</a>
    </div>

    <el-alert v-if="state.errorMessage" :title="state.errorMessage" type="error" show-icon :closable="false" />
    <div class="standard-table-shell">
      <el-table v-loading="state.loading" :data="paged" row-key="id" height="100%" @selection-change="selected = $event">
        <el-table-column type="selection" width="46" />
        <el-table-column v-if="hasColumn('id')" prop="id" label="资产编码" min-width="130" fixed="left" />
        <el-table-column v-if="hasColumn('name')" prop="name" label="资产名称" min-width="160" show-overflow-tooltip />
        <el-table-column v-if="hasColumn('category')" prop="category" label="资产分类" min-width="130" />
        <el-table-column v-if="hasColumn('status')" label="状态" width="90"><template #default="scope"><el-tag :type="statusType(scope.row.status)" effect="light">{{ scope.row.status || '-' }}</el-tag></template></el-table-column>
        <el-table-column v-if="hasColumn('owner')" prop="owner" label="使用人" min-width="120" show-overflow-tooltip />
        <el-table-column v-if="hasColumn('department')" prop="department" label="使用部门" min-width="150" show-overflow-tooltip />
        <el-table-column v-if="hasColumn('location')" prop="location" label="所在位置" min-width="180" show-overflow-tooltip />
        <el-table-column v-if="hasColumn('brand')" prop="brand" label="品牌" min-width="120" show-overflow-tooltip />
        <el-table-column v-if="hasColumn('model')" prop="model" label="型号" min-width="130" show-overflow-tooltip />
        <el-table-column v-if="hasColumn('sn')" prop="sn" label="序列号" min-width="150" show-overflow-tooltip />
        <el-table-column v-if="hasColumn('supplier')" prop="supplier" label="供应商" min-width="160" show-overflow-tooltip />
        <el-table-column v-if="hasColumn('price')" label="金额" width="120"><template #default="scope">{{ Number(scope.row.price || 0).toLocaleString('zh-CN') }}</template></el-table-column>
        <el-table-column v-if="hasColumn('purchaseDate')" prop="purchaseDate" label="购置日期" width="120" />
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="detail = scope.row">详情</el-button>
            <el-button v-if="actionFor(scope.row)" link type="primary" @click="openAction(scope.row, actionFor(scope.row)!)">{{ actionLabel(actionFor(scope.row)!) }}</el-button>
            <el-dropdown v-if="mode === 'inbound'" trigger="click">
              <el-button link type="primary">更多</el-button>
              <template #dropdown><el-dropdown-menu>
                <el-dropdown-item v-if="can('asset:item:update')" @click="openEdit([scope.row])">修改</el-dropdown-item>
                <el-dropdown-item v-if="can('asset:item:copy')" @click="openCreate(scope.row)">复制资产</el-dropdown-item>
                <el-dropdown-item v-if="mode === 'inbound' && can('asset:inbound:cancel')" @click="openAction(scope.row, 'cancel-inbound')">撤销入库</el-dropdown-item>
                <el-dropdown-item v-if="can('asset:item:delete')" divided @click="removeAssets([scope.row])">删除</el-dropdown-item>
              </el-dropdown-menu></template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div class="standard-pagination"><span>共 {{ filtered.length }} 条</span><el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="filtered.length" :page-sizes="[20, 50, 100]" layout="prev, pager, next, sizes" /></div>
    </template>

    <el-drawer v-model="advancedOpen" title="高级筛选" size="min(620px, 92vw)" append-to-body>
      <el-form label-position="top" class="standard-form-grid">
        <el-form-item label="资产编码"><el-input v-model="advanced.id" /></el-form-item><el-form-item label="资产名称"><el-input v-model="advanced.name" /></el-form-item>
        <el-form-item label="品牌/类型"><el-input v-model="advanced.type" /></el-form-item><el-form-item label="型号"><el-input v-model="advanced.model" /></el-form-item>
        <el-form-item label="设备序列号"><el-input v-model="advanced.sn" /></el-form-item><el-form-item label="使用人"><el-input v-model="advanced.owner" /></el-form-item>
        <el-form-item label="所属部门"><el-input v-model="advanced.department" /></el-form-item><el-form-item label="所在位置"><el-input v-model="advanced.location" /></el-form-item>
        <el-form-item label="供应商"><el-input v-model="advanced.supplier" /></el-form-item><el-form-item label="风险状态"><el-input v-model="advanced.risk" /></el-form-item>
        <el-form-item label="资产标签"><el-input v-model="advanced.tag" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="clearAdvanced">重置</el-button><el-button type="primary" @click="advancedOpen = false; page = 1">查询</el-button></template>
    </el-drawer>

    <el-drawer :model-value="Boolean(detail)" class="standard-detail-drawer asset-vue-detail-drawer" aria-label="资产详情" size="min(760px, 92vw)" :with-header="false" append-to-body @close="detail = null">
      <template v-if="detail">
        <div class="standard-drawer-header"><div><span>资产详情</span><h2>{{ detail.name }}</h2><p>{{ detail.id }}</p></div><el-tag :type="statusType(detail.status)">{{ detail.status }}</el-tag></div>
        <el-descriptions :column="2" border class="standard-descriptions">
          <el-descriptions-item label="资产分类">{{ detail.category || detail.type || '-' }}</el-descriptions-item><el-descriptions-item label="资产状况">{{ detail.condition || detail.status || '-' }}</el-descriptions-item>
          <el-descriptions-item label="使用人">{{ detail.owner || '-' }}</el-descriptions-item><el-descriptions-item label="使用部门">{{ detail.department || '-' }}</el-descriptions-item>
          <el-descriptions-item label="使用公司">{{ detail.company || '-' }}</el-descriptions-item><el-descriptions-item label="所在位置">{{ detail.location || '-' }}</el-descriptions-item>
          <el-descriptions-item label="品牌">{{ detail.brand || '-' }}</el-descriptions-item><el-descriptions-item label="型号">{{ detail.model || '-' }}</el-descriptions-item>
          <el-descriptions-item label="序列号">{{ detail.sn || '-' }}</el-descriptions-item><el-descriptions-item label="管理员">{{ detail.custodian || '-' }}</el-descriptions-item>
          <el-descriptions-item label="供应商">{{ detail.supplier || '-' }}</el-descriptions-item><el-descriptions-item label="金额">{{ Number(detail.price || 0).toLocaleString('zh-CN') }} 元</el-descriptions-item>
          <el-descriptions-item label="购置日期">{{ detail.purchaseDate || '-' }}</el-descriptions-item><el-descriptions-item label="维保到期">{{ detail.warrantyDate || '-' }}</el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">{{ detail.note || '-' }}</el-descriptions-item>
        </el-descriptions>
        <section class="standard-detail-section"><h3>操作记录</h3><el-timeline><el-timeline-item v-for="(item, index) in detail.lifecycle || []" :key="index" :timestamp="item[0]">{{ item[1] }} · {{ item[2] }}</el-timeline-item><el-empty v-if="!detail.lifecycle?.length" description="暂无操作记录" :image-size="72" /></el-timeline></section>
      </template>
    </el-drawer>

    <el-dialog v-model="createOpen" :title="copySourceId ? '复制资产' : '新增资产'" width="min(900px, 94vw)" destroy-on-close append-to-body>
      <el-form ref="createFormRef" :model="createDraft" :rules="createRules" label-position="top" class="standard-form-grid">
        <el-form-item label="资产名称" prop="name"><el-input v-model="createDraft.name" /></el-form-item><el-form-item label="资产分类" prop="category"><el-select v-model="createDraft.category" filterable allow-create><el-option v-for="item in categories" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="所在位置" prop="location"><el-input v-model="createDraft.location" /></el-form-item><el-form-item label="使用公司"><el-input v-model="createDraft.company" /></el-form-item>
        <el-form-item label="使用部门"><el-input v-model="createDraft.department" /></el-form-item><el-form-item label="资产管理员"><el-input v-model="createDraft.custodian" /></el-form-item>
        <el-form-item label="品牌"><el-input v-model="createDraft.brand" /></el-form-item><el-form-item label="型号"><el-input v-model="createDraft.model" /></el-form-item>
        <el-form-item label="序列号"><el-input v-model="createDraft.sn" /></el-form-item><el-form-item label="资产标签"><el-input v-model="createDraft.assetTag" /></el-form-item>
        <el-form-item label="供应商"><el-input v-model="createDraft.supplier" /></el-form-item><el-form-item label="购置日期"><el-date-picker v-model="createDraft.purchaseDate" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="购置方式"><el-input v-model="createDraft.purchaseMethod" /></el-form-item><el-form-item label="订单号"><el-input v-model="createDraft.orderNo" /></el-form-item>
        <el-form-item label="计量单位"><el-input v-model="createDraft.unit" /></el-form-item><el-form-item label="金额"><el-input-number v-model="createDraft.price" :min="0" :precision="2" /></el-form-item>
        <el-form-item label="备注" class="standard-form-span"><el-input v-model="createDraft.note" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="createOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitCreate">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="editOpen" :title="editAction === 'edit' ? '修改资产' : `批量修改 ${editIds.length} 项资产`" width="min(820px, 94vw)" append-to-body>
      <el-alert v-if="editAction === 'batch-edit'" title="只会更新已填写的字段，留空字段保持原值。" type="info" :closable="false" />
      <el-form label-position="top" class="standard-form-grid standard-dialog-form">
        <el-form-item label="资产名称"><el-input v-model="editForm.name" /></el-form-item><el-form-item label="资产分类"><el-input v-model="editForm.category" /></el-form-item>
        <el-form-item label="使用公司"><el-input v-model="editForm.company" /></el-form-item><el-form-item label="使用部门"><el-input v-model="editForm.department" /></el-form-item>
        <el-form-item label="所在位置"><el-input v-model="editForm.location" /></el-form-item><el-form-item label="资产管理员"><el-input v-model="editForm.custodian" /></el-form-item>
        <el-form-item label="品牌"><el-input v-model="editForm.brand" /></el-form-item><el-form-item label="型号"><el-input v-model="editForm.model" /></el-form-item>
        <el-form-item label="供应商"><el-input v-model="editForm.supplier" /></el-form-item><el-form-item label="购置日期"><el-date-picker v-model="editForm.purchaseDate" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="金额"><el-input-number v-model="editForm.price" :min="0" :precision="2" /></el-form-item><el-form-item label="备注"><el-input v-model="editForm.note" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="editOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitEdit">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="actionOpen" :title="`${actionLabel(actionForm.action)}资产`" width="min(620px, 94vw)" append-to-body>
      <el-form label-position="top">
        <el-alert v-if="actionForm.action === 'cancel-inbound'" title="撤销后对应资产将从资产列表移除，请确认尚未投入使用。" type="warning" :closable="false" />
        <el-form-item v-if="needsPerson" label="关联 ECP 人员" required><el-autocomplete v-model="actionForm.person" :fetch-suggestions="personSearch" placeholder="搜索姓名、账号或邮箱" style="width: 100%" @select="selectPerson"><template #default="{ item }"><div class="standard-person-option"><strong>{{ item.name }}</strong><span>{{ item.account }} · {{ item.department }}</span></div></template></el-autocomplete></el-form-item>
        <el-form-item v-if="actionForm.action !== 'cancel-inbound'" label="资产位置" required><el-input v-model="actionForm.location" /></el-form-item>
        <el-form-item label="操作日期"><el-date-picker v-model="actionForm.date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item v-if="actionForm.action === 'borrow'" label="预计归还日期" required><el-date-picker v-model="actionForm.expectedReturnDate" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="actionForm.note" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="actionOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitAction">确认{{ actionLabel(actionForm.action) }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="importOpen" :title="importTitle" width="min(900px, 94vw)" append-to-body>
      <div class="standard-import-panel">
        <div class="standard-import-actions"><label class="el-button el-button--primary"><input type="file" accept=".xlsx" hidden @change="readImportFile">选择 Excel 文件</label><a class="el-button" href="/assets/asset-import-template.xlsx" download>下载导入模板</a><span>{{ importFileName || '仅支持 .xlsx 文件' }}</span></div>
        <el-alert :title="importMode === 'asset' ? '导入前会校验资产名称、分类、位置和金额；错误行不会提交。' : importMode === 'update' ? '按资产编码更新已填写字段，空白字段保持原值。' : '按资产编码、ECP 人员和领用日期批量领用资产。'" type="info" :closable="false" />
        <el-table v-loading="parsing" :data="importRows" height="360"><el-table-column prop="rowNumber" label="行号" width="70" /><el-table-column v-if="importMode !== 'asset'" label="资产编码" min-width="130"><template #default="scope">{{ scope.row.draft?.id || '-' }}</template></el-table-column><el-table-column label="资产名称" min-width="150"><template #default="scope">{{ scope.row.draft?.name || '-' }}</template></el-table-column><el-table-column v-if="importMode === 'asset'" label="资产分类" min-width="130"><template #default="scope">{{ scope.row.draft?.category || '-' }}</template></el-table-column><el-table-column label="所在位置" min-width="140"><template #default="scope">{{ scope.row.draft?.location || '-' }}</template></el-table-column><el-table-column v-if="importMode === 'receive'" label="领用人" min-width="120"><template #default="scope">{{ scope.row.draft?.owner || scope.row.draft?.ownerSubject || '-' }}</template></el-table-column><el-table-column label="校验结果" min-width="220"><template #default="scope"><el-tag v-if="!scope.row.errors.length" type="success">可导入</el-tag><span v-else class="standard-import-error">{{ scope.row.errors.join('；') }}</span></template></el-table-column></el-table>
        <p v-if="importRows.length">可导入 {{ validImportRows.length }} 条，错误 {{ invalidImportCount }} 条</p>
      </div>
      <template #footer><el-button @click="importOpen = false">取消</el-button><el-button type="primary" :disabled="!validImportRows.length" :loading="submitting" @click="submitImport">确认{{ importTitle }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="printOpen" title="资产标签打印预览" width="min(900px, 94vw)" append-to-body class="standard-print-dialog">
      <div class="standard-print-grid" :style="printGridStyle"><article v-for="item in printRows" :key="item.id" class="standard-print-label" :style="printLabelStyle"><strong v-if="printSettings.showLogo">{{ printSettings.logoText || '资产云管家' }}</strong><span v-for="field in printFields" :key="field"><small>{{ printFieldLabels[field] || field }}</small>{{ item[field] || '-' }}</span><i class="standard-print-qr">QR</i></article></div>
      <template #footer><el-button @click="printOpen = false">取消</el-button><el-button type="primary" :icon="Printer" @click="printNow">打印</el-button></template>
    </el-dialog>
  </section>
</template>
