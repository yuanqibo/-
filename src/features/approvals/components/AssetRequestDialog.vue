<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { Aim, Close, Delete, Plus, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import SignaturePad from '../../../shared/components/SignaturePad.vue'
import { usePortalSession } from '../../../core/auth/portal-session'
import { searchDirectoryPeople } from '../../assets/api/assets.api'
import { useAssets } from '../../assets/composables/useAssets'
import type { ApprovalRecord } from '../types/approval'
import type { AssetRecord, CatalogNode, DirectoryPerson } from '../../assets/types/assets'
import { fetchRequestOperators, type RequestOperator } from '../api/approvals.api'
import { useApprovals } from '../composables/useApprovals'
import { matchesPinyinSearch } from '../../../shared/search/pinyin-search'

type ReceiverSuggestion = DirectoryPerson & { value: string }
type DeviceRequestItem = { name: string; specification: string; quantity: number }

const props = withDefaults(defineProps<{
  modelValue: boolean
  type?: string
  preselectedAssetId?: string
}>(), { type: '资产领用', preselectedAssetId: '' })
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submitted: [item: ApprovalRecord]
}>()

const { assets, store, loadAssets, loadStore } = useAssets()
const { create } = useApprovals()
const { user } = usePortalSession()
const submitting = ref(false)
const assetQuery = ref('')
const selectedCategory = ref('')
const scanOpen = ref(false)
const scanCode = ref('')
const scanInput = ref<{ focus: () => void }>()
const receiverQuery = ref('')
const requestSignatureOpen = ref(false)
const requestSignatureImage = ref('')
const requestOperators = ref<RequestOperator[]>([])
const requestOperatorsLoading = ref(false)
const requestOperatorsError = ref(false)
const form = reactive({
  type: '资产领用',
  assetIds: [] as string[],
  operatorSubject: '',
  location: '',
  date: new Date().toISOString().slice(0, 10),
  expectedReturnDate: '',
  receiverSubject: '',
  receiverName: '',
  receiverCompany: '',
  receiverDepartment: '',
  reason: '',
  deviceItems: [{ name: '', specification: '', quantity: 1 }] as DeviceRequestItem[]
})

const isHandover = computed(() => form.type === '资产交接')
const isSelfReturn = computed(() => form.type === '资产退还')
const isSelfGiveBack = computed(() => form.type === '资产归还')
const isSelfReceive = computed(() => form.type === '资产领用')
const isSelfBorrow = computed(() => form.type === '资产借用')
const isDeviceRequest = computed(() => form.type === '办公设备申领')
const isAvailableSelfService = computed(() => isSelfReceive.value || isSelfBorrow.value)
const requestSettingKey = computed(() => ({
  '资产领用': 'receiveAsset',
  '资产借用': 'borrowAsset',
  '资产归还': 'giveBackAsset',
  '资产退还': 'returnAsset',
  '资产交接': 'handoverAsset',
  '办公设备申领': 'deviceRequest'
}[form.type] || ''))
const requestPolicy = computed<Record<string, unknown>>(() => {
  const settings = store.value.assetPortalSelfServiceSettingsV9
  if (!settings || !requestSettingKey.value) return {}
  const value = settings[requestSettingKey.value]
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
})
const requestEnabled = computed(() => requestPolicy.value.enabled === true)
const remarkRequired = computed(() => requestPolicy.value.remarkRequired === true)
const remarkPlaceholder = computed(() => String(requestPolicy.value.remarkPrompt || '').trim()
  || (isDeviceRequest.value ? '请补充使用场景或申领原因' : isHandover.value ? '请输入交接备注' : isSelfReturn.value ? '请输入退库备注' : isSelfGiveBack.value ? '请输入归还备注' : isSelfBorrow.value ? '请输入借用备注' : '请输入领用备注'))
