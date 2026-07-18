<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { useSystemSettings } from '../composables/useSystemSettings'
import type { SelfServiceItem, SelfServiceSettings } from '../types/system-settings'

const { state, selfService, loadSelfService, saveSelfService } = useSystemSettings()
const form = reactive<SelfServiceSettings>({})
const saving = ref(false)
const definitions = [
  { key: 'receiveAsset', title: '自助资产领用', description: '员工可发起空闲资产领用申请。', categories: true },
  { key: 'returnAsset', title: '自助资产退还', description: '员工可选择名下领用资产进行退还。' },
  { key: 'borrowAsset', title: '自助资产借用', description: '员工可发起空闲资产借用申请。', categories: true },
  { key: 'giveBackAsset', title: '自助归还', description: '员工可选择名下借用资产进行归还。' },
  { key: 'handoverAsset', title: '自助资产交接', description: '员工可自行交接名下资产。' },
  { key: 'deviceRequest', title: '办公设备申领', description: '系统内没有满足条件的设备时发起申领。' }
]
const ensureItem = (key: string): SelfServiceItem => {
  if (!form[key] || typeof form[key] !== 'object') form[key] = { enabled: false, remarkRequired: false, remarkPrompt: '' }
  return form[key] as SelfServiceItem
}
const sync = (): void => { Object.keys(form).forEach((key) => delete form[key]); Object.assign(form, structuredClone(selfService.value)); definitions.forEach((item) => ensureItem(item.key)) }
const submit = async (): Promise<void> => { saving.value = true; try { await saveSelfService(structuredClone(form)); ElMessage.success('员工自助配置已保存') } catch (error) { ElMessage.error(error instanceof Error ? error.message : '保存失败') } finally { saving.value = false } }
onMounted(async () => { await loadSelfService(); sync() })
</script>

<template><section class="standard-business-view self-service-vue-view"><header class="standard-page-header"><div><h1>员工自助</h1><p>设置员工可发起的资产申请、备注要求和可选分类。</p></div><div class="standard-header-actions"><el-button :icon="Refresh" @click="loadSelfService().then(sync)">刷新</el-button><el-button type="primary" :loading="saving" @click="submit">保存</el-button></div></header><el-skeleton v-if="state.loading" :rows="8" animated /><div v-else class="standard-self-service-list"><section v-for="definition in definitions" :key="definition.key" class="standard-self-service-item"><div class="standard-section-title"><div><h2>{{ definition.title }}</h2><p>{{ definition.description }}</p></div><el-switch v-model="ensureItem(definition.key).enabled" /></div><div class="standard-self-service-fields"><label><span>备注必填</span><el-switch v-model="ensureItem(definition.key).remarkRequired" /></label><label class="wide"><span>备注提示语</span><el-input v-model="ensureItem(definition.key).remarkPrompt" type="textarea" :rows="2" maxlength="300" show-word-limit /></label><label v-if="definition.categories" class="wide"><span>可申请资产分类</span><el-select v-model="ensureItem(definition.key).categories" multiple filterable allow-create default-first-option placeholder="输入或选择分类"><el-option v-for="item in ensureItem(definition.key).categories || []" :key="item" :label="item" :value="item" /></el-select></label><label v-if="definition.key === 'deviceRequest'"><span>允许员工添加设备</span><el-switch v-model="ensureItem(definition.key).allowEmployeeAddDevice" /></label></div></section></div></section></template>
