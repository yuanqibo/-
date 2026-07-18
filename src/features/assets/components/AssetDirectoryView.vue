<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { Download, Plus, Refresh, Search, Setting } from '@element-plus/icons-vue'
import { usePortalSession } from '../../../core/auth/portal-session'
import { searchDirectoryPeople } from '../api/assets.api'
import { useAssets } from '../composables/useAssets'
import type { AssetCommand, AssetDraft, AssetRecord, DirectoryPerson } from '../types/assets'

const props = withDefaults(defineProps<{ mode?: 'list' | 'inbound' | 'receive-return' | 'borrow-return' }>(), { mode: 'list' })
const { state, assets, load, create, command } = useAssets()
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
const submitting = ref(false)
const createFormRef = ref<FormInstance>()
const people = ref<DirectoryPerson[]>([])

const titleByMode = {
  list: '资产列表',
  inbound: '资产入库',
  'receive-return': '领用退库',
  'borrow-return': '借用归还'
}

const subtitleByMode = {
  list: '统一查看资产状态、归属、位置与生命周期信息。',
  inbound: '登记新资产并查看入库记录，资产写入继续由 Java 服务完成。',
  'receive-return': '管理员工领用、退库和资产交接记录。',
  'borrow-return': '管理资产借用、预计归还日期与归还状态。'
}

const title = computed(() => titleByMode[props.mode])
const permissions = computed(() => new Set(user.value?.permissionCodes || []))
const can = (code: string): boolean => permissions.value.has(code)

const categories = computed(() => Array.from(new Set(assets.value.map((item) => item.category).filter(Boolean))).sort())
const statuses = computed(() => Array.from(new Set(assets.value.map((item) => item.status).filter(Boolean))).sort())
const searchable = (item: AssetRecord): string => [item.id, item.name, item.assetTag, item.owner, item.department, item.location, item.model, item.sn]
  .map((value) => String(value || '').toLowerCase()).join(' ')

const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return assets.value.filter((item) => {
    const modeMatch = props.mode === 'receive-return'
      ? ['闲置', '在用'].includes(item.status)
      : props.mode === 'borrow-return'
        ? ['闲置', '借用中'].includes(item.status)
        : true
    return modeMatch
      && (!keyword || searchable(item).includes(keyword))
      && (status.value === '全部' || item.status === status.value)
      && (category.value === '全部' || item.category === category.value)
  })
})

const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const reset = (): void => { query.value = ''; status.value = '全部'; category.value = '全部'; page.value = 1 }
const refresh = async (): Promise<void> => { await load(true); ElMessage.success('数据已刷新') }

const createDraft = reactive<AssetDraft>({
  name: '', category: '', type: '设备', status: '闲置', location: '', company: '', department: '',
  owner: '未分配', custodian: '', brand: '', model: '', sn: '', assetTag: '', supplier: '', price: 0,
  purchaseDate: new Date().toISOString().slice(0, 10)
})

const createRules: FormRules = {
  name: [{ required: true, message: '请输入资产名称', trigger: 'blur' }],
  category: [{ required: true, message: '请选择资产分类', trigger: 'change' }],
  location: [{ required: true, message: '请输入所在位置', trigger: 'blur' }]
}

const openCreate = (): void => {
  Object.assign(createDraft, { name: '', category: categories.value[0] || '', type: '设备', status: '闲置', location: '', company: user.value?.company || '', department: '', owner: '未分配', custodian: user.value?.name || '', brand: '', model: '', sn: '', assetTag: '', supplier: '', price: 0, purchaseDate: new Date().toISOString().slice(0, 10) })
  createOpen.value = true
}

const submitCreate = async (): Promise<void> => {
  if (!await createFormRef.value?.validate().catch(() => false)) return
  submitting.value = true
  try {
    await create({ ...createDraft })
    createOpen.value = false
    ElMessage.success('资产已新增')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '新增资产失败')
  } finally { submitting.value = false }
}

type ActionForm = { action: AssetCommand; assetIds: string[]; person: string; personSubject: string; location: string; date: string; expectedReturnDate: string; note: string }
const actionForm = reactive<ActionForm>({ action: 'receive', assetIds: [], person: '', personSubject: '', location: '', date: new Date().toISOString().slice(0, 10), expectedReturnDate: '', note: '' })

