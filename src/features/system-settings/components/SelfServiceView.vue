<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { useSystemSettings } from '../composables/useSystemSettings'
import { usePortalSession } from '../../../core/auth/portal-session'
import type { SelfServiceItem, SelfServiceSettings, SelfServiceSignItem } from '../types/system-settings'

type TimingDefinition = { key: string; label: string; defaultValue?: boolean; disabled?: boolean }
type SignDefinition = { key: string; title: string; help: string; noticeLabel: string; defaultNoticeContent: string; defaultNoticeEnabled?: boolean; timings?: TimingDefinition[] }
type SignPage = { key: string; title: string; items: SignDefinition[] }

const { state, selfService, loadSelfService, saveSelfService } = useSystemSettings()
const { user } = usePortalSession()
const form = reactive<SelfServiceSettings>({})
const saving = ref(false)
const activeSection = ref('main')
const activeSignPage = ref('assetReceive')
const canUpdate = computed(() => (user.value?.permissionCodes || []).includes('asset:self_service:update'))

const definitions = [
  { key: 'receiveAsset', title: '自助资产领用', description: '员工可发起空闲资产领用申请。', categories: true },
  { key: 'returnAsset', title: '自助资产退还', description: '员工可选择名下领用资产进行退还。' },
  { key: 'borrowAsset', title: '自助资产借用', description: '员工可发起空闲资产借用申请。', categories: true },
  { key: 'giveBackAsset', title: '自助归还', description: '员工可选择名下借用资产进行归还。' },
  { key: 'handoverAsset', title: '自助资产交接', description: '员工可自行交接名下资产。' },
  { key: 'deviceRequest', title: '办公设备申领', description: '系统内没有满足条件的设备时发起申领。' }
]

const signPages: SignPage[] = [
  { key: 'assetReceive', title: '资产领用', items: [
    { key: 'assetReceive', title: '资产领用', help: '管理员操作资产领用后，员工接收时需签字确认。', noticeLabel: '领用须知', defaultNoticeContent: '请核对资产名称、编号、配置和附件状态。确认无误后完成签字，系统将记录为本人领用。' },
    { key: 'selfReceiveAsset', title: '自助领用资产', help: '员工在申请领用资产时，可查阅领用须知。', noticeLabel: '领用须知', defaultNoticeContent: '请确认申请资产用于真实办公需要，并在接收时核对资产信息。领用后请妥善保管，按公司要求使用。', timings: [{ key: 'start', label: '发起时' }, { key: 'receive', label: '接收时' }] },
    { key: 'assetHandover', title: '资产交接', help: '管理员操作资产交接后，员工接收时需签字确认。', noticeLabel: '交接须知', defaultNoticeContent: '交接双方需确认资产状态、配件和使用责任。接收人签字后，资产责任人将同步变更。' },
    { key: 'selfHandoverAsset', title: '自助交接资产', help: '员工在交接资产时，接收员工可查阅交接须知。', noticeLabel: '交接须知', defaultNoticeContent: '请与接收员工确认资产实物、编号和状态。接收方确认后，系统将完成资产交接记录。', timings: [{ key: 'receive', label: '接收时', defaultValue: true, disabled: true }] }
  ] },
  { key: 'assetBorrow', title: '资产借用', items: [
    { key: 'assetBorrow', title: '资产借用', help: '管理员操作资产借用后，员工接收时需签字确认。', noticeLabel: '借用须知', defaultNoticeContent: '请确认借用资产、预计归还日期和使用责任。借用期间请妥善保管，并按时归还。' },
    { key: 'selfBorrowAsset', title: '自助借用资产', help: '员工在申请借用资产时，可查阅借用须知。', noticeLabel: '借用须知', defaultNoticeContent: '请根据实际办公需要发起借用申请，填写预计归还时间。借用资产仅限本人使用，不得私自转借。', timings: [{ key: 'start', label: '发起时' }, { key: 'receive', label: '接收时' }] },
    { key: 'assetGiveBack', title: '资产归还', help: '管理员操作资产归还后，员工归还时需签字确认。', noticeLabel: '归还须知', defaultNoticeContent: '归还前请清点资产及配件，确认外观和功能状态。管理员确认后，资产将恢复为可用状态。' },
    { key: 'selfGiveBackAsset', title: '自助归还资产', help: '员工在归还资产时，可查阅归还须知。', noticeLabel: '归还须知', defaultNoticeContent: '请选择本人名下借用资产并确认归还信息。归还前请清理个人数据并交回相关配件。', timings: [{ key: 'return', label: '归还时', defaultValue: true, disabled: true }] }
  ] },
  { key: 'materialReceive', title: '物料领用', items: [
    { key: 'materialReceive', title: '物料领用', help: '管理员操作物料领用后，员工接收时需签字确认。', noticeLabel: '领用须知', defaultNoticeContent: '请核对物料名称、规格和数量。确认无误后完成签字，系统将记录本次物料领用。' },
    { key: 'selfMaterialReceive', title: '自助领用物料', help: '员工在申请领用物料时，可查阅领用须知。', noticeLabel: '领用须知', defaultNoticeContent: '请按实际办公消耗申请物料，确认名称、规格和数量。领取后请合理使用，避免浪费。', timings: [{ key: 'start', label: '发起时' }, { key: 'receive', label: '领取时' }] }
  ] }
]

