import { expect, test, type Page } from '@playwright/test'
import { installApiMocks, type ApiMockOptions, type ApiMockState } from '../fixtures/api'

const openApp = async (page: Page, path: string, options?: ApiMockOptions): Promise<ApiMockState> => {
  const state = await installApiMocks(page, options)
  await page.goto(path)
  await expect(page.locator('.standard-portal-shell')).toBeVisible()
  return state
}

const expectNoPageOverflow = async (page: Page): Promise<void> => {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth
  }))
  expect(metrics.scrollWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.viewport + 1)
  expect(metrics.bodyScrollWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.viewport + 1)
}

const expectUnifiedControlFrames = async (dialog: ReturnType<Page['getByRole']>): Promise<void> => {
  const wrappers = dialog.locator('.field .el-input__wrapper, .field .el-select__wrapper')
  await expect(wrappers.first()).toBeVisible()
  const frames = await dialog.evaluate((element) => {
    const visible = (node: Element): boolean => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0
    const controls = Array.from(element.querySelectorAll('.field .el-input__wrapper, .field .el-select__wrapper')).filter(visible)
    const internalInputs = Array.from(element.querySelectorAll('.field .el-input__inner, .field .el-select__input')).filter(visible)
    const heights = controls.map((control) => Math.round(control.getBoundingClientRect().height))
    const arrowsOutside = Array.from(element.querySelectorAll('.el-select__caret')).filter(visible).filter((arrow) => {
      const parent = arrow.closest('.el-select__wrapper')?.getBoundingClientRect()
      const rect = arrow.getBoundingClientRect()
      return !parent || rect.left < parent.left || rect.right > parent.right || rect.top < parent.top || rect.bottom > parent.bottom
    }).length
    const unitsOutside = Array.from(element.querySelectorAll('.asset-unit-control__suffix')).filter(visible).filter((unit) => {
      const parent = unit.closest('.asset-unit-control')?.getBoundingClientRect()
      const rect = unit.getBoundingClientRect()
      return !parent || rect.left < parent.left || rect.right > parent.right || rect.top < parent.top || rect.bottom > parent.bottom
    }).length
    return {
      controls: controls.length,
      framedControls: controls.filter((control) => {
        const style = getComputedStyle(control)
        return style.boxShadow !== 'none' || parseFloat(style.borderTopWidth) > 0
      }).length,
      framedInternalInputs: internalInputs.filter((input) => {
        const style = getComputedStyle(input)
        return style.boxShadow !== 'none' || parseFloat(style.borderTopWidth) > 0
      }).length,
      heightSpread: heights.length ? Math.max(...heights) - Math.min(...heights) : 0,
      arrowsOutside,
      unitsOutside
    }
  })
  expect(frames.framedControls, JSON.stringify(frames)).toBe(frames.controls)
  expect(frames.framedInternalInputs, JSON.stringify(frames)).toBe(0)
  expect(frames.heightSpread, JSON.stringify(frames)).toBeLessThanOrEqual(1)
  expect(frames.arrowsOutside, JSON.stringify(frames)).toBe(0)
  expect(frames.unitsOutside, JSON.stringify(frames)).toBe(0)
}

