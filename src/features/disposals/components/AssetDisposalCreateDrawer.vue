<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Delete, Search, Upload } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { usePortalSession } from '../../../core/auth/portal-session'
import { useAssets } from '../../assets/composables/useAssets'
import { displayAssetCode, type AssetRecord } from '../../assets/types/assets'
import { useDisposals } from '../composables/useDisposals'
import type { DisposalDraft, DisposalRecord } from '../types/disposal'
import { matchesPinyinSearch } from '../../../shared/search/pinyin-search'

const props = withDefaults(defineProps<{
  modelValue: boolean
  presetAssetIds?: string[]
}>(), { presetAssetIds: () => [] })

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'created', value: DisposalRecord): void
}>()

const disposalTypes = ['退租', '报废', '捐赠', '变卖', '其他']
const { user } = usePortalSession()
const { assets, load: loadAssets } = useAssets()
const { create } = useDisposals()
const assetPickerOpen = ref(false)
const submitting = ref(false)
const selectedAssetIds = ref<string[]>([])
const selectedAssetRowIds = ref<string[]>([])
const disposalImportInput = ref<HTMLInputElement>()
const pickerAssetIds = ref<string[]>([])
const pickerQuery = ref('')

const opened = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})
const today = (): string => new Date().toISOString().slice(0, 10)
const form = reactive<DisposalDraft>({
  disposalType: '', company: '', operator: '', amount: undefined, fee: undefined,
  description: '', returnDate: today(), assetIds: []
})

const availableAssets = computed(() => assets.value.filter((asset) => asset.status === '空闲'))
const selectedAssets = computed(() => availableAssets.value.filter((asset) => selectedAssetIds.value.includes(asset.id)))
const selectedSubmissionAssetIds = computed(() => selectedAssetIds.value.filter((id) => selectedAssetRowIds.value.includes(id)))
const pickerAssets = computed(() => {
  return availableAssets.value.filter((asset) => matchesPinyinSearch(
    [displayAssetCode(asset), asset.id, asset.name, asset.category, asset.brand, asset.model, asset.sn, asset.supplier, asset.location], pickerQuery.value))
})
const allPickerAssetsSelected = computed(() => pickerAssets.value.length > 0
  && pickerAssets.value.every((asset) => pickerAssetIds.value.includes(asset.id)))
const allSelectedRowsMarked = computed(() => selectedAssets.value.length > 0
  && selectedAssets.value.every((asset) => selectedAssetRowIds.value.includes(asset.id)))

const resetForm = (presetIds: string[]): void => {
  Object.assign(form, {
    disposalType: '', company: user.value?.company || '', operator: user.value?.name || '',
    amount: undefined, fee: undefined, description: '', returnDate: today(), assetIds: []
  })
  selectedAssetIds.value = presetIds.filter((id) => availableAssets.value.some((asset) => asset.id === id))
  selectedAssetRowIds.value = []
  pickerAssetIds.value = []
  pickerQuery.value = ''
  assetPickerOpen.value = false
}

watch(() => props.modelValue, async (value) => {
  if (!value) return
  await loadAssets()
  resetForm(props.presetAssetIds)
}, { immediate: true })

const openAssetPicker = (): void => {
  pickerAssetIds.value = [...selectedAssetIds.value]
  pickerQuery.value = ''
  assetPickerOpen.value = true
}
const togglePickerAsset = (asset: AssetRecord, checked: boolean): void => {
  pickerAssetIds.value = checked
    ? [...new Set([...pickerAssetIds.value, asset.id])]
    : pickerAssetIds.value.filter((id) => id !== asset.id)
}
const toggleAllPickerAssets = (checked: boolean): void => {
  const visibleIds = new Set(pickerAssets.value.map((asset) => asset.id))
  pickerAssetIds.value = checked
    ? [...new Set([...pickerAssetIds.value, ...visibleIds])]
    : pickerAssetIds.value.filter((id) => !visibleIds.has(id))
}
const confirmAssetPicker = (): void => {
  selectedAssetIds.value = [...pickerAssetIds.value]
  selectedAssetRowIds.value = selectedAssetRowIds.value.filter((id) => selectedAssetIds.value.includes(id))
  assetPickerOpen.value = false
}
const toggleSelectedAssetRow = (assetId: string, checked: boolean): void => {
  selectedAssetRowIds.value = checked
    ? [...new Set([...selectedAssetRowIds.value, assetId])]
    : selectedAssetRowIds.value.filter((id) => id !== assetId)
}
const toggleAllSelectedAssetRows = (checked: boolean): void => {
  selectedAssetRowIds.value = checked ? selectedAssets.value.map((asset) => asset.id) : []
}
const removeSelectedAssets = (): void => {
  const removed = new Set(selectedAssetRowIds.value)
  selectedAssetIds.value = selectedAssetIds.value.filter((id) => !removed.has(id))
  selectedAssetRowIds.value = []
}