const openAction = (item: AssetRecord, action: AssetCommand): void => {
  Object.assign(actionForm, { action, assetIds: [item.id], person: '', personSubject: '', location: item.location || '', date: new Date().toISOString().slice(0, 10), expectedReturnDate: '', note: '' })
  actionOpen.value = true
}

const actionLabel = (action: AssetCommand): string => ({ receive: '领用', return: '退库', borrow: '借用', 'borrow-return': '归还', handover: '交接' }[action])

const actionFor = (item: AssetRecord): AssetCommand | null => {
  if (props.mode === 'receive-return') return item.status === '在用' ? 'return' : 'receive'
  if (props.mode === 'borrow-return') return item.status === '借用中' ? 'borrow-return' : 'borrow'
  return null
}

const needsPerson = computed(() => ['receive', 'borrow', 'handover'].includes(actionForm.action))
const personSearch = async (keyword: string, callback: (values: Array<DirectoryPerson & { value: string }>) => void): Promise<void> => {
  try {
    people.value = await searchDirectoryPeople(keyword)
    callback(people.value.map((item) => ({ ...item, value: `${item.name} · ${item.account || item.email}` })))
  } catch { callback([]) }
}
const selectPerson = (person: DirectoryPerson): void => {
  actionForm.person = person.name
  actionForm.personSubject = person.subject
}

const submitAction = async (): Promise<void> => {
  if (needsPerson.value && !actionForm.personSubject) { ElMessage.warning('请搜索并选择 ECP 人员'); return }
  submitting.value = true
  try {
    const fields: Record<string, unknown> = { location: actionForm.location, date: actionForm.date, note: actionForm.note }
    if (actionForm.action === 'receive') Object.assign(fields, { receiver: actionForm.person, receiverSubject: actionForm.personSubject })
    if (actionForm.action === 'borrow') Object.assign(fields, { borrower: actionForm.person, borrowerSubject: actionForm.personSubject, expectedReturnDate: actionForm.expectedReturnDate })
    if (actionForm.action === 'handover') Object.assign(fields, { receiver: actionForm.person, receiverSubject: actionForm.personSubject, handoverType: '员工交接' })
    await command(actionForm.action, actionForm.assetIds, fields)
    actionOpen.value = false
    ElMessage.success(`${actionLabel(actionForm.action)}操作已完成`)
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '资产操作失败') }
  finally { submitting.value = false }
}

const statusType = (value: string): 'success' | 'warning' | 'info' | 'danger' => {
  if (value === '在用') return 'success'
  if (value === '借用中') return 'warning'
  if (value === '维修中') return 'danger'
  return 'info'
}

onMounted(() => void load())
</script>

