import { pinyin } from 'pinyin-pro'

type SearchIndex = { raw: string; compact: string; pinyin: string; initials: string }

const searchIndexCache = new Map<string, SearchIndex>()
const MAX_CACHE_SIZE = 20_000

const normalize = (value: unknown): string => String(value || '')
  .trim()
  .normalize('NFKC')
  .toLowerCase()

const compact = (value: unknown): string => normalize(value).replace(/[\s·•.\-_()/\\]+/g, '')
const hasCjk = (value: string): boolean => /[\u3400-\u9fff]/.test(value)
const isPinyinQuery = (value: string): boolean => /^[a-z0-9]+$/.test(value)

const index = (value: unknown): SearchIndex => {
  const raw = normalize(value)
  const cached = searchIndexCache.get(raw)
  if (cached) return cached

  const tokens = hasCjk(raw)
    ? pinyin(raw, { toneType: 'none', type: 'array' }).map((token) => String(token || '').toLowerCase())
    : []
  const result = {
    raw,
    compact: compact(raw),
    pinyin: tokens.join(''),
    initials: hasCjk(raw)
      ? pinyin(raw, { pattern: 'first', toneType: 'none', type: 'array' }).map((token) => String(token || '').toLowerCase()).join('')
      : ''
  }
  if (searchIndexCache.size >= MAX_CACHE_SIZE) searchIndexCache.clear()
  searchIndexCache.set(raw, result)
  return result
}

export const matchesPinyinSearch = (values: readonly unknown[], query: unknown): boolean => {
  const keyword = compact(query)
  if (!keyword) return true

  return values.some((value) => {
    const valueIndex = index(value)
    if (!valueIndex.raw) return false
    if (valueIndex.raw.includes(normalize(query)) || valueIndex.compact.includes(keyword)) return true
    if (!isPinyinQuery(keyword) || !valueIndex.pinyin) return false
    return valueIndex.pinyin.includes(keyword)
      || valueIndex.initials.includes(keyword)
  })
}