const allowMultipleDeviceItems = computed(() => requestPolicy.value.allowEmployeeAddDevice === true)
const requestSignatureKey = computed(() => ({
  '资产领用': 'selfReceiveAsset',
  '资产借用': 'selfBorrowAsset',
  '资产归还': 'selfGiveBackAsset',
  '资产交接': 'selfHandoverAsset'
}[form.type] || ''))
const requestSignaturePolicy = computed<Record<string, unknown>>(() => {
  const settings = store.value.assetPortalSelfServiceSettingsV9?.signSettings
  if (!settings || typeof settings !== 'object' || !requestSignatureKey.value) return {}
  const value = (settings as Record<string, unknown>)[requestSignatureKey.value]
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
})
const requestNoticeEnabled = computed(() => requestSignaturePolicy.value.noticeEnabled === true)
const requestSignatureRequired = computed(() => {
  const timings = requestSignaturePolicy.value.timings
  if (!timings || typeof timings !== 'object') return false
  const timingKey = isSelfGiveBack.value ? 'return' : isSelfReceive.value || isSelfBorrow.value ? 'start' : ''
  return Boolean(timingKey && (timings as Record<string, unknown>)[timingKey])
})
const requestSignatureNotice = computed(() => requestNoticeEnabled.value
  ? String(requestSignaturePolicy.value.noticeContent || '') : '')
const requestConfirmationRequired = computed(() => requestSignatureRequired.value || requestNoticeEnabled.value)
const requestConfirmationTitle = computed(() => requestSignatureRequired.value ? '申请签字确认' : '申请须知')
const requestConfirmed = ref(false)
const usesAssetPicker = computed(() => isHandover.value || isSelfReturn.value || isSelfGiveBack.value || isAvailableSelfService.value)
const flattenLocations = (nodes: CatalogNode[], parent: string[] = []): string[] => nodes.flatMap((node) => {
  if (node.enabled === false) return []
  const path = [...parent, node.name]
  return [path.join(' / '), ...flattenLocations(node.children || [], path)]
})
const locationOptions = computed(() => flattenLocations(store.value.assetLocationTree || []))
type LocationTreeOption = { value: string; label: string; children?: LocationTreeOption[] }
const buildLocationTree = (nodes: CatalogNode[], parent: string[] = []): LocationTreeOption[] => nodes
  .filter((node) => node.enabled !== false)
  .map((node) => {
    const path = [...parent, node.name]
    const children = buildLocationTree(node.children || [], path)
    return {
      value: path.join(' / '),
      label: node.name,
      ...(children.length ? { children } : {})
    }
  })
const locationTreeOptions = computed(() => buildLocationTree(store.value.assetLocationTree || []))
const requestOperatorPlaceholder = computed(() => requestOperatorsLoading.value
  ? '正在加载经办人'
  : requestOperatorsError.value
    ? '经办人加载失败'
    : requestOperators.value.length ? '请选择经办人' : '暂未配置经办人')
const availableCategories = computed(() => {
  const settingKey = isSelfBorrow.value ? 'borrowAsset' : 'receiveAsset'
  const settings = store.value.assetPortalSelfServiceSettingsV9?.[settingKey]
  if (!settings || typeof settings !== 'object') return []
  const categories = (settings as { categories?: unknown }).categories
  if (!Array.isArray(categories)) return []
  return [...new Set(categories.map((item) => String(item || '').trim()).filter(Boolean))]
})
const belongsToCurrentEmployee = (item: AssetRecord): boolean => {
  const assetSubject = String(item.ownerSubject || '').trim()
  const userSubject = String(user.value?.externalSubject || '').trim()
  if (assetSubject && userSubject && [userSubject, userSubject.replace(/^ecp:/, '')].includes(assetSubject)) return true
  return Boolean(item.owner && item.owner === user.value?.name)
}
const requestAssets = computed(() => assets.value.filter((item) => {
  if (isAvailableSelfService.value) return item.status === '空闲' && availableCategories.value.includes(item.category)
  if (isSelfGiveBack.value) return ['借用', '借用中'].includes(item.status) && belongsToCurrentEmployee(item)
  if (form.type === '资产退还') return item.status === '领用' && (!item.owner || item.owner === user.value?.name)
  if (form.type === '资产交接') return ['领用', '领用中', '借用', '借用中'].includes(item.status) && (!item.owner || item.owner === user.value?.name)
  return item.status === '空闲'
}))
const filteredRequestAssets = computed(() => {
  return requestAssets.value.filter((item) => {
    const categoryMatch = !isAvailableSelfService.value || !selectedCategory.value || item.category === selectedCategory.value
    const keywordMatch = matchesPinyinSearch([item.id, item.name, item.brand, item.model, item.sn, item.assetTag], assetQuery.value)
    return categoryMatch && keywordMatch
  })
})
const selectedAssets = computed(() => form.assetIds
  .map((id) => assets.value.find((item) => item.id === id))
  .filter((item): item is AssetRecord => Boolean(item)))