<template>
  <section class="standard-business-view asset-directory-view">
    <header class="standard-page-header">
      <div><h1>{{ title }}</h1><p>{{ subtitleByMode[mode] }}</p></div>
      <div class="standard-header-actions">
        <el-button :icon="Refresh" @click="refresh">刷新</el-button>
        <el-button v-if="mode === 'inbound' && can('asset:item:create')" type="primary" :icon="Plus" @click="openCreate">新增资产</el-button>
      </div>
    </header>

    <div class="standard-toolbar">
      <el-input v-model="query" clearable :prefix-icon="Search" placeholder="搜索资产编码、名称、人员或位置" @input="page = 1" />
      <el-select v-model="category" @change="page = 1"><el-option label="全部分类" value="全部" /><el-option v-for="item in categories" :key="item" :label="item" :value="item" /></el-select>
      <el-select v-model="status" @change="page = 1"><el-option label="全部状态" value="全部" /><el-option v-for="item in statuses" :key="item" :label="item" :value="item" /></el-select>
      <el-button @click="reset">重置</el-button>
      <span class="standard-toolbar-spacer"></span>
      <span v-if="selected.length" class="standard-selection-count">已选 {{ selected.length }} 项</span>
      <el-button :icon="Download">导出</el-button><el-button :icon="Setting" circle aria-label="列表设置" />
    </div>

    <el-alert v-if="state.errorMessage" :title="state.errorMessage" type="error" show-icon :closable="false" />
    <div class="standard-table-shell">
      <el-table v-loading="state.loading" :data="paged" row-key="id" height="100%" @selection-change="selected = $event">
        <el-table-column type="selection" width="46" />
        <el-table-column prop="id" label="资产编码" min-width="130" fixed="left" />
        <el-table-column prop="name" label="资产名称" min-width="160" show-overflow-tooltip />
        <el-table-column prop="category" label="资产分类" min-width="130" />
        <el-table-column label="状态" width="90"><template #default="scope"><el-tag :type="statusType(scope.row.status)" effect="light">{{ scope.row.status || '-' }}</el-tag></template></el-table-column>
        <el-table-column prop="owner" label="使用人" min-width="120" show-overflow-tooltip />
        <el-table-column prop="department" label="使用部门" min-width="150" show-overflow-tooltip />
        <el-table-column prop="location" label="所在位置" min-width="180" show-overflow-tooltip />
        <el-table-column prop="model" label="型号" min-width="130" show-overflow-tooltip />
        <el-table-column prop="sn" label="序列号" min-width="150" show-overflow-tooltip />
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="detail = scope.row">详情</el-button>
            <el-button v-if="actionFor(scope.row)" link type="primary" @click="openAction(scope.row, actionFor(scope.row)!)">{{ actionLabel(actionFor(scope.row)!) }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div class="standard-pagination"><span>共 {{ filtered.length }} 条</span><el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="filtered.length" :page-sizes="[20, 50, 100]" layout="prev, pager, next, sizes" /></div>

    <el-drawer :model-value="Boolean(detail)" class="standard-detail-drawer asset-vue-detail-drawer" size="min(760px, 92vw)" :with-header="false" append-to-body @close="detail = null">
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

    <el-dialog v-model="createOpen" title="新增资产" width="min(860px, 94vw)" destroy-on-close append-to-body>
      <el-form ref="createFormRef" :model="createDraft" :rules="createRules" label-position="top" class="standard-form-grid">
        <el-form-item label="资产名称" prop="name"><el-input v-model="createDraft.name" /></el-form-item>
        <el-form-item label="资产分类" prop="category"><el-select v-model="createDraft.category" filterable allow-create><el-option v-for="item in categories" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="所在位置" prop="location"><el-input v-model="createDraft.location" /></el-form-item>
        <el-form-item label="使用公司"><el-input v-model="createDraft.company" /></el-form-item>
        <el-form-item label="品牌"><el-input v-model="createDraft.brand" /></el-form-item><el-form-item label="型号"><el-input v-model="createDraft.model" /></el-form-item>
        <el-form-item label="序列号"><el-input v-model="createDraft.sn" /></el-form-item><el-form-item label="资产标签"><el-input v-model="createDraft.assetTag" /></el-form-item>
        <el-form-item label="供应商"><el-input v-model="createDraft.supplier" /></el-form-item><el-form-item label="购置日期"><el-date-picker v-model="createDraft.purchaseDate" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="金额"><el-input-number v-model="createDraft.price" :min="0" :precision="2" /></el-form-item><el-form-item label="备注"><el-input v-model="createDraft.note" type="textarea" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="createOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitCreate">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="actionOpen" :title="`${actionLabel(actionForm.action)}资产`" width="min(620px, 94vw)" append-to-body>
      <el-form label-position="top">
        <el-form-item v-if="needsPerson" label="关联 ECP 人员" required>
          <el-autocomplete v-model="actionForm.person" :fetch-suggestions="personSearch" placeholder="搜索姓名、账号或邮箱" style="width: 100%" @select="selectPerson"><template #default="{ item }"><div class="standard-person-option"><strong>{{ item.name }}</strong><span>{{ item.account }} · {{ item.department }}</span></div></template></el-autocomplete>
        </el-form-item>
        <el-form-item label="资产位置" required><el-input v-model="actionForm.location" /></el-form-item>
        <el-form-item label="操作日期"><el-date-picker v-model="actionForm.date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item v-if="actionForm.action === 'borrow'" label="预计归还日期" required><el-date-picker v-model="actionForm.expectedReturnDate" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="actionForm.note" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="actionOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitAction">确认{{ actionLabel(actionForm.action) }}</el-button></template>
    </el-dialog>
  </section>
</template>
