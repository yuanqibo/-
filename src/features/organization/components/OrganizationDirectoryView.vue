<script setup lang="ts">
import { onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import { accountSetLabel, useOrganizationDirectory } from '../composables/useOrganizationDirectory'
import type {
  OrganizationAccountStatus,
  OrganizationFilterOption,
  OrganizationMemberScope
} from '../types/organization-directory'
import OrganizationFilterSelect from './OrganizationFilterSelect.vue'
import OrganizationMemberDrawer from './OrganizationMemberDrawer.vue'
import OrganizationTreeNode from './OrganizationTreeNode.vue'

const scopeOptions: OrganizationFilterOption<OrganizationMemberScope>[] = [
  { value: 'all', label: '展示全部成员' },
  { value: 'direct', label: '仅直属成员' }
]

const statusOptions: OrganizationFilterOption<OrganizationAccountStatus>[] = [
  { value: 'all', label: '全部账号', triggerLabel: '全部' },
  { value: 'enabled', label: '只看启用', triggerLabel: '启用' },
  { value: 'disabled', label: '只看停用', triggerLabel: '停用' }
]

const {
  organization,
  accountSets,
  selectedAccountSet,
  roots,
  selectedNode,
  selectedNodeKey,
  selectedTotal,
  expandedKeys,
  keyword,
  memberScope,
  accountStatus,
  visibleMembers,
  total,
  currentPage,
  pageSize,
  loading,
  initializing,
  errorMessage,
  detailMember,
  detailOpen,
  load,
  initializeAccountSets,
  selectAccountSet,
  selectNode,
  toggleNode,
  openMemberDetail
} = useOrganizationDirectory()

const accountInitial = (name: string | null): string => {
  const value = String(name || '').trim()
  const ascii = value.match(/[a-zA-Z0-9]/)
  return (ascii ? ascii[0] : value.slice(0, 1) || 'a').toUpperCase()
}

const statusClass = (status: string | null): string => {
  const normalized = String(status || '').trim().toLowerCase()
  if (['enabled', 'active', 'normal', 'ok', '在用'].includes(normalized)) return 'green'
  if (['disabled', 'inactive', 'locked', 'deleted', '停用', '禁用'].includes(normalized)) return 'gray'
  return 'gray'
}

const leaderDepartments = (value: string[] | null | undefined): string => {
  const names = [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean))]
  return names.join('、') || '--'
}

const formatJsonPreview = (payload: unknown): string => {
  if (payload == null || payload === '') return 'ECP 已返回成功。'
  const value = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  return value.length > 3000 ? `${value.slice(0, 3000)}\n...` : value
}

const initialize = async (): Promise<void> => {
  try {
    const payload = await initializeAccountSets()
    await ElMessageBox.alert(
      `ECP 初始化账号 / 账号集列表读取成功：\n${formatJsonPreview(payload)}`,
      'ECP 初始化账号',
      { confirmButtonText: '确定' }
    )
  } catch (error) {
    await ElMessageBox.alert(
      `ECP 操作失败：\n${error instanceof Error ? error.message : '未知错误'}\n\n如果这里仍提示 Permission denied，就说明当前登录账号在 ECP 管理端缺少对应账号集治理权限。`,
      'ECP 操作失败',
      { type: 'error', confirmButtonText: '确定' }
    )
  }
}

onMounted(() => void load())
</script>