const close = (): void => emit('update:modelValue', false)
const clearReceiver = (): void => {
  form.receiverSubject = ''
  form.receiverName = ''
  form.receiverCompany = ''
  form.receiverDepartment = ''
  receiverQuery.value = ''
  requestSignatureOpen.value = false
  requestSignatureImage.value = ''
}
const loadRequestOperators = async (): Promise<void> => {
  requestOperatorsLoading.value = true
  requestOperatorsError.value = false
  try {
    requestOperators.value = await fetchRequestOperators()
  } catch (error) {
    requestOperators.value = []
    requestOperatorsError.value = true
    console.error('[asset-portal] Unable to load ECP request operators', error)
  } finally {
    requestOperatorsLoading.value = false
  }
}
const prepare = async (): Promise<void> => {
  Object.assign(form, {
    type: props.type,
    assetIds: props.preselectedAssetId ? [props.preselectedAssetId] : [],
    operatorSubject: '',
    location: '',
    date: new Date().toISOString().slice(0, 10),
    expectedReturnDate: '',
    receiverSubject: '',
    receiverName: '',
    receiverCompany: '',
    receiverDepartment: '',
    reason: '',
    deviceItems: [{ name: '', specification: '', quantity: 1 }]
  })
  assetQuery.value = ''
  selectedCategory.value = ''
  scanOpen.value = false
  scanCode.value = ''
  receiverQuery.value = ''
  requestConfirmed.value = false
  requestSignatureImage.value = ''
  await Promise.all([loadAssets(), loadStore(), loadRequestOperators()])
  if (!requestEnabled.value) {
    ElMessage.warning('该员工自助功能已关闭')
    close()
    return
  }
  const selected = assets.value.find((item) => item.id === props.preselectedAssetId)
  if (props.preselectedAssetId && !requestAssets.value.some((item) => item.id === props.preselectedAssetId)) form.assetIds = []
  if (selected && locationOptions.value.includes(selected.location)) form.location = selected.location
}
const findReceivers = async (query: string, callback: (items: ReceiverSuggestion[]) => void): Promise<void> => {
  try {
    const matches = await searchDirectoryPeople(query)
    callback(matches
      .filter((person) => person.name !== user.value?.name && person.subject !== user.value?.externalSubject)
      .slice(0, 30)
      .map((person) => ({ ...person, value: person.name })))
  } catch {
    callback([])
  }
}
const selectReceiver = (person: ReceiverSuggestion): void => {
  form.receiverSubject = person.subject
  form.receiverName = person.name
  form.receiverCompany = person.company
  form.receiverDepartment = person.department
  receiverQuery.value = person.name
}
const onReceiverInput = (value: string): void => {
  receiverQuery.value = value
  if (form.receiverSubject && value !== form.receiverName) {
    form.receiverSubject = ''
    form.receiverName = ''
    form.receiverCompany = ''
    form.receiverDepartment = ''
  }
}
const setAssetSelected = (id: string, selected: boolean): void => {
  if (selected && !form.assetIds.includes(id)) form.assetIds.push(id)
  if (!selected) form.assetIds = form.assetIds.filter((item) => item !== id)
}
const toggleScan = async (): Promise<void> => {
  scanOpen.value = !scanOpen.value
  if (!scanOpen.value) return
  scanCode.value = ''
  await nextTick()
  scanInput.value?.focus()
}
const selectScannedAsset = (): void => {
  const code = scanCode.value.trim().toLowerCase()
  if (!code) { ElMessage.warning('请扫描资产编码、序列号或资产标签'); return }
  const item = requestAssets.value.find((asset) => [asset.id, asset.sn, asset.assetTag]
    .some((value) => String(value || '').trim().toLowerCase() === code))
  if (!item) { ElMessage.warning(`未找到符合${isSelfBorrow.value ? '借用' : '领用'}范围的空闲资产`); return }
  selectedCategory.value = item.category
  setAssetSelected(item.id, true)
  scanCode.value = ''
  ElMessage.success(`已选择资产 ${item.id}`)
  void nextTick(() => scanInput.value?.focus())
}
const assetModel = (item: AssetRecord): string => [item.brand, item.model].filter(Boolean).join(' ') || '-'
const assetMeta = (item: AssetRecord): string => isSelfGiveBack.value
  ? `序列号：${item.sn || '-'}　借用日期：${item.borrowDate || '-'}　预计归还日期：${item.expectedReturnDate || '-'}`
  : `序列号：${item.sn || '-'}　位置：${item.location || '-'}　品牌/型号：${assetModel(item)}`
