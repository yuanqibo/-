<script setup lang="ts">
import { computed } from 'vue'
import { Close } from '@element-plus/icons-vue'
import type { OrganizationMember } from '../types/organization-directory'

const props = defineProps<{
  modelValue: boolean
  member: OrganizationMember | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

type DetailField = {
  label: string
  value: string
  wide?: boolean
}

const text = (value: unknown): string => String(value || '').trim() || '--'

const statusLabel = (status: string | null): string => {
  const normalized = String(status || '').trim().toLowerCase()
  if (!normalized || ['enabled', 'active', 'normal', 'ok', '在用'].includes(normalized)) return '正常'
  if (['disabled', 'inactive', 'locked', 'deleted', '停用', '禁用'].includes(normalized)) return '停用'
  return status || '--'
}

const sourceLabel = (member: OrganizationMember | null): string => {
  const source = String(member?.accountSetSourceType || '').toUpperCase()
  const sourceText = source === 'FEISHU' || source === 'LARK'
    ? '飞书'
    : source === 'DINGTALK'
      ? '钉钉'
      : source === 'WECHAT_WORK'
        ? '企微'
        : member?.accountSetSourceType || ''
  const syncMode = String(member?.accountSetSyncMode || '').toLowerCase()
  const modeText = syncMode.includes('auto') ? '自动同步' : syncMode.includes('manual') ? '手动维护' : ''
  return `${sourceText}${modeText}` || '--'
}

const fields = computed<DetailField[]>(() => {
  const member = props.member
  if (!member) return []
  const departments = member.departments.map((department) => department.name).filter(Boolean).join('、') || member.department
  const departmentLeaders = [...new Set(member.departments.map((department) => department.leaderName).filter(Boolean))].join('、')
  return [
    { label: 'external_id', value: text(member.externalId || member.subject), wide: true },
    { label: 'union_id', value: text(member.unionId || member.subject), wide: true },
    { label: '岗位', value: text(member.jobTitle) },
    { label: '账号状态', value: statusLabel(member.status) },
    { label: '部门', value: text(departments), wide: true },
    { label: '负责部门', value: text(departmentLeaders) },
    { label: '所属公司', value: text(member.company) },
    { label: '邮箱', value: text(member.email), wide: true },
    { label: '手机', value: text(member.phone) },
    { label: '来源类型', value: sourceLabel(member) },
    { label: '账号集', value: text(member.accountSetName), wide: true }
  ]
})
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    class="ecp-member-detail-drawer"
    direction="rtl"
    size="min(620px, 94vw)"
    append-to-body
    destroy-on-close
    :with-header="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="member" class="drawer-header">
      <div>
        <div class="eyebrow">成员详情</div>
        <h2>{{ member.name || '未命名成员' }}</h2>
      </div>
      <el-button class="icon-button" text :icon="Close" aria-label="关闭" title="关闭" @click="emit('update:modelValue', false)" />
    </div>
    <div v-if="member" class="drawer-body">
      <div class="ecp-member-detail-page">
        <div class="ecp-member-detail-employee-no">{{ member.employeeNo || '--' }}</div>
        <div class="ecp-member-detail-grid">
          <div v-for="field in fields" :key="field.label" class="ecp-member-detail-field" :class="{ wide: field.wide }">
            <div class="ecp-member-detail-label">{{ field.label }}</div>
            <div class="ecp-member-detail-value">{{ field.value }}</div>
          </div>
        </div>
      </div>
    </div>
  </el-drawer>
</template>
