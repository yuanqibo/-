<script setup lang="ts">
import { onMounted } from 'vue'
import { useEmployeeDirectory } from '../composables/useEmployeeDirectory'

const {
  keyword,
  employees,
  page,
  currentPage,
  totalPages,
  loading,
  errorMessage,
  load,
  search,
  reset,
  goToPage
} = useEmployeeDirectory()

const statusLabel = (status: string | null): string => {
  const normalized = String(status || '').trim().toLowerCase()
  if (!normalized || ['enabled', 'active', 'normal', 'ok'].includes(normalized)) return '在用'
  if (['disabled', 'inactive', 'locked', 'deleted'].includes(normalized)) return '停用'
  return status
}

const statusClass = (status: string | null): string =>
  statusLabel(status) === '停用' ? 'is-disabled' : 'is-enabled'

const departmentLabel = (departments: Array<{ name: string | null }>): string =>
  departments?.map((department) => department.name).filter(Boolean).join('、') || '-'

onMounted(() => void load())
</script>

<template>
  <section class="panel employee-directory-panel employee-directory-feature" aria-labelledby="employee-directory-title">
    <header class="panel-header">
      <div>
        <h2 id="employee-directory-title" class="panel-title">员工信息</h2>
        <div class="panel-subtitle">{{ page.total }} 个 ECP 目录账号</div>
      </div>
    </header>

    <form class="toolbar employee-directory-toolbar" role="search" @submit.prevent="search">
      <input
        v-model="keyword"
        type="search"
        placeholder="搜索名称或编码"
        autocomplete="off"
        spellcheck="false"
        aria-label="搜索名称或编码"
      >
      <button class="btn primary" type="submit" :disabled="loading">查询</button>
      <button class="btn" type="button" :disabled="loading" @click="reset">重置</button>
    </form>

    <div v-if="errorMessage" class="employee-directory-message is-error" role="alert">
      <span>{{ errorMessage }}</span>
      <button class="btn" type="button" @click="load(currentPage)">重新加载</button>
    </div>

    <div class="table-wrap employee-directory-table-wrap" :aria-busy="loading">
      <table>
        <thead>
          <tr>
            <th>姓名</th>
            <th>工号</th>
            <th>岗位</th>
            <th>所属公司</th>
            <th>部门</th>
            <th>ECP Subject</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="employee in employees" :key="employee.subject">
            <td>{{ employee.name || employee.displayName || '-' }}</td>
            <td>{{ employee.employeeNo || '-' }}</td>
            <td>{{ employee.jobTitle || '-' }}</td>
            <td>{{ employee.company?.name || '-' }}</td>
            <td>{{ departmentLabel(employee.departments) }}</td>
            <td><code>{{ employee.subject || '-' }}</code></td>
            <td><span class="employee-status" :class="statusClass(employee.status)">{{ statusLabel(employee.status) }}</span></td>
          </tr>
          <tr v-if="!loading && !errorMessage && !employees.length" class="empty-row">
            <td colspan="7">当前范围内没有员工目录数据。</td>
          </tr>
        </tbody>
      </table>
      <div v-if="loading" class="employee-directory-loading" role="status">正在加载员工目录...</div>
    </div>

    <footer v-if="!errorMessage && page.total > 0" class="employee-directory-pagination">
      <span>共 {{ page.total }} 条</span>
      <button class="btn" type="button" :disabled="loading || currentPage <= 1" aria-label="上一页" @click="goToPage(currentPage - 1)">上一页</button>
      <span>第 {{ currentPage }} / {{ Math.max(totalPages, 1) }} 页</span>
      <button class="btn" type="button" :disabled="loading || !page.hasNext" aria-label="下一页" @click="goToPage(currentPage + 1)">下一页</button>
    </footer>
  </section>
</template>
