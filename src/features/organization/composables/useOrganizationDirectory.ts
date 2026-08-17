import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { match as pinyinMatch, pinyin } from 'pinyin-pro'
import { getAccountSetInitializationData, getOrganizationConsole } from '../api/organization-directory.api'
import type {
  OrganizationAccountSet,
  OrganizationAccountStatus,
  OrganizationConsole,
  OrganizationMember,
  OrganizationMemberScope,
  OrganizationNode
} from '../types/organization-directory'

const normalizeQuery = (value = ''): string => String(value || '')
  .trim()
  .normalize('NFKC')
  .toLowerCase()
  .replace(/\s+/g, ' ')

const compactSearchText = (value = ''): string =>
  normalizeQuery(value).replace(/[\s·•.\-_()/\\]+/g, '')

const hasCjkText = (value = ''): boolean => /[\u3400-\u9fff]/.test(String(value || ''))
const isAsciiSearch = (value = ''): boolean => /^[a-z0-9]+$/i.test(compactSearchText(value))

const pinyinParts = (value = '') => {
  const text = String(value || '').trim()
  if (!text) return { tokens: [] as string[], compact: '', initials: '' }
  const tokens = pinyin(text, { toneType: 'none', type: 'array' })
    .map((token) => String(token || '').toLowerCase())
    .filter(Boolean)
  return {
    tokens,
    compact: tokens.join(''),
    initials: pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' })
      .map((token) => String(token || '').toLowerCase())
      .join('')
  }
}

const scoreTextField = (value: unknown, query: string, base = 0): number => {
  const text = normalizeQuery(String(value || ''))
  const keyword = normalizeQuery(query)
  if (!text || !keyword) return Number.NEGATIVE_INFINITY
  const compactText = compactSearchText(text)
  const compactKeyword = compactSearchText(keyword)
  if (text === keyword || compactText === compactKeyword) return base + 1000
  if (text.startsWith(keyword) || compactText.startsWith(compactKeyword)) return base + 850
  if (text.includes(keyword) || compactText.includes(compactKeyword)) return base + 650
  return Number.NEGATIVE_INFINITY
}

const scorePinyinField = (value: unknown, query: string, base = 0): number => {
  const text = String(value || '')
  const keyword = compactSearchText(query)
  if (!text || !keyword || !isAsciiSearch(keyword) || !hasCjkText(text)) return Number.NEGATIVE_INFINITY
  const parts = pinyinParts(text)
  if (parts.compact === keyword) return base + 960
  if (parts.initials === keyword) return base + 930
  if (parts.tokens.some((token) => token === keyword)) return base + 900
  if (parts.compact.startsWith(keyword)) return base + 820
  if (parts.initials.startsWith(keyword)) return base + 800
  if (parts.tokens.some((token) => token.startsWith(keyword))) return base + 760
  if (pinyinMatch(text, keyword)) return base + 720
  if (parts.compact.includes(keyword)) return base + 520
  if (parts.initials.includes(keyword)) return base + 480
  return Number.NEGATIVE_INFINITY
}

const scoreMember = (member: OrganizationMember, rawQuery: string): number => {
  const query = normalizeQuery(rawQuery)
  if (!query) return 0
  const compactQuery = compactSearchText(query)
  const ascii = isAsciiSearch(query)
  const allowAuxiliaryPinyin = !ascii || compactQuery.length >= 3
  return Math.max(
    scoreTextField(member.name, query, 4000),
    scorePinyinField(member.name, compactQuery, 3900),
    scoreTextField(member.employeeNo, query, 3600),
    scoreTextField(member.email, query, 3400),
    scoreTextField(member.phone, query, 3200),
    scoreTextField(member.jobTitle, query, 2400),
    allowAuxiliaryPinyin ? scorePinyinField(member.jobTitle, compactQuery, 2300) : Number.NEGATIVE_INFINITY,
    scoreTextField(member.department, query, 2200),
    allowAuxiliaryPinyin ? scorePinyinField(member.department, compactQuery, 2100) : Number.NEGATIVE_INFINITY,
    scoreTextField(member.company, query, 1800),
    allowAuxiliaryPinyin ? scorePinyinField(member.company, compactQuery, 1700) : Number.NEGATIVE_INFINITY,
    ascii && compactQuery.length >= 6 ? scoreTextField(member.subject, query, 800) : Number.NEGATIVE_INFINITY
  )
}

