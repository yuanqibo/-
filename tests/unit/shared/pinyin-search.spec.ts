import { describe, expect, it } from 'vitest'
import { matchesPinyinSearch } from '../../../src/shared/search/pinyin-search'

describe('matchesPinyinSearch', () => {
  const values = ['袁其博', '杭州公司', 'AST-001', 'ThinkPad X1']

  it('matches Chinese text by full pinyin and initials', () => {
    expect(matchesPinyinSearch(values, 'yuanqibo')).toBe(true)
    expect(matchesPinyinSearch(values, 'yqb')).toBe(true)
    expect(matchesPinyinSearch(values, 'hangzhou')).toBe(true)
    expect(matchesPinyinSearch(values, 'hzgs')).toBe(true)
  })

  it('preserves Chinese, code, and English matching', () => {
    expect(matchesPinyinSearch(values, '其博')).toBe(true)
    expect(matchesPinyinSearch(values, 'ast001')).toBe(true)
    expect(matchesPinyinSearch(values, 'thinkpad')).toBe(true)
    expect(matchesPinyinSearch(values, 'does-not-exist')).toBe(false)
  })
})