const importDisposalAssets = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const text = (await file.text()).replace(/^\uFEFF/, '')
    const headerNames = new Set(['资产编码', 'assetid', 'assetcode', 'id'])
    const requestedIds = [...new Set(text
      .split(/[\s,;，；]+/)
      .map((value) => value.trim())
      .filter((value) => value && !headerNames.has(value.toLowerCase())))]
    const availableIds = new Set(availableAssets.value.map((asset) => asset.id))
    const matchedIds = requestedIds.filter((id) => availableIds.has(id))
    const unmatchedCount = requestedIds.length - matchedIds.length

    if (!matchedIds.length) {
      ElMessage.warning(requestedIds.length ? '未匹配到可处置的空闲资产' : '导入文件中没有资产编码')
      return
    }

    const previousIds = new Set(selectedAssetIds.value)
    selectedAssetIds.value = [...new Set([...selectedAssetIds.value, ...matchedIds])]
    const addedCount = matchedIds.filter((id) => !previousIds.has(id)).length
    ElMessage.success(unmatchedCount
      ? `已导入 ${addedCount} 项资产，${unmatchedCount} 个编码未匹配`
      : `已导入 ${addedCount} 项资产`)
  } catch {
    ElMessage.error('资产编码文件读取失败')
  } finally {
    input.value = ''
  }
}

