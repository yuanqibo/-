<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Edit, Plus, Refresh } from '@element-plus/icons-vue'
import { useSystemSettings } from '../composables/useSystemSettings'
import type { SystemIntegration } from '../types/system-settings'

const { state, integrations, loadIntegrations, saveIntegration } = useSystemSettings()
const dialogOpen = ref(false)
const submitting = ref(false)
const form = reactive({ id: '', code: '', name: '', provider: 'HTTP', baseUrl: '', enabled: true, configText: '{}', secret: '', clearSecret: false, secretConfigured: false, version: 0 })
const open = (item?: SystemIntegration): void => { Object.assign(form, item ? { ...item, configText: JSON.stringify(item.config || {}, null, 2), secret: '', clearSecret: false } : { id: '', code: '', name: '', provider: 'HTTP', baseUrl: '', enabled: true, configText: '{}', secret: '', clearSecret: false, secretConfigured: false, version: 0 }); dialogOpen.value = true }
const submit = async (): Promise<void> => {
  let config: Record<string, unknown>
  try { config = JSON.parse(form.configText) } catch { ElMessage.warning('连接配置必须是有效 JSON'); return }
  submitting.value = true
  try { await saveIntegration({ id: form.id || undefined, code: form.code, name: form.name, provider: form.provider, baseUrl: form.baseUrl, enabled: form.enabled, config, secret: form.secret || undefined, clearSecret: form.clearSecret, version: form.version }); dialogOpen.value = false; ElMessage.success('系统对接配置已保存') }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '保存失败') } finally { submitting.value = false }
}
onMounted(() => void loadIntegrations())
</script>

<template><section class="standard-business-view"><header class="standard-page-header"><div><h1>系统对接</h1><p>管理外部系统连接、接口地址和加密凭据。</p></div><div class="standard-header-actions"><el-button :icon="Refresh" @click="loadIntegrations">刷新</el-button><el-button type="primary" :icon="Plus" @click="open()">新增对接</el-button></div></header><div class="standard-table-shell"><el-table v-loading="state.loading" :data="integrations" height="100%" row-key="id"><el-table-column prop="name" label="对接名称" min-width="160" /><el-table-column prop="code" label="编码" min-width="130" /><el-table-column prop="provider" label="服务类型" width="120" /><el-table-column prop="baseUrl" label="服务地址" min-width="260" show-overflow-tooltip /><el-table-column label="密钥" width="90"><template #default="scope">{{ scope.row.secretConfigured ? '已配置' : '未配置' }}</template></el-table-column><el-table-column label="状态" width="90"><template #default="scope"><el-tag :type="scope.row.enabled ? 'success' : 'info'">{{ scope.row.enabled ? '启用' : '停用' }}</el-tag></template></el-table-column><el-table-column label="操作" width="90"><template #default="scope"><el-button link type="primary" :icon="Edit" @click="open(scope.row)">编辑</el-button></template></el-table-column></el-table></div><el-alert v-if="state.errorMessage" type="error" :title="state.errorMessage" show-icon :closable="false" />
<el-dialog v-model="dialogOpen" :title="form.id ? '编辑系统对接' : '新增系统对接'" width="min(760px, 94vw)" append-to-body><el-form label-position="top" class="standard-form-grid"><el-form-item label="对接编码" required><el-input v-model="form.code" maxlength="64" /></el-form-item><el-form-item label="对接名称" required><el-input v-model="form.name" maxlength="100" /></el-form-item><el-form-item label="服务类型" required><el-select v-model="form.provider"><el-option label="HTTP API" value="HTTP" /><el-option label="飞书" value="FEISHU" /><el-option label="企业微信" value="WECHAT" /><el-option label="自定义" value="CUSTOM" /></el-select></el-form-item><el-form-item label="服务地址" required><el-input v-model="form.baseUrl" placeholder="https://" /></el-form-item><el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item><el-form-item label="访问密钥"><el-input v-model="form.secret" type="password" show-password :placeholder="form.secretConfigured ? '留空保持现有密钥' : '请输入访问密钥'" /></el-form-item><el-form-item v-if="form.secretConfigured" label="密钥处理"><el-checkbox v-model="form.clearSecret">清除已有密钥</el-checkbox></el-form-item><el-form-item class="standard-form-wide" label="连接配置（JSON）"><el-input v-model="form.configText" type="textarea" :rows="8" /></el-form-item></el-form><template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submit">保存</el-button></template></el-dialog></section></template>