<template>
  <section class="panel ecp-org-console organization-directory-feature" aria-labelledby="organization-directory-title">
    <template v-if="errorMessage && !organization">
      <div class="organization-directory-error">
        <h2 id="organization-directory-title" class="panel-title">组织架构</h2>
        <p class="empty-note">ECP 组织架构暂未加载成功。请确认当前账号有 asset:department:view，并刷新页面重试。</p>
        <el-alert :title="errorMessage" type="error" show-icon :closable="false" />
        <el-button type="primary" :loading="loading" @click="load">重新加载</el-button>
      </div>
    </template>

    <template v-else>
      <div class="ecp-org-tabs">
        <button class="ecp-org-tab muted" type="button" :disabled="initializing" @click="initialize">初始化账号</button>
        <template v-if="accountSets.length">
          <button
            v-for="accountSet in accountSets"
            :key="accountSet.unionId || accountSet.name || 'account-set'"
            class="ecp-org-tab"
            :class="{ active: accountSet.unionId === selectedAccountSet?.unionId }"
            type="button"
            @click="selectAccountSet(String(accountSet.unionId || ''))"
          >
            {{ accountSetLabel(accountSet) }}
          </button>
        </template>
        <button v-else class="ecp-org-tab active" type="button" disabled>ECP账号集</button>
        <button class="ecp-org-tab add" type="button" :disabled="initializing" title="读取 ECP 账号集初始化数据" aria-label="读取 ECP 账号集初始化数据" @click="initialize">
          <el-icon><Plus /></el-icon>
        </button>
      </div>

      <div class="ecp-org-policy-bar">
        <div>
          <h2 id="organization-directory-title" class="panel-title">账号策略配置</h2>
          <div class="panel-subtitle">用于管理账号集的数据来源、同步状态与组织结构配置。</div>
        </div>
      </div>

      <div v-loading="loading" class="ecp-org-layout">
        <aside class="ecp-org-tree-panel">
          <div class="ecp-org-search">
            <el-input
              v-model="keyword"
              type="search"
              placeholder="搜索名称或编码"
              aria-label="搜索名称或编码"
              autocomplete="off"
              clearable
            />
          </div>
          <div class="ecp-org-tree-scroll">
            <OrganizationTreeNode
              v-for="root in roots"
              :key="root.key"
              :node="root"
              :selected-key="selectedNodeKey"
              :expanded-keys="expandedKeys"
              @select="selectNode"
              @toggle="toggleNode"
            />
            <p v-if="!roots.length && !loading" class="empty-note">ECP 当前未返回组织树。</p>
          </div>
        </aside>

        <main class="ecp-org-member-panel">
          <div class="ecp-org-member-header">
            <div>
              <h2>{{ selectedNode?.name || '组织架构' }}</h2>
              <div class="panel-subtitle">总人数 {{ selectedTotal }}</div>
            </div>
            <div class="ecp-org-filters">
              <OrganizationFilterSelect
                v-model="memberScope"
                :options="scopeOptions"
                label="成员范围"
              />
              <OrganizationFilterSelect
                v-model="accountStatus"
                :options="statusOptions"
                label="账号状态"
                prefix="账号状态"
                status
              />
            </div>
          </div>

          <div class="table-wrap ecp-org-table-wrap">
            <table class="ecp-org-table">
              <colgroup>
                <col class="ecp-org-col-name">
                <col class="ecp-org-col-no">
                <col class="ecp-org-col-email">
                <col class="ecp-org-col-department">
                <col class="ecp-org-col-owner">
                <col class="ecp-org-col-status">
                <col class="ecp-org-col-job">
                <col class="ecp-org-col-action">
              </colgroup>
              <thead>
                <tr><th>姓名</th><th>工号</th><th>邮箱</th><th>部门</th><th>负责部门</th><th>账号状态</th><th>岗位</th><th>操作</th></tr>
              </thead>
              <tbody>
                <tr v-for="member in visibleMembers" :key="member.subject">
                  <td :title="member.name || '-'">
                    <span class="ecp-org-user-cell">
                      <span class="ecp-org-avatar">{{ accountInitial(member.name) }}</span>
                      <span class="ecp-org-user-name">{{ member.name || '-' }}</span>
                    </span>
                  </td>
                  <td :title="member.employeeNo || '-'">{{ member.employeeNo || '-' }}</td>
                  <td :title="member.email || '-'">{{ member.email || '-' }}</td>
                  <td :title="member.department || '-'">{{ member.department || '-' }}</td>
                  <td :title="leaderDepartments(member.leaderDepartmentNames)">{{ leaderDepartments(member.leaderDepartmentNames) }}</td>
                  <td><span class="tag" :class="statusClass(member.status)">{{ member.status || 'enabled' }}</span></td>
                  <td :title="member.jobTitle || '-'">{{ member.jobTitle || '-' }}</td>
                  <td><button class="link" type="button" @click="openMemberDetail(member)">详情</button></td>
                </tr>
                <tr v-if="!visibleMembers.length && !loading" class="empty-row"><td colspan="8">当前组织节点没有可展示的成员。</td></tr>
              </tbody>
            </table>
          </div>

          <el-pagination
            v-if="total > 0"
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            class="asset-list-pagination ecp-org-pagination"
            background
            layout="total, prev, pager, next, sizes, jumper"
            :page-sizes="[20, 50]"
            :total="total"
            :disabled="loading"
          />
        </main>
      </div>
    </template>

    <OrganizationMemberDrawer v-model="detailOpen" :member="detailMember" />
  </section>
</template>
