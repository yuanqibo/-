<script setup lang="ts">
import { computed, ref } from 'vue'
import manualMarkdown from '../../../docs/系统操作手册_审阅稿.md?raw'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const manualBody = ref<HTMLElement>()

const slug = (value: string): string => value
  .trim()
  .toLowerCase()
  .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

const headings = computed(() => manualMarkdown.split('\n')
  .filter((line) => /^## /.test(line))
  .map((line) => {
    const title = line.slice(3).trim()
    return { title, id: slug(title) }
  }))

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const inlineMarkup = (value: string): string => escapeHtml(value)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')

const renderMarkdown = (source: string): string => {
  const output: string[] = []
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  let listType: 'ul' | 'ol' | '' = ''
  let tableRows: string[][] = []

  const closeList = (): void => {
    if (listType) output.push(`</${listType}>`)
    listType = ''
  }
  const flushTable = (): void => {
    if (!tableRows.length) return
    const [head, ...body] = tableRows
    output.push('<table><thead><tr>', ...head.map((cell) => `<th>${inlineMarkup(cell)}</th>`), '</tr></thead><tbody>')
    body.forEach((row) => output.push('<tr>', ...row.map((cell) => `<td>${inlineMarkup(cell)}</td>`), '</tr>'))
    output.push('</tbody></table>')
    tableRows = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line.startsWith('|')) {
      closeList()
      const cells = line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
      if (!cells.every((cell) => /^[-: ]+$/.test(cell))) tableRows.push(cells)
      continue
    }
    flushTable()
    if (!line) {
      closeList()
      continue
    }
    if (line === '---') {
      closeList()
      output.push('<hr>')
      continue
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line)
    if (heading) {
      closeList()
      const level = heading[1].length
      const title = heading[2].trim()
      output.push(`<h${level + 1} id="${slug(title)}">${inlineMarkup(title)}</h${level + 1}>`)
      continue
    }
    const bullet = /^-\s+(.+)$/.exec(line)
    if (bullet) {
      if (listType !== 'ul') {
        closeList()
        listType = 'ul'
        output.push('<ul>')
      }
      output.push(`<li>${inlineMarkup(bullet[1])}</li>`)
      continue
    }
    const numbered = /^\d+\.\s+(.+)$/.exec(line)
    if (numbered) {
      if (listType !== 'ol') {
        closeList()
        listType = 'ol'
        output.push('<ol>')
      }
      output.push(`<li>${inlineMarkup(numbered[1])}</li>`)
      continue
    }
    closeList()
    output.push(`<p>${inlineMarkup(line)}</p>`)
  }
  flushTable()
  closeList()
  return output.join('')
}

const renderedManual = computed(() => renderMarkdown(manualMarkdown))

const close = (): void => emit('update:modelValue', false)
const openSection = (id: string): void => {
  const target = manualBody.value?.querySelector<HTMLElement>(`#${id}`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

defineExpose({ close })
</script>

<template>
  <el-dialog
    :model-value="props.modelValue"
    title="系统使用说明"
    width="min(1180px, 94vw)"
    top="4vh"
    class="system-manual-dialog"
    append-to-body
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="system-manual-layout">
      <aside class="system-manual-outline" aria-label="手册目录">
        <div class="system-manual-outline-title">目录</div>
        <button
          v-for="item in headings"
          :key="item.id"
          class="system-manual-outline-item"
          type="button"
          @click="openSection(item.id)"
        >{{ item.title }}</button>
      </aside>
      <article ref="manualBody" class="system-manual-body" aria-label="系统操作手册" v-html="renderedManual"></article>
    </div>
  </el-dialog>
</template>