const addDeviceItem = (): void => {
  if (!allowMultipleDeviceItems.value || form.deviceItems.length >= 20) return
  form.deviceItems.push({ name: '', specification: '', quantity: 1 })
}
const removeDeviceItem = (index: number): void => {
  if (form.deviceItems.length <= 1) return
  form.deviceItems.splice(index, 1)
}

const submit = async (): Promise<void> => {
  if (!requestEnabled.value) { ElMessage.warning('该员工自助功能已关闭'); close(); return }
  if (requestOperatorsLoading.value) { ElMessage.warning('经办人正在加载，请稍候'); return }
  if (!requestOperators.value.length) { ElMessage.warning('未获取到已授权的资产管理员，请联系系统管理员'); return }
  if (!form.operatorSubject) { ElMessage.warning('请选择经办人'); return }
  if (!isDeviceRequest.value && !form.assetIds.length) { ElMessage.warning('请至少选择一项资产'); return }
  if (!isDeviceRequest.value && !form.location.trim()) { ElMessage.warning(isHandover.value ? '请选择接收位置' : isSelfReturn.value ? '请选择退库后位置' : isSelfGiveBack.value ? '请选择归还后位置' : isSelfBorrow.value ? '请选择借用后位置' : '请选择领用后位置'); return }
  if (form.type === '资产借用' && !form.expectedReturnDate) { ElMessage.warning('请选择预计归还日期'); return }
  if (isSelfBorrow.value && form.expectedReturnDate < form.date) { ElMessage.warning('预计归还日期不能早于借用日期'); return }
  if (isHandover.value && (!form.receiverSubject || !form.receiverName)) { ElMessage.warning('请从组织目录选择接收人'); return }
  if (remarkRequired.value && !form.reason.trim()) { ElMessage.warning('请填写备注'); return }
  if (isDeviceRequest.value) {
    if (!allowMultipleDeviceItems.value && form.deviceItems.length > 1) { ElMessage.warning('当前仅允许申领一项设备'); return }
    if (!form.deviceItems.length || form.deviceItems.some((item) => !item.name.trim() || item.quantity < 1 || item.quantity > 100)) {
      ElMessage.warning('请完整填写设备名称和数量')
      return
    }
  }
  if (requestConfirmationRequired.value && !requestConfirmed.value) {
    requestSignatureOpen.value = true
    return
  }
  const details: Record<string, unknown> = isDeviceRequest.value
    ? { deviceItems: form.deviceItems.map((item) => ({ name: item.name.trim(), specification: item.specification.trim(), quantity: item.quantity })), assetCount: form.deviceItems.length, requestDate: form.date, selfServiceRequest: true }
    : { assetIds: [...form.assetIds], assetCount: form.assetIds.length, selfServiceRequest: true }
  details.operatorSubject = form.operatorSubject
  if (!isDeviceRequest.value) {
    const fieldPrefix = form.type === '资产借用' ? 'borrow' : form.type === '资产归还' || form.type === '资产退还' ? 'return' : isHandover.value ? 'handover' : 'receive'
    details[`${fieldPrefix}Location`] = form.location
    details[`${fieldPrefix}Date`] = form.date
  }
  if (isSelfReceive.value) details.receiveType = '个人领用'
  if (form.expectedReturnDate) details.expectedReturnDate = form.expectedReturnDate
  if (requestSignatureImage.value) {
    details.signatureImage = requestSignatureImage.value
  }
  if (requestConfirmed.value && requestNoticeEnabled.value) {
    details.noticeAcknowledged = true
    details.signatureNotice = requestSignatureNotice.value
  }
  if (isHandover.value) Object.assign(details, {
    receiverSubject: form.receiverSubject,
    receiverName: form.receiverName,
    receiverCompany: form.receiverCompany,
    receiverDepartment: form.receiverDepartment,
    handoverType: '员工交接'
  })
  submitting.value = true
  try {
    const item = await create({
      type: form.type,
      applicant: user.value?.name || '',
      asset: isDeviceRequest.value
        ? form.deviceItems.map((item) => `${item.name.trim()} x${item.quantity}`).join('、')
        : selectedAssets.value.map((asset) => `${asset.id} ${asset.name}`).join('、'),
      reason: form.reason,
      details
    })
    await loadAssets()
    close()
    emit('submitted', item)
    const successMessage = isSelfReceive.value
      ? item.status === '已同意' ? '领用已生效' : '领用申请已提交，等待管理员审批'
      : isSelfBorrow.value
        ? item.status === '已同意' ? '借用已生效' : '借用申请已提交，等待管理员审批'
      : isDeviceRequest.value
        ? '办公设备申领已提交，等待管理员审批'
      : isSelfGiveBack.value
        ? '归还申请已提交，等待管理员审批'
      : isSelfReturn.value
        ? '退还申请已提交，等待管理员审批'
        : item.status === '已同意'
          ? '交接已生效'
          : item.status === '待审批'
            ? '交接申请已提交，等待管理员审批'
            : '资产申请已提交'
    ElMessage.success(successMessage)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '提交申请失败')
  } finally {
    submitting.value = false
  }
}

