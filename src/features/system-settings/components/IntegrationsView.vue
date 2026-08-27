<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ApiError } from '../../../shared/api/http'
import { fetchLegacyAssetSyncHistory, fetchLegacyAssetSyncStatus, runLegacyAssetFullSync } from '../api/system-settings.api'
import { useSystemSettings } from '../composables/useSystemSettings'
import type { LegacyAssetSyncRun, LegacyAssetSyncStatus, SystemIntegration } from '../types/system-settings'
import { usePortalSession } from '../../../core/auth/portal-session'

const { state, integrations, loadIntegrations, saveIntegration } = useSystemSettings()
const { user } = usePortalSession()
const permissions = computed(() => new Set(user.value?.permissionCodes || []))
const dialogOpen = ref(false)
const historyOpen = ref(false)
const submitting = ref(false)
const historyPage = ref(1)
const historyPageSize = ref(10)
const fullSyncing = ref(false)
const sync = reactive({
  status: null as LegacyAssetSyncStatus | null,
  history: [] as LegacyAssetSyncRun[],
  historyTotal: 0,
  loading: false,
  errorMessage: ''
})
const form = reactive({ id: '', code: '', name: '', provider: 'HTTP', baseUrl: '', enabled: true, configText: '{}', secret: '', clearSecret: false, secretConfigured: false, version: 0 })

const open = (item?: SystemIntegration): void => {
  Object.assign(form, item
    ? { ...item, configText: JSON.stringify(item.config || {}, null, 2), secret: '', clearSecret: false }
    : { id: '', code: '', name: '', provider: 'HTTP', baseUrl: '', enabled: true, configText: '{}', secret: '', clearSecret: false, secretConfigured: false, version: 0 })
  dialogOpen.value = true
}

const submit = async (): Promise<void> => {
  let config: Record<string, unknown>
  try { config = JSON.parse(form.configText) } catch { ElMessage.warning('连接配置必须是有效 JSON'); return }
  submitting.value = true
  try {
    await saveIntegration({ id: form.id || undefined, code: form.code, name: form.name, provider: form.provider, baseUrl: form.baseUrl, enabled: form.enabled, config, secret: form.secret || undefined, clearSecret: form.clearSecret, version: form.version })
    dialogOpen.value = false
    ElMessage.success('系统对接配置已保存')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    submitting.value = false
  }
}

const loadLegacyAssetSync = async (): Promise<void> => {
  sync.loading = true
  sync.errorMessage = ''
  try {
    const [status, history] = await Promise.all([fetchLegacyAssetSyncStatus(), fetchLegacyAssetSyncHistory(historyPage.value, historyPageSize.value)])
    sync.status = status
    sync.history = history.items || []
    sync.historyTotal = history.total || 0
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      sync.status = null
      sync.history = []
      sync.historyTotal = 0
      return
    }
    sync.errorMessage = error instanceof Error ? error.message : '同步状态加载失败'
  } finally {
    sync.loading = false
  }
}

const changeHistoryPage = (page: number): void => {
  historyPage.value = page
  void loadLegacyAssetSync()
}

const changeHistoryPageSize = (pageSize: number): void => {
  historyPageSize.value = pageSize
  historyPage.value = 1
  void loadLegacyAssetSync()
}