const ensureItem = (key: string): SelfServiceItem => {
  if (!form[key] || typeof form[key] !== 'object') form[key] = { enabled: false, remarkRequired: false, remarkPrompt: '' }
  return form[key] as SelfServiceItem
}
const signDefinitions = computed(() => signPages.flatMap((page) => page.items))
const definitionFor = (key: string): SignDefinition => signDefinitions.value.find((item) => item.key === key) as SignDefinition
const ensureSignItem = (key: string): SelfServiceSignItem => {
  if (!form.signSettings) form.signSettings = {}
  const definition = definitionFor(key)
  const current = form.signSettings[key]
  if (!current) {
    form.signSettings[key] = {
      employeeSign: true,
      noticeEnabled: Boolean(definition.defaultNoticeEnabled),
      noticeContent: definition.defaultNoticeContent,
      timings: Object.fromEntries((definition.timings || []).map((item) => [item.key, Boolean(item.defaultValue)]))
    }
  }
  for (const timing of definition.timings || []) {
    if (timing.disabled) form.signSettings[key].timings[timing.key] = true
    else if (form.signSettings[key].timings[timing.key] === undefined) form.signSettings[key].timings[timing.key] = Boolean(timing.defaultValue)
  }
  return form.signSettings[key]
}
const setTiming = (itemKey: string, timingKey: string, checked: boolean): void => {
  ensureSignItem(itemKey).timings[timingKey] = checked
}
const sync = (): void => {
  Object.keys(form).forEach((key) => delete form[key])
  Object.assign(form, structuredClone(selfService.value))
  definitions.forEach((item) => ensureItem(item.key))
  signDefinitions.value.forEach((item) => ensureSignItem(item.key))
}
const submit = async (): Promise<void> => {
  saving.value = true
  try { await saveSelfService(structuredClone(form)); ElMessage.success(activeSection.value === 'main' ? '员工自助配置已保存' : '签字设置已保存') }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '保存失败') }
  finally { saving.value = false }
}
const refresh = async (): Promise<void> => { await loadSelfService(); sync(); ElMessage.success('配置已刷新') }
onMounted(async () => { await loadSelfService(); sync() })
</script>

<template>
  <section class="standard-business-view self-service-vue-view">
    <header class="standard-page-header"><div><h1>员工自助</h1><p>设置员工可发起的资产申请、签字确认与须知内容。</p></div><div class="standard-header-actions"><el-button :icon="Refresh" @click="refresh">刷新</el-button><el-button v-if="canUpdate" type="primary" :loading="saving" @click="submit">保存</el-button></div></header>
    <el-tabs v-model="activeSection" class="standard-settings-tabs">
      <el-tab-pane label="员工自助管理" name="main" />
      <el-tab-pane label="签字设置" name="sign" />
    </el-tabs>
    <el-skeleton v-if="state.loading" :rows="8" animated />
    <div v-else-if="activeSection === 'main'" class="standard-self-service-list">
      <section v-for="definition in definitions" :key="definition.key" class="standard-self-service-item">
        <div class="standard-section-title"><div><h2>{{ definition.title }}</h2><p>{{ definition.description }}</p></div><el-switch v-model="ensureItem(definition.key).enabled" :disabled="!canUpdate" /></div>
        <div class="standard-self-service-fields">
          <label><span>备注必填</span><el-switch v-model="ensureItem(definition.key).remarkRequired" :disabled="!canUpdate" /></label>
          <label class="wide"><span>备注提示语</span><el-input v-model="ensureItem(definition.key).remarkPrompt" type="textarea" :rows="2" maxlength="300" show-word-limit :disabled="!canUpdate" /></label>
          <label v-if="definition.categories" class="wide"><span>可申请资产分类</span><el-select v-model="ensureItem(definition.key).categories" multiple filterable allow-create default-first-option placeholder="输入或选择分类" :disabled="!canUpdate"><el-option v-for="item in ensureItem(definition.key).categories || []" :key="item" :label="item" :value="item" /></el-select></label>
          <label v-if="definition.key === 'deviceRequest'"><span>允许员工添加设备</span><el-switch v-model="ensureItem(definition.key).allowEmployeeAddDevice" :disabled="!canUpdate" /></label>
        </div>
      </section>
    </div>
    <div v-else class="standard-sign-settings-layout">
      <el-tabs v-model="activeSignPage" tab-position="left" class="standard-sign-page-tabs">
        <el-tab-pane v-for="page in signPages" :key="page.key" :label="page.title" :name="page.key">
          <div class="standard-sign-list">
            <section v-for="item in page.items" :key="item.key" class="standard-sign-card">
              <div class="standard-section-title"><div><h2>{{ item.title }}</h2><p>{{ item.help }}</p></div></div>
              <div class="standard-sign-row">
                <span>员工签字</span>
                <el-switch v-if="!item.timings?.length" v-model="ensureSignItem(item.key).employeeSign" :disabled="!canUpdate" />
                <div v-else class="standard-sign-timings">
                  <el-checkbox v-for="timing in item.timings" :key="timing.key" :model-value="ensureSignItem(item.key).timings[timing.key]" :disabled="!canUpdate || timing.disabled" @change="setTiming(item.key, timing.key, Boolean($event))">{{ timing.label }}</el-checkbox>
                </div>
              </div>
              <div class="standard-sign-row"><span>展示须知内容</span><el-switch v-model="ensureSignItem(item.key).noticeEnabled" :active-text="item.noticeLabel" :disabled="!canUpdate" /></div>
              <label class="standard-sign-notice"><span>须知内容</span><el-input v-model="ensureSignItem(item.key).noticeContent" type="textarea" :rows="3" maxlength="500" show-word-limit :placeholder="`请输入${item.noticeLabel}`" :disabled="!canUpdate" /></label>
            </section>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </section>
</template>