const searchMembers = (members: OrganizationMember[], rawQuery: string): OrganizationMember[] => {
  const query = normalizeQuery(rawQuery)
  if (!query) {
    return [...members].sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN'))
  }
  return members
    .map((member) => ({ member, score: scoreMember(member, query) }))
    .filter((item) => item.score > Number.NEGATIVE_INFINITY)
    .sort((left, right) => right.score - left.score
      || String(left.member.name || '').localeCompare(String(right.member.name || ''), 'zh-CN')
      || String(left.member.employeeNo || '').localeCompare(String(right.member.employeeNo || ''), 'zh-CN'))
    .map((item) => item.member)
}

const filterRootsByAccountSet = (roots: OrganizationNode[], accountSetUnionId: string): OrganizationNode[] => {
  if (!accountSetUnionId) return roots
  const filterNode = (node: OrganizationNode): OrganizationNode | null => {
    const children = (node.children || []).map(filterNode).filter((child): child is OrganizationNode => Boolean(child))
    return node.accountSetUnionId === accountSetUnionId || children.length ? { ...node, children } : null
  }
  const filtered = roots.map(filterNode).filter((node): node is OrganizationNode => Boolean(node))
  return filtered.length ? filtered : roots
}

const flattenNodes = (nodes: OrganizationNode[], map = new Map<string, OrganizationNode>()): Map<string, OrganizationNode> => {
  nodes.forEach((node) => {
    map.set(node.key, node)
    flattenNodes(node.children || [], map)
  })
  return map
}

const normalizedStatus = (status: string | null): string => {
  const value = String(status || '').trim()
  if (!value) return '在用'
  if (/^(enabled|active|normal|ok)$/i.test(value)) return 'enabled'
  if (/^(disabled|inactive|locked|deleted)$/i.test(value)) return 'disabled'
  return value.toLowerCase()
}

const statusMatches = (member: OrganizationMember, filter: OrganizationAccountStatus): boolean => {
  if (filter === 'all') return true
  const status = normalizedStatus(member.status)
  if (filter === 'enabled') return ['enabled', 'active', '在用'].includes(status)
  return ['disabled', 'inactive', '停用', '禁用'].includes(status)
}

export const accountSetLabel = (accountSet: OrganizationAccountSet | null): string => {
  const source = String(accountSet?.sourceType || '').toUpperCase()
  if (source === 'FEISHU' || source === 'LARK') return '飞书'
  if (source === 'DINGTALK') return '钉钉'
  if (source === 'WECHAT_WORK') return '企微'
  return accountSet?.name || source || '账号集'
}

