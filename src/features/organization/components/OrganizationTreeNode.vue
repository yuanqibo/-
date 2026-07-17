<script setup lang="ts">
import { computed } from 'vue'
import type { OrganizationNode } from '../types/organization-directory'

defineOptions({ name: 'OrganizationTreeNode' })

const props = defineProps<{
  node: OrganizationNode
  selectedKey: string
  expandedKeys: Record<string, boolean>
}>()

const emit = defineEmits<{
  select: [key: string]
  toggle: [key: string, defaultExpanded: boolean]
}>()

const hasChildren = computed(() => (props.node.children || []).length > 0)
const defaultExpanded = computed(() => Number(props.node.level) <= 0)
const expanded = computed(() => hasChildren.value && (props.expandedKeys[props.node.key] ?? defaultExpanded.value))
const selected = computed(() => props.node.key === props.selectedKey)
const memberCount = computed(() => props.node.memberSubjects?.length || 0)
</script>

<template>
  <div class="ecp-org-tree-group" :style="{ '--org-level': String(Number(node.level) || 0) }">
    <div class="ecp-org-tree-row" :class="{ active: selected }">
      <button
        v-if="hasChildren"
        class="ecp-org-tree-toggle"
        type="button"
        :aria-expanded="expanded"
        :aria-label="`${expanded ? '收起' : '展开'}${node.name || '组织节点'}`"
        @click="emit('toggle', node.key, defaultExpanded)"
      >
        <span class="ecp-org-tree-caret" :class="{ expanded }" aria-hidden="true">›</span>
      </button>
      <span v-else class="ecp-org-tree-toggle-placeholder" aria-hidden="true" />

      <button
        class="ecp-org-tree-node"
        :class="{ active: selected }"
        type="button"
        :aria-current="selected ? 'true' : undefined"
        @click="emit('select', node.key)"
      >
        <span class="ecp-org-tree-name">{{ node.name || '未命名组织' }}</span>
        <span class="ecp-org-tree-count">{{ memberCount }}</span>
      </button>
    </div>

    <div
      v-if="hasChildren"
      class="ecp-org-tree-children"
      :class="{ collapsed: !expanded }"
      :aria-hidden="!expanded"
      :inert="!expanded"
    >
      <div class="ecp-org-tree-children-inner">
        <OrganizationTreeNode
          v-for="child in node.children"
          :key="child.key"
          :node="child"
          :selected-key="selectedKey"
          :expanded-keys="expandedKeys"
          @select="emit('select', $event)"
          @toggle="(key, childDefaultExpanded) => emit('toggle', key, childDefaultExpanded)"
        />
      </div>
    </div>
  </div>
</template>
