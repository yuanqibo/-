import { computed, onBeforeUnmount, ref } from 'vue'
import { getDirectoryEmployees } from '../api/employee-directory.api'
import type { DirectoryEmployee, DirectoryEmployeePage } from '../types/employee-directory'

const EMPTY_PAGE: DirectoryEmployeePage = {
  items: [],
  current: 1,
  size: 50,
  total: 0,
  totalPages: 0,
  hasNext: false
}

export function useEmployeeDirectory() {
  const keyword = ref('')
  const appliedKeyword = ref('')
  const page = ref<DirectoryEmployeePage>({ ...EMPTY_PAGE })
  const loading = ref(false)
  const errorMessage = ref('')
  let requestId = 0
  let requestController: AbortController | null = null
  let disposed = false

  const employees = computed<DirectoryEmployee[]>(() => page.value.items || [])
  const currentPage = computed(() => Math.max(1, Number(page.value.current) || 1))
  const totalPages = computed(() => Math.max(0, Number(page.value.totalPages) || 0))

  const load = async (targetPage = 1): Promise<void> => {
    const activeRequest = ++requestId
    requestController?.abort()
    requestController = new AbortController()
    loading.value = true
    errorMessage.value = ''
    try {
      const result = await getDirectoryEmployees(
        {
          query: appliedKeyword.value,
          page: targetPage,
          size: page.value.size || EMPTY_PAGE.size
        },
        requestController.signal
      )
      if (!disposed && activeRequest === requestId) page.value = result
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (!disposed && activeRequest === requestId) {
        errorMessage.value = error instanceof Error ? error.message : '员工目录加载失败'
      }
    } finally {
      if (!disposed && activeRequest === requestId) loading.value = false
    }
  }

  const search = (): Promise<void> => {
    appliedKeyword.value = keyword.value.trim()
    return load(1)
  }

  const reset = (): Promise<void> => {
    keyword.value = ''
    appliedKeyword.value = ''
    return load(1)
  }

  const goToPage = (targetPage: number): Promise<void> => {
    const lastPage = Math.max(1, totalPages.value)
    return load(Math.min(Math.max(1, targetPage), lastPage))
  }

  onBeforeUnmount(() => {
    disposed = true
    requestId += 1
    requestController?.abort()
    requestController = null
  })

  return {
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
  }
}
