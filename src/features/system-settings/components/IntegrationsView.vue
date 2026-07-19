<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useSystemSettings } from '../composables/useSystemSettings'
import type { SystemIntegration } from '../types/system-settings'
import { usePortalSession } from '../../../core/auth/portal-session'

const { state, integrations, loadIntegrations, saveIntegration } = useSystemSettings()
const { user } = usePortalSession()
const permissions = computed(() => new Set(user.value?.permissionCodes || []))
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
const formatTimestamp = (value?: string): string => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'
</script>

<template><div class="system-content"><section class="panel"><div class="panel-header"><div><h2 class="panel-title">系统对接</h2><div class="panel-subtitle">{{ integrations.length }} 个连接配置</div></div><button v-if="permissions.has('asset:integration:create')" class="btn primary" type="button" @click="open()">新增连接</button></div><div v-loading="state.loading" class="table-wrap"><table><thead><tr><th>编码</th><th>名称</th><th>提供方</th><th>基础地址</th><th>状态</th><th>密钥</th><th>版本</th><th>更新时间</th><th>操作</th></tr></thead><tbody><tr v-for="item in integrations" :key="item.id"><td><code>{{ item.code }}</code></td><td>{{ item.name }}</td><td>{{ item.provider }}</td><td>{{ item.baseUrl }}</td><td><span class="tag" :class="item.enabled ? 'green' : 'gray'">{{ item.enabled ? '在用' : '已取消' }}</span></td><td><span class="tag" :class="item.secretConfigured ? '' : 'gray'">{{ item.secretConfigured ? '已配置' : '未配置' }}</span></td><td>{{ item.version || 1 }}</td><td>{{ formatTimestamp(item.updatedAt) }}</td><td><button v-if="permissions.has('asset:integration:update')" class="btn" type="button" @click="open(item)">编辑</button><span v-else>-</span></td></tr><tr v-if="!integrations.length" class="empty-row"><td colspan="9">当前范围内没有系统连接配置。</td></tr></tbody></table></div></section><el-alert v-if="state.errorMessage" type="error" :title="state.errorMessage" show-icon :closable="false" />
<el-dialog v-model="dialogOpen" :title="form.id ? '编辑系统对接' : '新增系统对接'" width="min(760px, 94vw)" append-to-body><el-form label-position="top" class="standard-form-grid"><el-form-item label="对接编码" required><el-input v-model="form.code" maxlength="64" /></el-form-item><el-form-item label="对接名称" required><el-input v-model="form.name" maxlength="100" /></el-form-item><el-form-item label="服务类型" required><el-select v-model="form.provider"><el-option label="HTTP API" value="HTTP" /><el-option label="飞书" value="FEISHU" /><el-option label="企业微信" value="WECHAT" /><el-option label="自定义" value="CUSTOM" /></el-select></el-form-item><el-form-item label="服务地址" required><el-input v-model="form.baseUrl" placeholder="https://" /></el-form-item><el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item><el-form-item label="访问密钥"><el-input v-model="form.secret" type="password" show-password :placeholder="form.secretConfigured ? '留空保持现有密钥' : '请输入访问密钥'" /></el-form-item><el-form-item v-if="form.secretConfigured" label="密钥处理"><el-checkbox v-model="form.clearSecret">清除已有密钥</el-checkbox></el-form-item><el-form-item class="standard-form-wide" label="连接配置（JSON）"><el-input v-model="form.configText" type="textarea" :rows="8" /></el-form-item></el-form><template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submit">保存</el-button></template></el-dialog></div></template>