test.describe('登录后门户质量回归', () => {
  let runtimeErrors: string[]

  test.beforeEach(async ({ page }) => {
    runtimeErrors = []
    page.on('pageerror', (error) => runtimeErrors.push(`[pageerror] ${error.message}`))
    page.on('console', (message) => { if (message.type() === 'error') runtimeErrors.push(`[console] ${message.text()}`) })
  })

  test.afterEach(async ({}, testInfo) => {
    const unexpected = runtimeErrors.filter((message) => !(
      testInfo.title.includes('接口失败') && message.includes('status of 503')
    ))
    expect(unexpected, '浏览器控制台和页面运行时不应出现未处理错误').toEqual([])
  })
  test('主要路由直接加载真实 Vue 页面', async ({ page }) => {
    await installApiMocks(page)
    const routes = [
      ['/', '仪表盘'], ['/assets', '资产列表'], ['/assets/inbound', '资产入库'],
      ['/assets/receive-return', '领用退库'], ['/assets/borrow-return', '借用归还'], ['/assets/stocktake', '资产盘点'],
      ['/assets/settings', '资产设置'], ['/assets/settings/locations', '位置管理'], ['/assets/settings/categories', '资产分类'],
      ['/assets/settings/code-rules', '资产编码规则'], ['/assets/settings/label-templates', '标签模板设置'], ['/requests', '审批'],
      ['/system/employees', '员工信息'], ['/system/departments', '组织架构'], ['/system/self-service', '员工自助'],
      ['/system/member-authorization', '成员授权'], ['/system/integrations', '系统对接'], ['/system/forms', '表单管理']
    ] as const
    for (const [path, text] of routes) {
      await page.goto(path)
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible()
      await expectNoPageOverflow(page)
    }
  })

  test('资产导航保留迁移前的选中样式与展开交互', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '导航视觉和点击状态在桌面项目执行')
    await openApp(page, '/assets/settings/locations')

    await expect(page.getByRole('button', { name: '资产', exact: true }).locator('.nav-asset-icon')).toBeVisible()
    const parent = page.locator('.asset-subnav-parent')
    const activeChild = page.locator('.asset-subnav-child.active')
    await expect(parent).toHaveAttribute('aria-expanded', 'true')
    await expect(parent).toHaveCSS('color', 'rgb(18, 150, 219)')
    await expect(parent).toHaveCSS('background-color', 'rgb(238, 249, 255)')
    await expect(activeChild).toHaveText('位置管理')
    await expect(activeChild).toHaveCSS('color', 'rgb(255, 255, 255)')

    await parent.click()
    await expect(parent).toHaveAttribute('aria-expanded', 'false')
    await expect(activeChild).toBeHidden()
    await parent.click()
    await expect(parent).toHaveAttribute('aria-expanded', 'true')
    await expect(activeChild).toBeVisible()

    await page.getByRole('button', { name: '资产分类', exact: true }).click()
    await expect(page).toHaveURL('/assets/settings/categories')
    await expect(page.locator('.asset-subnav-child.active')).toHaveText('资产分类')
  })

  test('首页保留迁移前的统计与仪表盘板块', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '仪表盘完整板块在桌面项目执行')
    await openApp(page, '/')
    for (const text of ['资产总数', '在用资产', '待处理单据', '资产原值', '资产状态占比', '资产分布情况', '在用资产统计', '资产分类统计']) {
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible()
    }
    await expect(page.getByText('最近资产', { exact: true })).toHaveCount(0)
    await expect(page.getByText('最近审批', { exact: true })).toHaveCount(0)
  })

  test('资产搜索、分页、详情和高级筛选可用', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '密集表格业务流在桌面项目执行，移动项目负责布局回归')
    await openApp(page, '/assets')
    for (const text of ['＋ 新增', '操作', '编辑', '导入/导出', '打印标签', '资产状态', '手机号', '电子邮箱', '领用日期', '购置方式', '使用信息']) {
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible()
    }
    const search = page.getByPlaceholder('搜索', { exact: true })
    await search.fill('测试笔记本')
    await expect(page.getByText('测试笔记本', { exact: true })).toBeVisible()
    await expect(page.getByText('测试显示器 2', { exact: true })).toHaveCount(0)
    await search.clear()
    await page.locator('.asset-list-pagination .page-btn[aria-label="下一页"]').click()
    await expect(page.getByText('AST-0021', { exact: true })).toBeVisible()

    await search.fill('测试笔记本')
    const row = page.locator('.asset-list-table tbody tr').filter({ hasText: '测试笔记本' })
    await row.getByRole('button', { name: 'AST-0001', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: '资产详情' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText('SN-1', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()

    await page.getByRole('button', { name: '高级搜索', exact: true }).click()
    await expect(page.getByRole('heading', { name: '高级筛选', exact: true })).toBeVisible()
  })

  test('新增资产表单提交到既有 API', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '表单业务流在桌面项目执行')
    const state = await openApp(page, '/assets/inbound')
    await page.getByRole('button', { name: /^新增/ }).click()
    await page.getByRole('menuitem', { name: '新增资产', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新增资产' })
    await expect(dialog.getByRole('heading', { name: '使用信息', exact: true })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: '基本信息', exact: true })).toBeVisible()
    await expectUnifiedControlFrames(dialog)
    for (const label of ['人员姓名', '使用公司', '使用部门', '领用/借用日期', '资产编码', '所属/承租公司', '资产状况', '使用期限', '租金']) {
      await expect(dialog.locator('.el-form-item').filter({ hasText: label }).first()).toBeVisible()
    }
    const personField = dialog.locator('.el-form-item').filter({ hasText: '人员姓名' })
    const departmentField = dialog.locator('.el-form-item').filter({ hasText: '使用部门' })
    const personInput = personField.locator('input')
    const personWrapper = personField.locator('.el-input__wrapper')
    const neutralShadow = await personWrapper.evaluate((element) => getComputedStyle(element).boxShadow)
    await expect(departmentField.locator('input')).toHaveValue('')
    await personInput.click()
    await page.waitForTimeout(400)
    await expect(page.locator('.el-autocomplete-suggestion li')).toHaveCount(0)
    expect(state.requests.some((item) => item.path.startsWith('/api/ecp/directory/users'))).toBe(false)
    await expect(personWrapper).toHaveCSS('box-shadow', neutralShadow)
    await personInput.fill('张三')
    await expect(page.getByRole('option', { name: /张三/ })).toBeVisible()
    await page.getByRole('option', { name: /张三/ }).click()
    await expect(personInput).toHaveValue('张三')
    await expect(departmentField.getByText('研发部', { exact: true })).toBeVisible()
    expect(state.requests.some((item) => item.path.startsWith('/api/ecp/directory/users?') && item.path.includes('q=%E5%BC%A0%E4%B8%89'))).toBe(true)
    await dialog.locator('.el-form-item').filter({ hasText: '资产名称' }).locator('input').fill('新测试设备')
    await dialog.locator('.el-form-item').filter({ hasText: '品牌' }).locator('input').fill('测试品牌')
    await dialog.locator('.el-form-item').filter({ hasText: '资产分类' }).locator('.el-select').click()
    await page.getByRole('option', { name: 'IT设备', exact: true }).click()
    await dialog.locator('.el-form-item').filter({ hasText: '资产状况' }).locator('.el-select').click()
    await page.getByRole('option', { name: '正常', exact: true }).click()
    await dialog.locator('.el-form-item').filter({ hasText: '所在位置' }).locator('.el-select').click()
    await page.getByRole('option', { name: '杭州仓库', exact: true }).click()
    await dialog.locator('.el-form-item').filter({ hasText: '购置方式' }).locator('.el-select').click()
    await page.getByRole('option', { name: '采购', exact: true }).click()
    await dialog.getByRole('button', { name: '确定', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(state.requests.some((item) => item.method === 'POST' && item.path === '/api/assets')).toBe(true)
    const createRequest = state.requests.find((item) => item.method === 'POST' && item.path === '/api/assets')
    expect(createRequest?.body).toMatchObject({ item: { name: '新测试设备', category: 'IT设备', type: 'IT设备', brand: '测试品牌', condition: '正常', location: '杭州仓库', purchaseMethod: '采购' } })
  })

  test('资产编辑、批量修改和导入保留迁移前结构', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '密集表单在桌面项目执行')
    await openApp(page, '/assets')
    await page.getByLabel('选择AST-0001').check()
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await page.getByRole('menuitem', { name: '修改', exact: true }).click()
    const editDialog = page.getByRole('dialog', { name: '编辑资产' })
    await expect(editDialog.getByRole('heading', { name: '使用信息', exact: true })).toBeVisible()
    await expect(editDialog.getByRole('heading', { name: '基本信息', exact: true })).toBeVisible()
    await expect(editDialog.locator('.el-form-item').filter({ hasText: '资产编码' }).locator('input')).toHaveValue('AST-0001')
    await expectUnifiedControlFrames(editDialog)
    await editDialog.getByRole('button', { name: '取消', exact: true }).click()

    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await page.getByRole('menuitem', { name: '批量修改', exact: true }).click()
    const batchDialog = page.getByRole('dialog', { name: '批量修改资产' })
    await expect(batchDialog.getByRole('heading', { name: '批量修改', exact: true })).toBeVisible()
    await expect(batchDialog.getByText('AST-0001', { exact: true })).toBeVisible()
    await expectUnifiedControlFrames(batchDialog)
    await batchDialog.getByRole('button', { name: '取消', exact: true }).click()

    await page.getByRole('button', { name: '导入/导出', exact: true }).click()
    await page.getByRole('menuitem', { name: '资产导入', exact: true }).click()
    const importDialog = page.getByRole('dialog', { name: '资产导入' })
    await expect(importDialog.getByText('上传表格', { exact: true })).toBeVisible()
    await expect(importDialog.getByRole('link', { name: /资产导入模板\.xlsx/ })).toBeVisible()
    await expect(importDialog.getByText('最大数据行数不超过5000行；', { exact: true })).toBeVisible()
  })

  test('领用与借用表单保留资产明细和逐项日期', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '密集流程表单在桌面项目执行')
    const state = await openApp(page, '/assets/receive-return')
    await page.getByRole('button', { name: '＋ 新增', exact: true }).click()
    let picker = page.getByRole('dialog', { name: '选择领用资产' })
    await picker.locator('tbody tr').filter({ hasText: 'AST-0002' }).locator('.el-checkbox').click()
    await picker.getByRole('button', { name: '下一步', exact: true }).click()
    const receiveDialog = page.getByRole('dialog', { name: '新增领用单' })
    for (const label of ['领用人', '所属公司', '所在部门', '领用日期', '领用后位置', '经办人', '领用备注']) await expect(receiveDialog.getByText(label, { exact: false }).first()).toBeVisible()
    await expect(receiveDialog.getByText('AST-0002', { exact: true })).toBeVisible()
    await expectUnifiedControlFrames(receiveDialog)
    await receiveDialog.locator('.el-form-item').filter({ hasText: '领用人' }).locator('input').fill('张三')
    await page.locator('.el-autocomplete-suggestion li').filter({ hasText: '张三' }).first().click()
    await receiveDialog.getByRole('button', { name: '保存并提交', exact: true }).click()
    await expect(receiveDialog).toBeHidden()
    const receiveRequest = state.requests.find((item) => item.method === 'POST' && item.path === '/api/assets/commands/receive')
    expect(receiveRequest?.body).toMatchObject({ assetIds: ['AST-0002'], fields: { receiver: '张三', receiverSubject: 'sub-1', company: '示例公司', department: '研发部', location: '杭州仓库' } })

    await page.goto('/assets/borrow-return')
    await page.getByRole('button', { name: '＋ 新增', exact: true }).click()
    picker = page.getByRole('dialog', { name: '选择借用资产' })
    await picker.locator('tbody tr').filter({ hasText: 'AST-0002' }).locator('.el-checkbox').click()
    await picker.getByRole('button', { name: '下一步', exact: true }).click()
    const borrowDialog = page.getByRole('dialog', { name: '新增借用单' })
    await expect(borrowDialog.getByText('资产详情', { exact: true })).toBeVisible()
    await expect(borrowDialog.getByText('AST-0002', { exact: true })).toBeVisible()
    await expectUnifiedControlFrames(borrowDialog)
    await expect(borrowDialog.locator('.asset-flow-table .el-date-editor')).toHaveCount(1)
  })

  test('审批搜索与处理弹窗保持可操作', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '审批业务流在桌面项目执行')
    const state = await openApp(page, '/requests')
    await page.getByPlaceholder('搜索申请编号、类型、申请人或资产').fill('REQ-001')
    const row = page.locator('.panel tbody tr').filter({ hasText: 'REQ-001' })
    await row.getByRole('button', { name: '批准', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '通过审批' })
    await dialog.locator('textarea').fill('信息无误')
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(state.requests.some((item) => item.path.endsWith('/requests/REQ-001/decision') && item.method === 'POST')).toBe(true)
  })

  test('迁移后的各业务域保留旧页面结构与主要操作入口', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '逐业务域视觉结构在桌面项目执行')
    await installApiMocks(page)

    await page.goto('/assets/inbound')
    await expect(page.locator('.asset-inbound-ledger .inbound-order-table')).toBeVisible()
    await expect(page.getByText('RK-001', { exact: true })).toBeVisible()

    await page.goto('/assets/receive-return')
    await expect(page.locator('.receive-return-tabs')).toContainText('员工申领')
    await expect(page.locator('.receive-return-table')).toContainText('领用单号')

    await page.goto('/assets/borrow-return')
    await expect(page.locator('.borrow-return-table')).toContainText('签字图片')
    await page.getByRole('button', { name: '归还', exact: true }).first().click()
    await expect(page.locator('.borrow-return-table')).toContainText('GH-001')

    await page.goto('/assets/stocktake')
    await expect(page.locator('.stocktake-view .hero')).toContainText('支持普通管理员扫码盘点')
    await expect(page.locator('.stocktake-view .panel table')).toContainText('任务编号')

    await page.goto('/assets/settings/locations')
    await expect(page.locator('.location-settings-shell')).toBeVisible()
    await expect(page.locator('.location-settings-table')).toContainText('上级位置')

    await page.goto('/assets/settings/categories')
    await expect(page.locator('.asset-category-settings-shell')).toBeVisible()
    await expect(page.locator('.asset-category-settings-table')).toContainText('计量单位')

    await page.goto('/assets/settings/code-rules')
    await expect(page.locator('.asset-code-rule-workspace')).toContainText('可选字段')
    await expect(page.locator('.asset-code-rule-preview')).toContainText('规则预览')

    await page.goto('/assets/settings/label-templates')
    await expect(page.locator('.asset-label-template-page')).toBeVisible()
    await expect(page.locator('.asset-label-template-left')).toContainText('标准资产标签')

    await page.goto('/requests')
    await expect(page.locator('.approvals-view .hero')).toContainText('审批管理')
    await expect(page.locator('.approvals-view .panel table')).toContainText('当前节点')

    await page.goto('/system/self-service')
    await expect(page.locator('.self-service-panel')).toContainText('签字设置')
    await expect(page.locator('.self-service-config-panel')).toContainText('自助资产领用')

    await page.goto('/system/integrations')
    await expect(page.locator('.account-management-panel, .system-content .panel').first()).toContainText('系统对接')

    await page.goto('/system/forms')
    await expect(page.locator('.system-content .panel')).toContainText('表单管理')
  })

  test('盘点与资产设置表单保留迁移前结构和层级逻辑', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '密集设置表单在桌面项目执行')
    const state = await openApp(page, '/assets/stocktake')

    await page.getByRole('button', { name: '新建盘点', exact: true }).click()
    const stocktakeDialog = page.getByRole('dialog', { name: '新建盘点' })
    await expect(stocktakeDialog.locator('.legacy-business-form')).toHaveCSS('grid-template-columns', /.+ .+/)
    await expectUnifiedControlFrames(stocktakeDialog)
    for (const label of ['任务名称', '盘点范围', '负责人', '应盘数量', '计划日期']) {
      await expect(stocktakeDialog.locator('.el-form-item').filter({ hasText: label })).toHaveCount(1)
    }
    await stocktakeDialog.locator('.el-form-item').filter({ hasText: '任务名称' }).locator('input').fill('迁移回归盘点')
    await stocktakeDialog.getByRole('button', { name: '确定', exact: true }).click()
    await expect(stocktakeDialog).toBeHidden()
    expect(state.requests.find((item) => item.method === 'POST' && item.path === '/api/business-data/stocktakes')?.body).toMatchObject({
      name: '迁移回归盘点', scope: '全部资产', owner: '测试管理员', total: 45
    })

    await page.goto('/assets/settings/locations')
    await page.getByRole('button', { name: '＋ 新增位置', exact: true }).click()
    const locationDialog = page.getByRole('dialog', { name: '新增位置' })
    for (const label of ['位置名称', '上级位置', '位置编码', '资产编码开关']) {
      await expect(locationDialog.locator('.location-form-row').filter({ hasText: label })).toHaveCount(1)
    }
    await locationDialog.locator('.location-form-row').filter({ hasText: '位置名称' }).locator('input').fill('研发办公室')
    await locationDialog.locator('.location-form-row').filter({ hasText: '上级位置' }).locator('select').selectOption('loc-hz')
    await locationDialog.locator('.location-form-row').filter({ hasText: '位置编码' }).locator('input').fill('RD')
    await locationDialog.getByRole('button', { name: '确定', exact: true }).click()
    await expect(locationDialog).toBeHidden()
    const locationRequest = [...state.requests].reverse().find((item) => item.method === 'PUT' && item.path === '/api/config/catalog/locations')
    expect(locationRequest?.body).toMatchObject({ value: [{ id: 'loc-hz', children: [{ name: '研发办公室', code: 'RD' }] }] })

    await page.goto('/assets/settings/categories')
    await page.getByRole('button', { name: '＋ 新增分类', exact: true }).click()
    const categoryDialog = page.getByRole('dialog', { name: '新增分类' })
    for (const label of ['分类编码', '分类名称', '上级分类', '使用期限', '计量单位', '资产编码开关']) {
      await expect(categoryDialog.locator('.location-form-row').filter({ hasText: label })).toHaveCount(1)
    }
    await categoryDialog.locator('.location-form-row').filter({ hasText: '分类编码' }).locator('input').fill('0101')
    await categoryDialog.locator('.location-form-row').filter({ hasText: '分类名称' }).locator('input').fill('笔记本电脑')
    await categoryDialog.locator('.location-form-row').filter({ hasText: '上级分类' }).locator('select').selectOption('cat-it')
    await categoryDialog.locator('.location-form-row').filter({ hasText: '使用期限' }).locator('input').fill('48')
    await categoryDialog.getByRole('button', { name: '确定', exact: true }).click()
    await expect(categoryDialog).toBeHidden()
    const categoryRequest = [...state.requests].reverse().find((item) => item.method === 'PUT' && item.path === '/api/config/catalog/categories')
    expect(categoryRequest?.body).toMatchObject({ value: [{ id: 'cat-it', children: [{ name: '笔记本电脑', code: '0101', usefulLife: '48', unit: '台' }] }] })
  })

  test('员工搜索、组织筛选、分页与详情抽屉可用', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '目录业务流在桌面项目执行')
    const state = await openApp(page, '/system/employees')
    await page.getByLabel('搜索名称或编码').fill('张三')
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await expect(page.getByText('张三', { exact: true })).toBeVisible()
    expect(state.requests.some((item) => item.path.includes('query=%E5%BC%A0%E4%B8%89'))).toBe(true)

    await page.goto('/system/departments')
    await expect(page.getByText('示例公司', { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: '成员范围', exact: true }).click()
    await page.getByRole('option', { name: '仅直属成员', exact: true }).click()
    await page.getByPlaceholder('搜索名称或编码').fill('zs')
    const row = page.locator('.ecp-org-table tbody tr').filter({ hasText: '张三' })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: '详情', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '成员详情' })).toBeVisible()
  })

  test('接口失败与只读权限边界可见', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '错误和权限行为在桌面项目执行')
    await page.addInitScript(() => localStorage.setItem('e2e:permissions', JSON.stringify(['asset:item:view'])))
    await openApp(page, '/assets', { failAssets: true })
    await expect(page.getByText('资产服务暂不可用', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '高级筛选', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '导出', exact: true })).toHaveCount(0)
  })

  test('桌面与移动端关键页面无全局溢出或标题遮挡', async ({ page }) => {
    await installApiMocks(page)
    for (const path of ['/assets', '/system/departments', '/system/self-service']) {
      await page.goto(path)
      await expect(page.locator('.standard-portal-shell')).toBeVisible()
      await expectNoPageOverflow(page)
      const layout = await page.evaluate(() => {
        const header = document.querySelector('.standard-page-header, .ecp-org-policy-bar')?.getBoundingClientRect()
        const content = document.querySelector('.standard-toolbar, .ecp-org-layout, .standard-settings-tabs')?.getBoundingClientRect()
        return header && content ? { headerBottom: header.bottom, contentTop: content.top } : null
      })
      if (layout) expect(layout.contentTop).toBeGreaterThanOrEqual(layout.headerBottom - 1)
    }
  })

  test('移动端新增资产分区不重叠且操作区可达', async ({ page, isMobile }) => {
    test.skip(!isMobile, '仅在移动端项目执行')
    await openApp(page, '/assets/inbound')
    await page.getByRole('button', { name: /^新增/ }).click()
    await page.getByRole('menuitem', { name: '新增资产', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新增资产' })
    await expect(dialog.getByRole('heading', { name: '使用信息', exact: true })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: '基本信息', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '确定', exact: true })).toBeVisible()
    const layout = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const fields = Array.from(element.querySelectorAll('.asset-form-grid .field')).map((field) => field.getBoundingClientRect())
      return {
        left: rect.left,
        right: rect.right,
        viewport: document.documentElement.clientWidth,
        fieldsInside: fields.every((field) => field.left >= rect.left - 1 && field.right <= rect.right + 1),
        overlaps: fields.some((field, index) => fields.slice(index + 1).some((other) => field.top < other.bottom && field.bottom > other.top && field.left < other.right && field.right > other.left))
      }
    })
    expect(layout.left).toBeGreaterThanOrEqual(0)
    expect(layout.right).toBeLessThanOrEqual(layout.viewport + 1)
    expect(layout.fieldsInside).toBe(true)
    expect(layout.overlaps).toBe(false)
    await expectNoPageOverflow(page)
  })

  test('移动端盘点和资产设置弹窗保持原表单且不溢出', async ({ page, isMobile }) => {
    test.skip(!isMobile, '仅在移动端项目执行')
    await openApp(page, '/assets/stocktake')
    await page.getByRole('button', { name: '新建盘点', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: '新建盘点' })
    await expect(dialog.locator('.legacy-business-form .field')).toHaveCount(5)
    await expect(dialog.getByRole('button', { name: '确定', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()

    await page.goto('/assets/settings/locations')
    await page.getByRole('button', { name: '＋ 新增位置', exact: true }).click()
    dialog = page.getByRole('dialog', { name: '新增位置' })
    await expect(dialog.locator('.location-form-row')).toHaveCount(4)
    const layout = await dialog.evaluate((element) => {
      const dialogRect = element.getBoundingClientRect()
      const controls = Array.from(element.querySelectorAll('input, select, button')).map((control) => control.getBoundingClientRect())
      return {
        viewport: document.documentElement.clientWidth,
        left: dialogRect.left,
        right: dialogRect.right,
        controlsInside: controls.every((control) => control.left >= dialogRect.left - 1 && control.right <= dialogRect.right + 1)
      }
    })
    expect(layout.left).toBeGreaterThanOrEqual(0)
    expect(layout.right).toBeLessThanOrEqual(layout.viewport + 1)
    expect(layout.controlsInside).toBe(true)
    await expectNoPageOverflow(page)
  })
})