const runFullSync = async (): Promise<void> => {
  try {
    await ElMessageBox.confirm('将重新读取 AMS 全部资产，仅更新当前系统展示数据，不会回写 AMS。', '全量复核', {
      type: 'warning',
      confirmButtonText: '开始复核',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  fullSyncing.value = true
  try {
    sync.status = await runLegacyAssetFullSync()
    ElMessage.success('全量复核已完成')
    await loadLegacyAssetSync()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '全量复核失败')
  } finally {
    fullSyncing.value = false
  }
}

const integrationCount = computed(() => integrations.value.length + (sync.status ? 1 : 0))
const latestSyncTime = computed(() => sync.status?.completedAt || sync.status?.startedAt)
const scheduleLabel = computed(() => sync.status?.schedule === '0 0/30 * * * *' ? '每 30 分钟' : (sync.status?.schedule || '-'))

const syncStatusLabel = (value?: string): string => ({ RUNNING: '同步中', SUCCESS: '成功', FAILED: '失败' }[value || ''] || '待执行')
const syncStatusTone = (value?: string): string => ({ RUNNING: 'blue', SUCCESS: 'green', FAILED: 'red' }[value || ''] || 'gray')
const formatTimestamp = (value?: string): string => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

onMounted(() => {
  void loadIntegrations()
  void loadLegacyAssetSync()
})

watch(historyOpen, (open) => {
  if (open) {
    historyPage.value = 1
    void loadLegacyAssetSync()
  }
})
</script>

<template>
  <div class="system-content">
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">系统对接</h2>
          <div class="panel-subtitle">{{ integrationCount }} 个连接配置</div>
        </div>
        <div class="legacy-sync-actions">
          <el-tooltip content="刷新同步状态" placement="top">
            <el-button :icon="Refresh" circle :loading="sync.loading" aria-label="刷新同步状态" @click="loadLegacyAssetSync" />
          </el-tooltip>
          <button v-if="permissions.has('asset:integration:create')" class="btn primary" type="button" @click="open()">新增连接</button>
        </div>
      </div>

      <el-alert v-if="sync.errorMessage" class="legacy-sync-alert" type="error" :title="sync.errorMessage" show-icon :closable="false" />

      <div v-loading="state.loading || sync.loading" class="table-wrap">
        <table class="integration-table">
          <thead>
            <tr>
              <th>编码</th>
              <th>名称</th>
              <th>提供方</th>
              <th>基础地址</th>
              <th>状态</th>
              <th>密钥</th>
              <th>版本</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="sync.status" class="legacy-sync-row">
              <td><code>LEGACY_AMS_ASSET_SYNC</code></td>
              <td>
                <span class="legacy-sync-name">AMS资产同步</span>
                <span class="legacy-sync-schedule">{{ scheduleLabel }} · {{ sync.status.timeZone }}</span>
              </td>
              <td>Bear Rental AMS</td>
              <td>{{ sync.status.baseUrl || 'https://ams.bearrental.com' }}</td>
              <td><span class="tag" :class="syncStatusTone(sync.status.status)">{{ syncStatusLabel(sync.status.status) }}</span></td>
              <td><span class="tag">服务器已配置</span></td>
              <td><span class="tag blue">运行配置</span></td>
              <td>{{ formatTimestamp(latestSyncTime) }}</td>
              <td><button class="btn" type="button" @click="historyOpen = true">同步记录</button><button v-if="permissions.has('asset:integration:update')" class="btn" type="button" :disabled="fullSyncing || sync.loading" @click="runFullSync">{{ fullSyncing ? '复核中...' : '全量复核' }}</button></td>
            </tr>
            <tr v-for="item in integrations" :key="item.id">
              <td><code>{{ item.code }}</code></td>
              <td>{{ item.name }}</td>
              <td>{{ item.provider }}</td>
              <td>{{ item.baseUrl }}</td>
              <td><span class="tag" :class="item.enabled ? 'green' : 'gray'">{{ item.enabled ? '在用' : '已取消' }}</span></td>
              <td><span class="tag" :class="item.secretConfigured ? '' : 'gray'">{{ item.secretConfigured ? '已配置' : '未配置' }}</span></td>
              <td>{{ item.version || 1 }}</td>
              <td>{{ formatTimestamp(item.updatedAt) }}</td>
              <td><button v-if="permissions.has('asset:integration:update')" class="btn" type="button" @click="open(item)">编辑</button><span v-else>-</span></td>
            </tr>
            <tr v-if="!integrations.length && !sync.status" class="empty-row">
              <td colspan="9">当前范围内没有系统连接配置。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <el-alert v-if="state.errorMessage" type="error" :title="state.errorMessage" show-icon :closable="false" />

    <el-dialog v-model="historyOpen" class="legacy-sync-history-dialog" title="AMS资产同步记录" width="min(1080px, 94vw)" align-center append-to-body>
      <div class="legacy-sync-history-meta">
        <span>同步频率：{{ scheduleLabel }}</span>
        <span>时区：{{ sync.status?.timeZone || '-' }}</span>
        <span>同步方向：AMS → 当前系统</span>
      </div>
      <div v-loading="sync.loading" class="table-wrap legacy-sync-history-table">
        <table>
          <thead>
            <tr>
              <th>开始时间</th>
              <th>结束时间</th>
              <th>状态</th>
              <th>读取</th>
              <th>写入</th>
              <th>失败</th>
              <th>异常信息</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in sync.history" :key="item.id">
              <td>{{ formatTimestamp(item.startedAt) }}</td>
              <td>{{ formatTimestamp(item.completedAt) }}</td>
              <td><span class="tag" :class="syncStatusTone(item.status)">{{ syncStatusLabel(item.status) }}</span></td>
              <td>{{ item.fetchedCount }}</td>
              <td>{{ item.appliedCount }}</td>
              <td>{{ item.failedCount }}</td>
              <td class="legacy-sync-error" :title="item.errorMessage || '-'">{{ item.errorMessage || '-' }}</td>
            </tr>
            <tr v-if="!sync.history.length" class="empty-row">
              <td colspan="7">尚无同步执行记录。</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="sync.historyTotal > 0" class="legacy-sync-history-pagination">
        <el-pagination
          class="legacy-sync-history-pagination-controls"
          background
          small
          layout="prev, pager, next"
          :current-page="historyPage"
          :page-size="historyPageSize"
          :total="sync.historyTotal"
          :disabled="sync.loading"
          @current-change="changeHistoryPage"
        />
        <el-select
          :model-value="historyPageSize"
          class="legacy-sync-history-page-size"
          aria-label="同步记录每页条数"
          placement="top-start"
          :disabled="sync.loading"
          @update:model-value="changeHistoryPageSize"
        >
          <el-option label="10 条/页" :value="10" />
          <el-option label="20 条/页" :value="20" />
          <el-option label="50 条/页" :value="50" />
        </el-select>
      </div>
    </el-dialog>

    <el-dialog v-model="dialogOpen" :title="form.id ? '编辑系统对接' : '新增系统对接'" width="min(760px, 94vw)" append-to-body>
      <el-form label-position="top" class="standard-form-grid">
        <el-form-item label="对接编码" required><el-input v-model="form.code" maxlength="64" /></el-form-item>
        <el-form-item label="对接名称" required><el-input v-model="form.name" maxlength="100" /></el-form-item>
        <el-form-item label="服务类型" required><el-select v-model="form.provider"><el-option label="HTTP API" value="HTTP" /><el-option label="飞书" value="FEISHU" /><el-option label="企业微信" value="WECHAT" /><el-option label="自定义" value="CUSTOM" /></el-select></el-form-item>
        <el-form-item label="服务地址" required><el-input v-model="form.baseUrl" placeholder="https://" /></el-form-item>
        <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
        <el-form-item label="访问密钥"><el-input v-model="form.secret" type="password" show-password :placeholder="form.secretConfigured ? '留空保持现有密钥' : '请输入访问密钥'" /></el-form-item>
        <el-form-item v-if="form.secretConfigured" label="密钥处理"><el-checkbox v-model="form.clearSecret">清除已有密钥</el-checkbox></el-form-item>
        <el-form-item class="standard-form-wide" label="连接配置（JSON）"><el-input v-model="form.configText" type="textarea" :rows="8" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submit">保存</el-button></template>
    </el-dialog>
  </div>
</template>
