<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Close } from '@element-plus/icons-vue'
import type { ApprovalRecord } from '../types/approval'

const props = defineProps<{
  modelValue: boolean
  items: ApprovalRecord[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  select: [item: ApprovalRecord]
}>()

const activeTab = ref<'approval' | 'todo'>('approval')
const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

const displayType = (item: ApprovalRecord): string => {
  if (item.type === '资产退还') return '自助退还'
  if (item.type === '资产交接') return '自助交接'
  return item.type
}

const openRequest = (item: ApprovalRecord): void => emit('select', item)

watch(open, (visible) => {
  if (visible) activeTab.value = 'approval'
})
</script>

<template>
  <el-dialog
    v-model="open"
    class="approval-notification-dialog"
    width="min(920px, calc(100vw - 32px))"
    append-to-body
    title="消息通知"
    :show-close="false"
  >
    <template #header>
      <div class="approval-notification-header">
        <div>
          <h2>消息通知</h2>
          <span>{{ items.length }} 条待处理审批</span>
        </div>
        <button type="button" aria-label="关闭消息通知" title="关闭" @click="open = false">
          <el-icon><Close /></el-icon>
        </button>
      </div>
    </template>

    <div class="approval-notification-tabs" role="tablist" aria-label="消息分类">
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'approval'"
        :class="{ active: activeTab === 'approval' }"
        @click="activeTab = 'approval'"
      >
        审批消息
        <span v-if="items.length">{{ items.length }}</span>
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'todo'"
        :class="{ active: activeTab === 'todo' }"
        @click="activeTab = 'todo'"
      >
        业务待办
      </button>
    </div>

    <div class="approval-notification-content">
      <div v-if="!items.length" class="approval-notification-empty">
        <strong>暂无待处理审批</strong>
        <span>新的审批申请会在这里提醒。</span>
      </div>

      <div v-else-if="activeTab === 'approval'" class="approval-message-list">
        <article v-for="item in items" :key="item.id" class="approval-message-item">
          <span class="approval-message-avatar" aria-hidden="true">{{ item.applicant.trim().slice(0, 1) || '申' }}</span>
          <div class="approval-message-body">
            <p>
              您有一条由 <strong>{{ item.applicant }}</strong> 于 {{ item.date || '-' }} 提交的
              <strong>{{ displayType(item) }}</strong>待审批，申请单号：
              <button type="button" class="approval-message-link" @click="openRequest(item)">{{ item.id }}</button>
              ，请及时处理。
            </p>
            <div class="approval-message-meta">
              <span>{{ item.asset || '未填写关联资产' }}</span>
              <span>{{ item.currentNode || '管理员审批' }}</span>
            </div>
          </div>
        </article>
      </div>

      <div v-else class="approval-todo-list">
        <article v-for="item in items" :key="item.id" class="approval-todo-item">
          <span class="approval-todo-status" aria-hidden="true"></span>
          <div>
            <strong>{{ displayType(item) }} · {{ item.applicant }}</strong>
            <span>{{ item.id }} · {{ item.asset || '未填写关联资产' }} · {{ item.date || '-' }}</span>
          </div>
          <button type="button" @click="openRequest(item)">去处理</button>
        </article>
      </div>
    </div>

    <template #footer>
      <el-button type="primary" @click="open = false">确定</el-button>
    </template>
  </el-dialog>
</template>