const confirmRequestSignature = (): void => {
  if (requestSignatureRequired.value && !requestSignatureImage.value) { ElMessage.warning('请先完成签字'); return }
  requestConfirmed.value = true
  requestSignatureOpen.value = false
  void submit()
}

watch(() => [props.modelValue, props.type, props.preselectedAssetId] as const, ([open]) => {
  if (open) void prepare()
}, { immediate: true })
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="form.type"
    :width="usesAssetPicker ? 'min(1080px, 96vw)' : 'min(820px, 94vw)'"
    append-to-body
    class="asset-request-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template v-if="usesAssetPicker">
      <el-form label-position="top" class="handover-request-form">
        <div class="handover-request-fields">
          <template v-if="isHandover">
            <el-form-item label="接收人" required>
              <el-autocomplete
                v-model="receiverQuery"
                :fetch-suggestions="findReceivers"
                placeholder="搜索姓名、工号或邮箱"
                clearable
                aria-label="接收人"
                @input="onReceiverInput"
                @select="selectReceiver"
                @clear="clearReceiver"
              >
                <template #default="{ item }"><div class="handover-receiver-option"><strong>{{ item.name }}</strong><span>{{ [item.account, item.department].filter(Boolean).join(' · ') }}</span></div></template>
              </el-autocomplete>
            </el-form-item>
            <el-form-item label="接收公司"><el-input :model-value="form.receiverCompany" readonly placeholder="选择接收人后自动带出" /></el-form-item>
            <el-form-item label="接收部门"><el-input :model-value="form.receiverDepartment" readonly placeholder="选择接收人后自动带出" /></el-form-item>
            <el-form-item label="接收位置" required><el-tree-select v-model="form.location" :data="locationTreeOptions" filterable check-strictly :automatic-dropdown="false" :render-after-expand="false" :default-expanded-keys="[]" placeholder="选择接收位置" /></el-form-item>
            <el-form-item label="交接日期" required><el-date-picker v-model="form.date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
            <el-form-item label="经办人" required><el-select v-model="form.operatorSubject" filterable clearable :loading="requestOperatorsLoading" :disabled="requestOperatorsError || !requestOperators.length" :placeholder="requestOperatorPlaceholder" placement="bottom-start"><el-option v-for="item in requestOperators" :key="item.subject" :label="item.name" :value="item.subject" /></el-select></el-form-item>
          </template>
          <template v-else-if="isSelfReturn">
            <el-form-item label="退库人"><el-input :model-value="user?.name || ''" readonly /></el-form-item>
            <el-form-item label="所属公司"><el-input :model-value="user?.company || ''" readonly /></el-form-item>
            <el-form-item label="所在部门"><el-input :model-value="user?.department || ''" readonly /></el-form-item>
            <el-form-item label="退库后位置" required><el-tree-select v-model="form.location" :data="locationTreeOptions" filterable check-strictly :automatic-dropdown="false" :render-after-expand="false" :default-expanded-keys="[]" placeholder="选择退库后位置" /></el-form-item>
            <el-form-item label="经办人" required><el-select v-model="form.operatorSubject" filterable clearable :loading="requestOperatorsLoading" :disabled="requestOperatorsError || !requestOperators.length" :placeholder="requestOperatorPlaceholder" placement="bottom-start"><el-option v-for="item in requestOperators" :key="item.subject" :label="item.name" :value="item.subject" /></el-select></el-form-item>
            <el-form-item label="退库日期" required><el-date-picker v-model="form.date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
          </template>
          <template v-else-if="isSelfGiveBack">
            <el-form-item label="归还人"><el-input :model-value="user?.name || ''" readonly /></el-form-item>
            <el-form-item label="所属公司"><el-input :model-value="user?.company || ''" readonly /></el-form-item>
            <el-form-item label="所在部门"><el-input :model-value="user?.department || ''" readonly /></el-form-item>
            <el-form-item label="归还后位置" required><el-tree-select v-model="form.location" :data="locationTreeOptions" filterable check-strictly :automatic-dropdown="false" :render-after-expand="false" :default-expanded-keys="[]" placeholder="选择归还后位置" /></el-form-item>
            <el-form-item label="经办人" required><el-select v-model="form.operatorSubject" filterable clearable :loading="requestOperatorsLoading" :disabled="requestOperatorsError || !requestOperators.length" :placeholder="requestOperatorPlaceholder" placement="bottom-start"><el-option v-for="item in requestOperators" :key="item.subject" :label="item.name" :value="item.subject" /></el-select></el-form-item>
            <el-form-item label="归还日期" required><el-date-picker v-model="form.date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
          </template>
          <template v-else-if="isSelfBorrow">
            <el-form-item label="借用人"><el-input :model-value="user?.name || ''" readonly /></el-form-item>
            <el-form-item label="所属公司"><el-input :model-value="user?.company || ''" readonly /></el-form-item>
            <el-form-item label="所在部门"><el-input :model-value="user?.department || ''" readonly /></el-form-item>
            <el-form-item label="借用后位置" required><el-tree-select v-model="form.location" :data="locationTreeOptions" filterable check-strictly :automatic-dropdown="false" :render-after-expand="false" :default-expanded-keys="[]" placeholder="选择借用后位置" /></el-form-item>
            <el-form-item label="经办人" required><el-select v-model="form.operatorSubject" filterable clearable :loading="requestOperatorsLoading" :disabled="requestOperatorsError || !requestOperators.length" :placeholder="requestOperatorPlaceholder" placement="bottom-start"><el-option v-for="item in requestOperators" :key="item.subject" :label="item.name" :value="item.subject" /></el-select></el-form-item>
            <el-form-item label="借用日期" required><el-date-picker v-model="form.date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
            <el-form-item label="预计归还日期" required><el-date-picker v-model="form.expectedReturnDate" :disabled-date="(date: Date) => date.getTime() < new Date(`${form.date}T00:00:00`).getTime()" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
          </template>
          <template v-else>
            <el-form-item label="领用人"><el-input :model-value="user?.name || ''" readonly /></el-form-item>
            <el-form-item label="领用类型"><el-input model-value="个人领用" readonly /></el-form-item>
            <el-form-item label="所属公司"><el-input :model-value="user?.company || ''" readonly /></el-form-item>
            <el-form-item label="所在部门"><el-input :model-value="user?.department || ''" readonly /></el-form-item>
            <el-form-item label="领用后位置" required><el-tree-select v-model="form.location" :data="locationTreeOptions" filterable check-strictly :automatic-dropdown="false" :render-after-expand="false" :default-expanded-keys="[]" placeholder="选择领用后位置" /></el-form-item>
            <el-form-item label="经办人" required><el-select v-model="form.operatorSubject" filterable clearable :loading="requestOperatorsLoading" :disabled="requestOperatorsError || !requestOperators.length" :placeholder="requestOperatorPlaceholder" placement="bottom-start"><el-option v-for="item in requestOperators" :key="item.subject" :label="item.name" :value="item.subject" /></el-select></el-form-item>
            <el-form-item label="领用日期" required><el-date-picker v-model="form.date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
          </template>
        </div>
        <el-form-item :label="isHandover ? '交接备注' : isSelfReturn ? '退库备注' : isSelfGiveBack ? '归还备注' : isSelfBorrow ? '借用备注' : '领用备注'" :required="remarkRequired"><el-input v-model="form.reason" type="textarea" :rows="3" maxlength="500" show-word-limit :placeholder="remarkPlaceholder" /></el-form-item>
      </el-form>

      <section class="handover-asset-picker" :class="{ 'self-receive-asset-picker': isAvailableSelfService }" :aria-label="isHandover ? '交接资产' : isSelfReturn ? '退还资产' : isSelfGiveBack ? '归还资产' : isSelfBorrow ? '借用资产' : '领用资产'">
        <aside v-if="isAvailableSelfService" class="self-receive-categories" :aria-label="isSelfBorrow ? '可借用资产分类' : '可领用资产分类'">
          <div class="self-receive-category-head"><strong>资产分类</strong><span>{{ availableCategories.length }}</span></div>
          <div class="self-receive-category-list">
            <button type="button" :class="{ active: !selectedCategory }" @click="selectedCategory = ''"><span>全部</span><em>{{ requestAssets.length }}</em></button>
            <button v-for="category in availableCategories" :key="category" type="button" :class="{ active: selectedCategory === category }" @click="selectedCategory = category"><span>{{ category }}</span><em>{{ requestAssets.filter((item) => item.category === category).length }}</em></button>
          </div>
        </aside>
        <div class="handover-asset-column">
          <div class="handover-asset-column-head">
            <strong>{{ isHandover ? '选择资产' : isSelfReturn ? '选择退还资产' : isSelfGiveBack ? '选择归还资产' : isSelfBorrow ? '选择借用资产' : '选择领用资产' }}</strong>
            <div class="self-receive-search"><el-input v-model="assetQuery" clearable placeholder="按编码、名称或序列号筛选" :prefix-icon="Search" /><el-button v-if="isAvailableSelfService" :icon="Aim" title="扫码精确查询" aria-label="扫码精确查询" @click="toggleScan" /></div>
          </div>
          <div v-if="isAvailableSelfService && scanOpen" class="self-receive-scan-bar">
            <el-input ref="scanInput" v-model="scanCode" clearable autocomplete="off" placeholder="扫描资产编码、SN 或资产标签" aria-label="扫码内容" @keyup.enter="selectScannedAsset" />
            <el-button type="primary" @click="selectScannedAsset">精确查询</el-button>
          </div>
          <div class="handover-asset-list">
            <label v-for="item in filteredRequestAssets" :key="item.id" class="handover-asset-card" :class="{ selected: form.assetIds.includes(item.id) }">
              <el-checkbox :model-value="form.assetIds.includes(item.id)" :aria-label="`选择资产 ${item.id}`" @change="setAssetSelected(item.id, Boolean($event))" />
              <span><strong>{{ item.id }}</strong><em>{{ item.name }}</em><small>{{ assetMeta(item) }}</small></span>
            </label>
            <div v-if="!filteredRequestAssets.length" class="handover-asset-empty">{{ isSelfReceive ? '当前分类没有可领用的空闲资产' : isSelfBorrow ? '当前分类没有可借用的空闲资产' : isSelfGiveBack ? '没有可归还的本人借用资产' : isSelfReturn ? '没有可退还的本人领用资产' : '没有符合条件的本人资产' }}</div>
          </div>
        </div>
        <div class="handover-asset-column selected-column">
          <div class="handover-asset-column-head"><strong>已选择资产 {{ selectedAssets.length }}</strong><el-button v-if="selectedAssets.length" link type="danger" @click="form.assetIds = []">清空</el-button></div>
          <div class="handover-asset-list">
            <article v-for="item in selectedAssets" :key="item.id" class="handover-selected-card"><span><strong>{{ item.id }}</strong><em>{{ item.name }}</em><small>{{ assetMeta(item) }}</small></span><el-button circle text :icon="Close" :aria-label="`移除资产 ${item.id}`" @click="setAssetSelected(item.id, false)" /></article>
            <div v-if="!selectedAssets.length" class="handover-asset-empty">尚未选择资产</div>
          </div>
        </div>
      </section>
    </template>

    <el-form v-else-if="isDeviceRequest" label-position="top" class="device-request-form">
      <div class="handover-request-fields">
        <el-form-item label="申领人"><el-input :model-value="user?.name || ''" readonly /></el-form-item>
        <el-form-item label="所属公司"><el-input :model-value="user?.company || ''" readonly /></el-form-item>
        <el-form-item label="所在部门"><el-input :model-value="user?.department || ''" readonly /></el-form-item>
        <el-form-item label="经办人" required><el-select v-model="form.operatorSubject" filterable clearable :loading="requestOperatorsLoading" :disabled="requestOperatorsError || !requestOperators.length" :placeholder="requestOperatorPlaceholder"><el-option v-for="item in requestOperators" :key="item.subject" :label="item.name" :value="item.subject" /></el-select></el-form-item>
        <el-form-item label="申请日期" required><el-date-picker v-model="form.date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
      </div>
      <section class="device-request-items">
        <div class="device-request-items-head"><strong>设备需求</strong><el-button v-if="allowMultipleDeviceItems" :icon="Plus" :disabled="form.deviceItems.length >= 20" @click="addDeviceItem">添加设备</el-button></div>
        <div class="device-request-item-list">
          <div v-for="(item, index) in form.deviceItems" :key="index" class="device-request-item">
            <el-form-item :label="`设备名称 ${index + 1}`" required><el-input v-model="item.name" maxlength="128" placeholder="例如：笔记本电脑" /></el-form-item>
            <el-form-item label="规格要求"><el-input v-model="item.specification" maxlength="500" placeholder="型号、配置或其他要求" /></el-form-item>
            <el-form-item label="数量" required><el-input-number v-model="item.quantity" :min="1" :max="100" /></el-form-item>
            <el-button v-if="form.deviceItems.length > 1" class="device-request-remove" text :icon="Delete" aria-label="删除设备" @click="removeDeviceItem(index)" />
          </div>
        </div>
        <p v-if="!allowMultipleDeviceItems" class="device-request-limit-note">管理员当前仅允许每张申请单填写一项设备。</p>
      </section>
      <el-form-item label="申领备注" :required="remarkRequired"><el-input v-model="form.reason" type="textarea" :rows="3" maxlength="500" show-word-limit :placeholder="remarkPlaceholder" /></el-form-item>
    </el-form>
    <el-form v-else label-position="top" class="standard-form-grid">
      <el-form-item label="选择资产" class="standard-form-span" required><el-select v-model="form.assetIds" multiple filterable collapse-tags placeholder="搜索并选择资产" style="width: 100%"><el-option v-for="item in requestAssets" :key="item.id" :label="`${item.id} · ${item.name}`" :value="item.id" /></el-select></el-form-item>
      <el-form-item label="资产位置" required><el-select v-model="form.location" filterable placeholder="选择资产位置" style="width: 100%"><el-option v-for="location in locationOptions" :key="location" :label="location" :value="location" /></el-select></el-form-item>
      <el-form-item label="申请日期"><el-date-picker v-model="form.date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
      <el-form-item v-if="form.type === '资产借用'" label="预计归还日期" required><el-date-picker v-model="form.expectedReturnDate" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
      <el-form-item label="申请原因" class="standard-form-span"><el-input v-model="form.reason" type="textarea" :rows="3" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="close">取消</el-button><el-button type="primary" :loading="submitting" @click="submit">{{ isAvailableSelfService ? '确认提交' : usesAssetPicker ? '确认' : '提交申请' }}</el-button></template>
  </el-dialog>
  <el-dialog v-model="requestSignatureOpen" :title="requestConfirmationTitle" width="min(760px, 94vw)" append-to-body destroy-on-close>
    <p v-if="requestSignatureNotice" class="signature-notice">{{ requestSignatureNotice }}</p>
    <template v-if="requestSignatureRequired"><div class="signature-dialog-label">请签字确认后发起申请</div><SignaturePad v-model="requestSignatureImage" :height="280" /></template>
    <p v-else class="signature-confirm-hint">请阅读以上内容，确认后再提交申请。</p>
    <template #footer><el-button @click="requestSignatureOpen = false">取消</el-button><el-button type="primary" @click="confirmRequestSignature">确定</el-button></template>
  </el-dialog>
</template>
