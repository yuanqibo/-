<script setup lang="ts">
import { onMounted } from 'vue'
import { RefreshLeft, Search } from '@element-plus/icons-vue'
import type { TagProps } from 'element-plus'
import { useEmployeeDirectory } from '../composables/useEmployeeDirectory'
import type { DirectoryDepartment } from '../types/employee-directory'

const {
  keyword,
  employees,
  page,
  currentPage,
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
  return status || '未知'
}

const statusType = (status: string | null): TagProps['type'] => {
  const label = statusLabel(status)
  if (label === '在用') return 'success'
  if (label === '停用') return 'info'
  return 'warning'
}

const departmentLabel = (departments: DirectoryDepartment[]): string =>
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

    <el-form class="employee-directory-toolbar" inline role="search" @submit.prevent="search">
      <el-form-item>
        <el-input
          v-model="keyword"
          type="search"
          placeholder="搜索名称或编码"
          clearable
          :prefix-icon="Search"
          aria-label="搜索名称或编码"
          @keyup.enter="search"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" :loading="loading" native-type="submit">查询</el-button>
        <el-button :icon="RefreshLeft" :disabled="loading" @click="reset">重置</el-button>
      </el-form-item>
    </el-form>

    <div v-if="errorMessage" class="employee-directory-message" role="alert">
      <el-alert :title="errorMessage" type="error" show-icon :closable="false" />
      <el-button type="primary" plain @click="load(currentPage)">重新加载</el-button>
    </div>

    <div class="employee-directory-table-wrap">
      <el-table
        v-loading="loading"
        :data="employees"
        height="100%"
        stripe
        empty-text="当前范围内没有员工目录数据"
        row-key="subject"
      >
        <el-table-column prop="name" label="姓名" min-width="130">
          <template #default="{ row }">{{ row.name || row.displayName || '-' }}</template>
        </el-table-column>
        <el-table-column prop="employeeNo" label="工号" min-width="120">
          <template #default="{ row }">{{ row.employeeNo || '-' }}</template>
        </el-table-column>
        <el-table-column prop="jobTitle" label="岗位" min-width="140">
          <template #default="{ row }">{{ row.jobTitle || '-' }}</template>
        </el-table-column>
        <el-table-column label="所属公司" min-width="220">
          <template #default="{ row }">{{ row.company?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="部门" min-width="180">
          <template #default="{ row }">{{ departmentLabel(row.departments) }}</template>
        </el-table-column>
        <el-table-column prop="subject" label="ECP Subject" min-width="260">
          <template #default="{ row }"><code>{{ row.subject || '-' }}</code></template>
        </el-table-column>
        <el-table-column label="状态" width="100" fixed="right">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" effect="light">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <footer v-if="!errorMessage && page.total > 0" class="employee-directory-pagination">
      <el-pagination
        background
        small
        layout="total, prev, pager, next"
        :current-page="currentPage"
        :page-size="page.size"
        :total="page.total"
        :disabled="loading"
        @current-change="goToPage"
      />
    </footer>
  </section>
</template>
