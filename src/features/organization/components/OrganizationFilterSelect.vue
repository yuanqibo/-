<script setup lang="ts" generic="T extends string">
import { computed, ref } from 'vue'
import type { OrganizationFilterOption } from '../types/organization-directory'

const props = defineProps<{
  modelValue: T
  options: OrganizationFilterOption<T>[]
  label: string
  prefix?: string
  status?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: T]
}>()

const open = ref(false)
const selected = computed(() => props.options.find((option) => option.value === props.modelValue) || props.options[0])

const choose = (value: T): void => {
  emit('update:modelValue', value)
  open.value = false
}
</script>

<template>
  <div class="ecp-org-filter" :class="[{ open, status }, status ? 'status' : 'scope']">
    <el-popover
      v-model:visible="open"
      trigger="click"
      placement="bottom-start"
      :width="status ? 144 : 132"
      :teleported="false"
      :show-arrow="false"
      :hide-after="0"
      popper-class="ecp-org-filter-popper"
    >
      <template #reference>
        <button
          class="ecp-org-filter-trigger"
          type="button"
          aria-haspopup="listbox"
          :aria-expanded="open"
          :aria-label="label"
        >
          <span class="ecp-org-filter-label">
            <span v-if="prefix" class="ecp-org-filter-prefix">{{ prefix }}</span>
            {{ selected?.triggerLabel || selected?.label }}
          </span>
          <span class="ecp-org-filter-caret" aria-hidden="true" />
        </button>
      </template>
      <div class="ecp-org-filter-options" role="listbox" :aria-label="label">
        <button
          v-for="option in options"
          :key="option.value"
          class="ecp-org-filter-option"
          :class="{ selected: option.value === selected?.value }"
          type="button"
          role="option"
          :aria-selected="option.value === selected?.value"
          @click="choose(option.value)"
        >
          <span class="ecp-org-filter-check" aria-hidden="true">{{ option.value === selected?.value ? '✓' : '' }}</span>
          <span>{{ option.label }}</span>
        </button>
      </div>
    </el-popover>
  </div>
</template>
