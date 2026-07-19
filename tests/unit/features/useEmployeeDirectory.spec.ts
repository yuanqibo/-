import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirectoryEmployeePage } from '../../../src/features/employees/types/employee-directory'

const { getDirectoryEmployees } = vi.hoisted(() => ({ getDirectoryEmployees: vi.fn() }))
vi.mock('../../../src/features/employees/api/employee-directory.api', () => ({ getDirectoryEmployees }))

import { useEmployeeDirectory } from '../../../src/features/employees/composables/useEmployeeDirectory'

const page = (current = 1): DirectoryEmployeePage => ({
  items: [{ subject: `sub-${current}`, unionId: null, externalId: null, accountSetUnionId: null, name: `员工${current}`, displayName: null, email: null, phone: null, employeeNo: `A00${current}`, jobTitle: null, status: 'enabled', company: null, departments: [] }],
  current,
  size: 50,
  total: 120,
  totalPages: 3,
  hasNext: current < 3
})

describe('useEmployeeDirectory', () => {
  beforeEach(() => getDirectoryEmployees.mockReset())

  it('trims search input and clamps pagination', async () => {
    getDirectoryEmployees.mockImplementation(async (query?: { page: number }) => page(query?.page || 1))
    let directory!: ReturnType<typeof useEmployeeDirectory>
    const wrapper = mount(defineComponent({ setup: () => { directory = useEmployeeDirectory(); return () => h('div') } }))

    await directory.load()
    expect(directory.employees.value[0].name).toBe('员工1')
    directory.keyword.value = '  张三  '
    await directory.search()
    expect(getDirectoryEmployees).toHaveBeenLastCalledWith({ query: '张三', page: 1, size: 50 }, expect.any(AbortSignal))
    await directory.goToPage(99)
    expect(getDirectoryEmployees).toHaveBeenLastCalledWith({ query: '张三', page: 3, size: 50 }, expect.any(AbortSignal))
    wrapper.unmount()
  })
})