const submitCreate = async (): Promise<void> => {
  if (!form.disposalType || !form.company.trim() || !form.description.trim() || !selectedAssetIds.value.length) {
    ElMessage.warning('请填写必填信息并至少选择一项空闲资产')
    return
  }
  if (!selectedSubmissionAssetIds.value.length) {
    ElMessage.warning('请勾选至少一项资产')
    return
  }
  submitting.value = true
  try {
    const created = await create({
      ...form,
      returnDate: form.disposalType === '退租' ? form.returnDate : '',
      assetIds: [...selectedSubmissionAssetIds.value]
    })
    opened.value = false
    await loadAssets(true)
    emit('created', created)
    ElMessage.success('处置单已提交')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '处置单提交失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-drawer v-model="opened" title="新增处置单" size="min(1180px, 92vw)" class="disposal-create-drawer" append-to-body destroy-on-close>
    <el-form label-position="left" label-width="126px" class="disposal-create-form" @submit.prevent="submitCreate">
      <el-form-item label="处置类型" required><el-select v-model="form.disposalType" placeholder="请选择"><el-option v-for="option in disposalTypes" :key="option" :label="option" :value="option" /></el-select></el-form-item>
      <el-form-item label="经办人" required><el-input v-model="form.operator" disabled /></el-form-item>
      <el-form-item label="所属/承租公司" required><el-input v-model="form.company" maxlength="128" /></el-form-item>
      <el-form-item label="处置金额"><el-input-number v-model="form.amount" aria-label="处置金额" :min="0" :precision="2" :controls="false" placeholder="请输入" /></el-form-item>
      <el-form-item label="处置费用"><el-input-number v-model="form.fee" aria-label="处置费用" :min="0" :precision="2" :controls="false" placeholder="请输入" /></el-form-item>
      <el-form-item v-if="form.disposalType === '退租'" label="退租日期" required><el-date-picker v-model="form.returnDate" value-format="YYYY-MM-DD" /></el-form-item>
      <el-form-item class="disposal-form-wide disposal-description-field" label="处置说明" required><el-input v-model="form.description" type="textarea" :rows="3" maxlength="4000" show-word-limit placeholder="记录处置原因、设备处理方式或交接要求" /></el-form-item>
    </el-form>

    <section class="disposal-assets-section">
      <div class="disposal-section-tab">资产详情</div>
      <div class="disposal-assets-toolbar">
        <div class="disposal-asset-actions">
          <button class="table-action primary" type="button" @click="openAssetPicker">选择资产</button>
          <button class="table-action" type="button" :disabled="!selectedAssetRowIds.length" @click="removeSelectedAssets"><el-icon><Delete /></el-icon>删除资产</button>
          <button class="table-action" type="button" @click="disposalImportInput?.click()"><el-icon><Upload /></el-icon>导入资产</button>
          <input ref="disposalImportInput" class="disposal-import-input" type="file" accept=".csv,.txt,text/csv,text/plain" aria-label="导入资产编码文件" @change="importDisposalAssets">
        </div>
        <span>仅可添加空闲资产，已加入 {{ selectedAssetIds.length }} 项</span>
      </div>
      <div class="disposal-picker-table selected-assets-table">
        <table><thead><tr><th class="check-cell"><input type="checkbox" :checked="allSelectedRowsMarked" aria-label="全选已加入资产" @change="toggleAllSelectedAssetRows(($event.target as HTMLInputElement).checked)"></th><th>资产编码</th><th>资产分类</th><th>资产名称</th><th>品牌 / 型号</th><th>设备序列号</th><th>供应商</th><th>所在位置</th></tr></thead>
          <tbody><tr v-for="asset in selectedAssets" :key="asset.id"><td class="check-cell"><input type="checkbox" :checked="selectedAssetRowIds.includes(asset.id)" :aria-label="`选择${displayAssetCode(asset)}`" @change="toggleSelectedAssetRow(asset.id, ($event.target as HTMLInputElement).checked)"></td><td>{{ displayAssetCode(asset) }}</td><td>{{ asset.category }}</td><td>{{ asset.name }}</td><td>{{ [asset.brand, asset.model].filter(Boolean).join(' / ') || '-' }}</td><td>{{ asset.sn || '-' }}</td><td>{{ asset.supplier || '-' }}</td><td>{{ asset.location || '-' }}</td></tr><tr v-if="!selectedAssets.length"><td colspan="8"><el-empty description="尚未选择资产" :image-size="56" /></td></tr></tbody>
        </table>
      </div>
    </section>
    <template #footer><div class="disposal-create-footer"><button class="table-action" type="button" @click="opened = false">关闭</button><button class="table-action primary" type="button" :disabled="submitting || !selectedSubmissionAssetIds.length" @click="submitCreate">{{ submitting ? '提交中...' : '保存并提交' }}</button></div></template>
  </el-drawer>

  <el-dialog v-model="assetPickerOpen" title="选择处置资产" width="min(1040px, 94vw)" class="disposal-asset-picker-dialog" append-to-body destroy-on-close>
    <div class="disposal-asset-picker-toolbar"><div><strong>空闲资产</strong><span>搜索并勾选需要加入处置单的资产</span></div><el-input v-model="pickerQuery" clearable class="disposal-asset-picker-search" placeholder="搜索编码、名称、分类、品牌或供应商" aria-label="搜索可选资产"><template #prefix><el-icon><Search /></el-icon></template></el-input></div>
    <div class="disposal-picker-table disposal-asset-picker-table">
      <table><thead><tr><th class="check-cell"><input type="checkbox" :checked="allPickerAssetsSelected" aria-label="全选当前资产" @change="toggleAllPickerAssets(($event.target as HTMLInputElement).checked)"></th><th>资产编码</th><th>资产分类</th><th>资产名称</th><th>品牌 / 型号</th><th>设备序列号</th><th>供应商</th><th>所在位置</th></tr></thead>
        <tbody><tr v-for="asset in pickerAssets" :key="asset.id" :class="{ selected: pickerAssetIds.includes(asset.id) }"><td class="check-cell"><input type="checkbox" :checked="pickerAssetIds.includes(asset.id)" :aria-label="`选择资产${displayAssetCode(asset)}`" @change="togglePickerAsset(asset, ($event.target as HTMLInputElement).checked)"></td><td>{{ displayAssetCode(asset) }}</td><td>{{ asset.category }}</td><td>{{ asset.name }}</td><td>{{ [asset.brand, asset.model].filter(Boolean).join(' / ') || '-' }}</td><td>{{ asset.sn || '-' }}</td><td>{{ asset.supplier || '-' }}</td><td>{{ asset.location || '-' }}</td></tr><tr v-if="!pickerAssets.length"><td colspan="8"><el-empty description="没有符合条件的空闲资产" :image-size="64" /></td></tr></tbody>
      </table>
    </div>
    <template #footer><div class="disposal-asset-picker-footer"><span>已选择 {{ pickerAssetIds.length }} 项</span><div><el-button @click="assetPickerOpen = false">取消</el-button><el-button type="primary" @click="confirmAssetPicker">确认选择</el-button></div></div></template>
  </el-dialog>
</template>