export function useOrganizationDirectory() {
  const organization = ref<OrganizationConsole | null>(null)
  const selectedAccountSetUnionId = ref('')
  const selectedNodeKey = ref('')
  const expandedKeys = reactive<Record<string, boolean>>({})
  const keyword = ref('')
  const appliedKeyword = ref('')
  const memberScope = ref<OrganizationMemberScope>('all')
  const accountStatus = ref<OrganizationAccountStatus>('all')
  const currentPage = ref(1)
  const pageSize = ref(20)
  const loading = ref(false)
  const initializing = ref(false)
  const errorMessage = ref('')
  const detailMember = ref<OrganizationMember | null>(null)
  const detailOpen = ref(false)
  let requestController: AbortController | null = null
  let requestId = 0
  let searchTimer = 0
  let disposed = false

  const accountSets = computed(() => organization.value?.accountSets || [])
  const selectedAccountSet = computed(() => accountSets.value.find((item) => item.unionId === selectedAccountSetUnionId.value)
    || accountSets.value[0]
    || null)
  const roots = computed(() => filterRootsByAccountSet(
    organization.value?.roots || [],
    String(selectedAccountSet.value?.unionId || '')
  ))
  const nodeMap = computed(() => flattenNodes(roots.value))
  const selectedNode = computed(() => nodeMap.value.get(selectedNodeKey.value) || roots.value[0] || null)
  const membersBySubject = computed(() => {
    const accountSetMap = new Map(accountSets.value.map((item) => [String(item.unionId || ''), item]))
    return new Map((organization.value?.users || []).map((user) => {
      const accountSet = accountSetMap.get(String(user.accountSetUnionId || ''))
      const member: OrganizationMember = {
        ...user,
        departments: Array.isArray(user.departments) ? user.departments : [],
        leaderDepartmentNames: Array.isArray(user.leaderDepartmentNames) ? user.leaderDepartmentNames : [],
        company: String(user.companyName || '').trim(),
        department: String(user.departments?.[0]?.name || '').trim(),
        accountSetName: String(accountSet?.name || '').trim(),
        accountSetSourceType: String(accountSet?.sourceType || '').trim(),
        accountSetSyncMode: String(accountSet?.syncMode || '').trim()
      }
      return [member.subject, member] as const
    }))
  })
  const filteredMembers = computed(() => {
    if (!selectedNode.value) return []
    const subjects = memberScope.value === 'direct'
      ? selectedNode.value.directSubjects || []
      : selectedNode.value.memberSubjects || []
    const members = subjects
      .map((subject) => membersBySubject.value.get(subject))
      .filter((member): member is OrganizationMember => Boolean(member))
      .filter((member) => statusMatches(member, accountStatus.value))
    return searchMembers(members, appliedKeyword.value)
  })
  const total = computed(() => filteredMembers.value.length)
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
  const visibleMembers = computed(() => {
    const start = (currentPage.value - 1) * pageSize.value
    return filteredMembers.value.slice(start, start + pageSize.value)
  })
  const selectedTotal = computed(() => selectedNode.value?.memberSubjects?.length || 0)

  const load = async (): Promise<void> => {
    const activeRequest = ++requestId
    requestController?.abort()
    requestController = new AbortController()
    loading.value = true
    errorMessage.value = ''
    try {
      const result = await getOrganizationConsole(requestController.signal)
      if (disposed || activeRequest !== requestId) return
      organization.value = result
      if (!selectedAccountSetUnionId.value || !result.accountSets.some((item) => item.unionId === selectedAccountSetUnionId.value)) {
        selectedAccountSetUnionId.value = String(result.accountSets[0]?.unionId || '')
      }
      result.roots.forEach((root) => {
        if (root.key && expandedKeys[root.key] === undefined) expandedKeys[root.key] = true
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (!disposed && activeRequest === requestId) {
        errorMessage.value = error instanceof Error ? error.message : 'ECP 组织架构加载失败'
        organization.value = null
      }
    } finally {
      if (!disposed && activeRequest === requestId) loading.value = false
    }
  }

  const initializeAccountSets = async (): Promise<unknown> => {
    initializing.value = true
    try {
      const result = await getAccountSetInitializationData()
      await load()
      return result
    } finally {
      initializing.value = false
    }
  }

  const selectAccountSet = (unionId: string): void => {
    selectedAccountSetUnionId.value = unionId
    selectedNodeKey.value = ''
    currentPage.value = 1
  }

  const selectNode = (key: string): void => {
    selectedNodeKey.value = key
    currentPage.value = 1
  }

  const toggleNode = (key: string, defaultExpanded: boolean): void => {
    expandedKeys[key] = !(expandedKeys[key] ?? defaultExpanded)
  }

  const openMemberDetail = (member: OrganizationMember): void => {
    detailMember.value = member
    detailOpen.value = true
  }

  watch(roots, (value) => {
    const map = flattenNodes(value)
    if (!selectedNodeKey.value || !map.has(selectedNodeKey.value)) selectedNodeKey.value = value[0]?.key || ''
  }, { immediate: true })

  watch(keyword, (value) => {
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => {
      appliedKeyword.value = value.trim()
      currentPage.value = 1
    }, 180)
  })

  watch([memberScope, accountStatus, pageSize], () => {
    currentPage.value = 1
  })

  watch(totalPages, (value) => {
    currentPage.value = Math.min(Math.max(1, currentPage.value), value)
  })

  onBeforeUnmount(() => {
    disposed = true
    requestId += 1
    requestController?.abort()
    requestController = null
    window.clearTimeout(searchTimer)
  })

  return {
    organization,
    accountSets,
    selectedAccountSet,
    selectedAccountSetUnionId,
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
  }
}
