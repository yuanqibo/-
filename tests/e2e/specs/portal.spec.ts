import { expect, test, type Locator, type Page } from '@playwright/test'
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

const expectNeutralAutocompleteFocus = async (field: ReturnType<Page['locator']>): Promise<void> => {
  const input = field.locator('input')
  await input.click()
  const focusStyle = await field.evaluate((element) => {
    const inner = element.querySelector('input')
    const wrapper = element.querySelector('.el-input__wrapper')
    return {
      innerShadow: inner ? getComputedStyle(inner).boxShadow : '',
      innerBorder: inner ? getComputedStyle(inner).borderTopWidth : '',
      wrapperShadow: wrapper ? getComputedStyle(wrapper).boxShadow : ''
    }
  })
  expect(focusStyle.innerShadow, JSON.stringify(focusStyle)).toBe('none')
  expect(focusStyle.innerBorder, JSON.stringify(focusStyle)).toBe('0px')
  expect(focusStyle.wrapperShadow, JSON.stringify(focusStyle)).not.toContain('64, 158, 255')
  expect(focusStyle.wrapperShadow, JSON.stringify(focusStyle)).not.toContain('3px')
}

const choosePortalSelectOption = async (page: Page, select: Locator, option: string): Promise<void> => {
  await select.click()
  await page.getByRole('option', { name: option, exact: true }).last().click()
}

const expectPortalSelectOpensBelow = async (page: Page, select: Locator): Promise<void> => {
  const combobox = select.getByRole('combobox')
  const listboxId = await combobox.getAttribute('aria-controls')
  expect(listboxId).toBeTruthy()
  await select.click()
  await expect(combobox).toHaveAttribute('aria-expanded', 'true')
  const triggerBox = await select.locator('.el-select__wrapper').boundingBox()
  expect(triggerBox).not.toBeNull()
  const listbox = page.locator(`[id="${listboxId}"]`)
  await expect(listbox).toBeVisible()
  const listboxBox = await listbox.boundingBox()
  expect(listboxBox).not.toBeNull()
  expect(listboxBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height)
  expect(listboxBox!.y + listboxBox!.height).toBeLessThanOrEqual((page.viewportSize()?.height || 0) + 1)
  await select.click()
  await expect(combobox).toHaveAttribute('aria-expanded', 'false')
  await expect(listbox).toBeHidden()
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
      ['/assets/receive-return', '领用退库'], ['/assets/borrow-return', '借用归还'], ['/assets/handover', '资产交接'], ['/assets/stocktake', '资产盘点'], ['/assets/disposals', '资产处置'],
      ['/assets/settings', '资产设置'], ['/assets/settings/locations', '位置管理'], ['/assets/settings/categories', '资产分类'],
      ['/assets/settings/code-rules', '资产编码规则'], ['/assets/settings/label-templates', '标签模板设置'], ['/requests', '审批'],
      ['/system/employees', '员工信息'], ['/system/departments', '组织架构'], ['/system/self-service', '员工自助'],
      ['/workspace', '成员授权'], ['/system/integrations', '系统对接'], ['/system/forms', '表单管理']
    ] as const
    for (const [path, text] of routes) {
      await page.goto(path)
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible()
      await expectNoPageOverflow(page)
    }
  })

  test('资产交接作为独立模块直接打开交接台账', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '资产交接台账在桌面项目执行')
    await openApp(page, '/assets/handover')
    await expect(page.getByText('资产交接', { exact: true }).first()).toBeVisible()
    await expect(page.locator('.receive-return-tabs')).toHaveCount(0)
    await expect(page.locator('.receive-return-table')).toContainText('交接单号')
    await expect(page.getByRole('button', { name: '＋ 新增', exact: true })).toBeVisible()
  })

  test('资产交接自定义列覆盖单据字段和资产明细并持久化', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '资产交接密集表格在桌面项目执行')
    await openApp(page, '/assets/handover')
    await page.evaluate(() => localStorage.removeItem('assetHandoverColumnSettingsV1'))
    await page.reload()

    const defaultHeaders = [
      ['status', '交接状态'], ['order', '交接单号'], ['operator', '经办人'], ['receiver', '接收人'],
      ['receiverCompany', '接收公司'], ['receiverDepartment', '接收部门'], ['date', '交接日期'], ['handoverType', '交接类型'],
      ['targetLocation', '交接后位置'], ['note', '交接备注'], ['signer', '签字人'], ['signatureImage', '签字图片'],
      ['assetImage', '资产图片'], ['assetId', '资产编码'], ['assetCategory', '资产分类'], ['assetName', '资产名称'],
      ['assetBrand', '品牌'], ['assetModel', '型号'], ['assetSn', '设备序列号'], ['assetOwnerCompany', '所属/承租公司'],
      ['assetLocation', '所在位置'], ['actions', '操作']
    ] as const
    for (const [key, label] of defaultHeaders) {
      await expect(page.locator(`.handover-custom-table th[data-column-key="${key}"]`)).toContainText(label)
    }
    for (const key of ['handoverPerson', 'handoverCompany', 'handoverDepartment']) {
      await expect(page.locator(`.handover-custom-table th[data-column-key="${key}"]`)).toHaveCount(0)
    }

    await page.getByRole('button', { name: '列表设置', exact: true }).click()
    const drawer = page.locator('.asset-advanced-search-drawer:visible').last()
    const documentSection = drawer.locator('[data-column-group="document"]')
    const assetSection = drawer.locator('[data-column-group="asset"]')
    await expect(documentSection).toContainText('(13/13)')
    await expect(assetSection).toContainText('(9/12)')

    for (const label of ['交接状态', '交接单号', '经办人', '操作']) {
      const checkbox = documentSection.getByRole('checkbox', { name: label, exact: true })
      await expect(checkbox).toBeChecked()
      await expect(checkbox).toBeDisabled()
    }
    for (const label of ['交接人', '交接人公司', '交接人部门']) {
      await expect(assetSection.getByRole('checkbox', { name: label, exact: true })).not.toBeChecked()
    }

    await documentSection.getByRole('checkbox', { name: '交接备注', exact: true }).uncheck()
    await assetSection.getByRole('checkbox', { name: '交接人', exact: true }).check()
    await expect(page.locator('.handover-custom-table th[data-column-key="note"]')).toHaveCount(0)
    await expect(page.locator('.handover-custom-table th[data-column-key="handoverPerson"]')).toContainText('交接人')
    await expect(page.locator('.handover-custom-table tbody')).toContainText('张三')

    await page.reload()
    await expect(page.locator('.handover-custom-table th[data-column-key="note"]')).toHaveCount(0)
    await expect(page.locator('.handover-custom-table th[data-column-key="handoverPerson"]')).toContainText('交接人')

    await page.getByRole('button', { name: '列表设置', exact: true }).click()
    const reloadedDrawer = page.locator('.asset-advanced-search-drawer:visible').last()
    await reloadedDrawer.locator('[data-column-group="document"]').getByRole('button', { name: '重置', exact: true }).click()
    await reloadedDrawer.locator('[data-column-group="asset"]').getByRole('button', { name: '重置', exact: true }).click()
    await expect(page.locator('.handover-custom-table th[data-column-key="note"]')).toContainText('交接备注')
    await expect(page.locator('.handover-custom-table th[data-column-key="handoverPerson"]')).toHaveCount(0)
  })

  test('资产处置支持退租、部分取消与完成流转', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '处置明细密集表格在桌面项目执行')
    const disposableAssets = [
      { id: 'DISP-LX-1', name: '凌雄租赁笔记本', status: '空闲', category: 'IT设备', type: '设备', owner: '未分配', ownerSubject: '', department: '', company: '示例公司', location: '杭州仓库', custodian: '管理员', model: 'LX-14', brand: 'Lenovo', sn: 'LX-SN-1', assetTag: '', supplier: '凌雄租赁', price: 6800, purchaseDate: '2026-07-01', warrantyDate: '', note: '' },
      { id: 'DISP-OWN-2', name: '自有显示器', status: '空闲', category: '显示器', type: '设备', owner: '未分配', ownerSubject: '', department: '', company: '示例公司', location: '杭州仓库', custodian: '管理员', model: 'U2724', brand: 'Dell', sn: 'OWN-SN-2', assetTag: '', supplier: '普通供应商', price: 3200, purchaseDate: '2026-07-01', warrantyDate: '', note: '' }
    ]
    const state = await openApp(page, '/assets/disposals', { assets: disposableAssets })
    await page.getByRole('button', { name: '＋ 新增', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新增处置单' })
    await expect(dialog.getByText('请选择', { exact: true })).toBeVisible()
    await expect(dialog.getByLabel('处置金额')).toHaveValue('')
    await expect(dialog.getByLabel('处置费用')).toHaveValue('')
    await dialog.getByText('请选择', { exact: true }).click()
    await expect(page.getByRole('option', { name: '变卖', exact: true })).toBeVisible()
    await page.getByRole('option', { name: '退租', exact: true }).click()
    await dialog.getByLabel('处置说明').fill('租期结束，设备退还供应商')
    await dialog.getByLabel('导入资产编码文件').setInputFiles({
      name: '处置资产.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('资产编码\nDISP-LX-1')
    })
    await expect(dialog.getByText('DISP-LX-1', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '选择资产', exact: true }).click()
    const assetPicker = page.getByRole('dialog', { name: '选择处置资产' })
    await expect(assetPicker.getByLabel('选择资产DISP-LX-1')).toBeChecked()
    await assetPicker.getByLabel('选择资产DISP-OWN-2').check()
    await assetPicker.getByRole('button', { name: '确认选择', exact: true }).click()
    await dialog.getByRole('button', { name: '保存并提交', exact: true }).click()

    const drawer = page.getByRole('dialog', { name: '处置单详情' })
    await expect(drawer).toContainText('CZ202607310001')
    await expect(drawer).not.toContainText('集成任务')
    await drawer.getByLabel('选择取消DISP-LX-1').check()
    await drawer.getByRole('button', { name: '取消所选（1）', exact: true }).click()
    await page.getByRole('button', { name: '确认', exact: true }).click()
    await expect(drawer.getByText('部分取消', { exact: true })).toBeVisible()
    await expect(drawer.getByText('已取消', { exact: true })).toBeVisible()

    await drawer.getByRole('button', { name: '完成处置', exact: true }).click()
    await page.getByRole('button', { name: '确认', exact: true }).click()
    await expect(drawer.getByText('已处置', { exact: true })).toBeVisible()
    expect(state.requests.some((request) => request.method === 'POST' && request.path === '/api/asset-disposals')).toBe(true)
    expect(state.requests.some((request) => request.method === 'POST' && request.path.endsWith('/cancel'))).toBe(true)
    expect(state.requests.some((request) => request.method === 'PATCH' && request.path.endsWith('/complete'))).toBe(true)
    await expectNoPageOverflow(page)
  })

  test('资产列表可在当前页直接发起处置', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '资产列表批量操作在桌面项目执行')
    const disposableAsset = {
      id: 'DISP-DIRECT-1', name: '待退租笔记本', status: '空闲', category: 'IT设备', type: '设备',
      owner: '未分配', ownerSubject: '', department: '', company: '示例公司', location: '杭州仓库', custodian: '管理员',
      model: 'T14', brand: 'Lenovo', sn: 'DIRECT-SN-1', assetTag: '', supplier: '凌雄租赁', price: 6800,
      purchaseDate: '2026-07-01', warrantyDate: '', note: ''
    }
    const state = await openApp(page, '/assets', { assets: [disposableAsset] })
    await page.getByLabel('选择DISP-DIRECT-1').check()
    await page.getByRole('button', { name: '操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '处置', exact: true }).click()

    await expect(page).toHaveURL('/assets')
    const dialog = page.getByRole('dialog', { name: '新增处置单' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('DISP-DIRECT-1', { exact: true })).toBeVisible()
    await dialog.getByText('请选择', { exact: true }).click()
    await page.getByRole('option', { name: '退租', exact: true }).click()
    await dialog.getByLabel('处置说明').fill('从资产列表直接发起处置')
    await dialog.getByRole('button', { name: '保存并提交', exact: true }).click()

    await expect(page).toHaveURL('/assets')
    await expect(dialog).toBeHidden()
    expect(state.requests.some((request) => request.method === 'POST'
      && request.path === '/api/asset-disposals'
      && (request.body as { assetIds?: string[] })?.assetIds?.includes('DISP-DIRECT-1'))).toBe(true)
  })

  test('处置空列表保持单一纯白区域且无悬停底色', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '处置明细密集表格在桌面项目执行')
    await openApp(page, '/assets/disposals')
    const empty = page.locator('.disposal-table-empty')
    await expect(empty).toBeVisible()
    await expect(page.locator('.disposal-table tbody tr')).toHaveCount(0)
    await empty.hover()
    const appearance = await empty.evaluate((element) => {
      const content = element.closest('.disposal-table-content')
      const scroll = element.closest('.disposal-table-scroll')
      const rect = element.getBoundingClientRect()
      const scrollRect = scroll?.getBoundingClientRect()
      return {
        background: getComputedStyle(element).backgroundColor,
        contentBackground: content ? getComputedStyle(content).backgroundColor : '',
        fillsRemainingHeight: scrollRect ? Math.abs(rect.bottom - scrollRect.bottom) <= 1 : false
      }
    })
    expect(appearance.background).toBe('rgb(255, 255, 255)')
    expect(appearance.contentBackground).toBe('rgb(255, 255, 255)')
    expect(appearance.fillsRemainingHeight).toBe(true)
  })

  test('系统主导航直接进入首个系统页面且不经过全屏中转状态', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '主导航切换在桌面项目执行')
    await openApp(page, '/assets')
    await page.evaluate(() => {
      const routeTransitions: string[] = []
      const pushState = history.pushState.bind(history)
      const replaceState = history.replaceState.bind(history)
      const record = (): void => { routeTransitions.push(window.location.pathname) }
      history.pushState = (...args) => { pushState(...args); record() }
      history.replaceState = (...args) => { replaceState(...args); record() }
      const fullScreenStates: string[] = []
      const observer = new MutationObserver(() => {
        if (document.querySelector('.standard-route-state')) fullScreenStates.push(window.location.pathname)
      })
      observer.observe(document.body, { childList: true, subtree: true })
      ;(window as typeof window & {
        __systemNavigationProbe?: { routeTransitions: string[]; fullScreenStates: string[]; observer: MutationObserver }
      }).__systemNavigationProbe = { routeTransitions, fullScreenStates, observer }
    })

    await page.getByRole('button', { name: '系统', exact: true }).click()
    await expect(page).toHaveURL('/system/employees')
    await expect(page.getByText('员工信息', { exact: true }).first()).toBeVisible()
    const probe = await page.evaluate(() => {
      const value = (window as typeof window & {
        __systemNavigationProbe?: { routeTransitions: string[]; fullScreenStates: string[]; observer: MutationObserver }
      }).__systemNavigationProbe
      value?.observer.disconnect()
      return { routeTransitions: value?.routeTransitions || [], fullScreenStates: value?.fullScreenStates || [] }
    })
    expect(probe.routeTransitions).not.toContain('/system')
    expect(probe.routeTransitions.at(-1)).toBe('/system/employees')
    expect(probe.fullScreenStates).toEqual([])
  })

  test('员工信息使用无框列表和紧凑分页', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '员工目录密集表格在桌面项目执行')
    await openApp(page, '/system/employees')
    const geometry = await page.locator('.employee-directory-feature').evaluate((element) => {
      const panel = getComputedStyle(element)
      const table = element.querySelector('.el-table')
      const firstCell = element.querySelector('.el-table__cell')
      const pagination = element.querySelector('.el-pagination')
      const paginationButton = element.querySelector('.el-pagination .number')
      return {
        panelBorder: panel.borderTopWidth,
        panelRadius: panel.borderTopLeftRadius,
        borderedTable: table?.classList.contains('el-table--border') || false,
        cellRightBorder: firstCell ? getComputedStyle(firstCell).borderRightWidth : '',
        paginationFontSize: pagination ? getComputedStyle(pagination).fontSize : '',
        paginationButtonHeight: paginationButton?.getBoundingClientRect().height || 0,
        paginationButtonWidth: paginationButton?.getBoundingClientRect().width || 0
      }
    })
    await expect(page.locator('.employee-directory-pagination-total')).toHaveText('共 60 条')
    await expect(page.locator('.employee-directory-pagination')).not.toContainText('Total')
    expect(geometry).toMatchObject({
      panelBorder: '0px',
      panelRadius: '0px',
      borderedTable: false,
      cellRightBorder: '0px',
      paginationFontSize: '13px'
    })
    expect(geometry.paginationButtonHeight).toBe(28)
    expect(geometry.paginationButtonWidth).toBe(28)
  })

  test('成员授权由 ECP 工作台直接接管且键盘检索保持原生行为', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '成员授权工作区布局在桌面项目执行')
    await openApp(page, '/workspace')

    const activeMenu = page.locator('.system-menu .asset-subnav-item.active')
    await expect(activeMenu).toHaveText('成员授权')
    const workspace = page.locator('.standard-system-content > .authz-workspace-host')
    await expect(workspace.getByText('应用角色', { exact: true }).first()).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)

    const geometry = await workspace.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const content = element.closest('.standard-system-content')?.getBoundingClientRect()
      return {
        position: getComputedStyle(element).position,
        left: rect.left,
        right: rect.right,
        contentLeft: content?.left || 0,
        contentRight: content?.right || 0
      }
    })
    expect(geometry.position).not.toBe('fixed')
    expect(geometry.left).toBeGreaterThanOrEqual(geometry.contentLeft)
    expect(geometry.right).toBeLessThanOrEqual(geometry.contentRight)

    const responsiveGeometry = await workspace.evaluate((element) => {
      const content = element.closest('.standard-system-content')?.getBoundingClientRect()
      const createButton = Array.from(element.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === '新建角色')
        ?.getBoundingClientRect()
      const roleTable = element.querySelector('.target-workspace-roles-table')?.getBoundingClientRect()
      return {
        contentRight: content?.right || 0,
        createButtonRight: createButton?.right || 0,
        roleTableRight: roleTable?.right || 0
      }
    })
    expect(responsiveGeometry.createButtonRight).toBeGreaterThan(0)
    expect(responsiveGeometry.createButtonRight).toBeLessThanOrEqual(responsiveGeometry.contentRight)
    expect(responsiveGeometry.roleTableRight).toBeLessThanOrEqual(responsiveGeometry.contentRight)
    await expectNoPageOverflow(page)

    await workspace.getByRole('button', { name: '分配给成员', exact: true }).click()
    const assignmentDialog = page.getByRole('dialog', { name: '分配 应用管理员 角色' })
    await expect(assignmentDialog).toBeVisible()
    const workspaceOverlay = page.locator('body > .el-overlay')
    await expect(workspaceOverlay).toBeVisible()
    await expect(workspaceOverlay).toHaveClass(/authz-workspace-host/)
    await expect(workspaceOverlay).toHaveClass(/authz-workspace-overlay/)
    await expect.poll(() => workspaceOverlay.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(15, 23, 42, 0.34)')
    await expect.poll(() => workspaceOverlay.evaluate((element) => getComputedStyle(element).getPropertyValue('--ecp-primary-500').trim())).toBe('#3370ff')
    await expect(workspace).not.toHaveCSS('position', 'fixed')
    await expect(page.locator('.system-menu')).toBeVisible()
    const shellBox = await workspace.boundingBox()
    const overlayBox = await workspaceOverlay.boundingBox()
    const dialogBox = await assignmentDialog.boundingBox()
    const viewport = page.viewportSize()
    expect(shellBox).not.toBeNull()
    expect(overlayBox).not.toBeNull()
    expect(dialogBox).not.toBeNull()
    expect(viewport).not.toBeNull()
    expect(shellBox).not.toMatchObject({ x: 0, y: 0, width: viewport?.width, height: viewport?.height })
    expect(overlayBox).toMatchObject({ x: 0, y: 0, width: viewport?.width, height: viewport?.height })
    expect(dialogBox!.width).toBeLessThan(overlayBox!.width)
    expect(dialogBox!.width).toBeGreaterThanOrEqual(600)
    expect(Math.abs(dialogBox!.x - (overlayBox!.width - dialogBox!.width) / 2)).toBeLessThanOrEqual(2)

    const memberSearch = assignmentDialog.getByRole('textbox', { name: '搜索授权对象' })
    await memberSearch.fill('zhou')
    await memberSearch.press('Enter')
    await expect(memberSearch).toHaveValue('zhou')
    await expect(assignmentDialog.locator('[data-member-search-count]')).toHaveText('检索次数 1')
    await memberSearch.press('Backspace')
    await expect(memberSearch).toHaveValue('zho')
    await page.waitForTimeout(250)
    await expect(assignmentDialog.locator('[data-member-search-count]')).toHaveText('检索次数 1')

    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.locator('body > .el-overlay')).toBeHidden()
    await expect.poll(() => workspace.evaluate((element) => getComputedStyle(element).position)).not.toBe('fixed')

    await workspace.getByRole('button', { name: '详情', exact: true }).click()
    const roleDrawer = page.getByRole('dialog', { name: '角色详情' })
    await expect(roleDrawer).toBeVisible()
    await expect(roleDrawer).toContainText('APP_ADMIN')
    await expect(roleDrawer.getByLabel('角色名称')).toBeDisabled()
    await expect(roleDrawer).not.toContainText('编辑应用角色')
    const roleDrawerBox = await roleDrawer.boundingBox()
    expect(roleDrawerBox).not.toBeNull()
    expect(roleDrawerBox!.width).toBe(600)
    expect(Math.abs(roleDrawerBox!.x + roleDrawerBox!.width - viewport!.width)).toBeLessThanOrEqual(1)
    await page.getByRole('button', { name: '关闭角色详情', exact: true }).click()
    await expect(roleDrawer).toBeHidden()

    await workspace.getByRole('button', { name: '02 账号管理 3 条授权', exact: true }).click()
    await workspace.getByRole('button', { name: '添加权限', exact: true }).click()
    const accountDrawer = page.getByRole('dialog', { name: '新增权限配置' })
    await expect(accountDrawer).toBeVisible()
    const accountDrawerBox = await accountDrawer.boundingBox()
    expect(accountDrawerBox).not.toBeNull()
    expect(accountDrawerBox!.width).toBe(600)
    expect(Math.abs(accountDrawerBox!.x + accountDrawerBox!.width - viewport!.width)).toBeLessThanOrEqual(1)
    await page.getByRole('button', { name: '关闭账号授权', exact: true }).click()
    await expect(accountDrawer).toBeHidden()

    await page.getByRole('button', { name: '员工信息', exact: true }).click()
    await expect(page).toHaveURL('/system/employees')
    await expect(page.getByText('员工信息', { exact: true }).first()).toBeVisible()
    await expect(page.locator('.authz-workspace-host')).toHaveCount(0)
    await expect(page.locator('body > .el-overlay.authz-workspace-overlay')).toHaveCount(0)

    await page.goto('/workspace')
    await expect(page).toHaveURL('/workspace')
  })

  test('资产导航保留迁移前的选中样式与展开交互', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '导航视觉和点击状态在桌面项目执行')
    await openApp(page, '/assets/borrow-return')

    await expect(page.getByRole('button', { name: '资产', exact: true }).locator('.nav-asset-icon')).toBeVisible()
    const parent = page.locator('.asset-subnav-parent')
    const children = page.locator('.asset-subnav-children')
    await expect(parent).toHaveAttribute('aria-expanded', 'false')
    await expect(children).toBeHidden()
    await parent.click()
    await expect(parent).toHaveAttribute('aria-expanded', 'true')
    await page.waitForTimeout(80)
    const expandingHeight = await children.evaluate((element) => element.getBoundingClientRect().height)
    await page.waitForTimeout(360)
    const expandedHeight = await children.evaluate((element) => element.getBoundingClientRect().height)
    expect(expandingHeight).toBeGreaterThan(0)
    expect(expandingHeight).toBeLessThan(expandedHeight)
    await expect(children).toBeVisible()
    const expansion = await page.locator('.asset-subnav-group').evaluate((element) => {
      const parentRect = element.querySelector('.asset-subnav-parent')?.getBoundingClientRect()
      const childRect = element.querySelector('.asset-subnav-child')?.getBoundingClientRect()
      return { parentBottom: Math.round(parentRect?.bottom || 0), childTop: Math.round(childRect?.top || 0) }
    })
    expect(expansion.childTop, JSON.stringify(expansion)).toBeGreaterThanOrEqual(expansion.parentBottom)

    await page.goto('/assets/settings/locations')
    const activeChild = page.locator('.asset-subnav-child.active')
    await expect(parent).toHaveAttribute('aria-expanded', 'true')
    await expect(parent).toHaveCSS('color', 'rgb(18, 150, 219)')
    await expect(parent).toHaveCSS('background-color', 'rgb(238, 249, 255)')
    await expect(activeChild).toHaveText('位置管理')
    await expect(activeChild).toHaveCSS('color', 'rgb(255, 255, 255)')
    await activeChild.hover()
    await expect.poll(() => activeChild.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41)).toBeGreaterThan(2)

    await parent.click()
    await expect(parent).toHaveAttribute('aria-expanded', 'false')
    await expect(activeChild).toBeHidden()
    await parent.click()
    await expect(parent).toHaveAttribute('aria-expanded', 'true')
    await expect(activeChild).toBeVisible()

    await page.getByRole('button', { name: '资产分类', exact: true }).click()
    await expect(page).toHaveURL('/assets/settings/categories')
    await expect(page.locator('.asset-subnav-child.active')).toHaveText('资产分类')

    await page.setViewportSize({ width: 1440, height: 600 })
    const subnav = page.locator('.standard-assets-page .asset-subnav')
    await subnav.evaluate((element) => { element.scrollTop = element.scrollHeight })
    const scrollTopBeforeNavigation = await subnav.evaluate((element) => element.scrollTop)
    expect(scrollTopBeforeNavigation).toBeGreaterThan(0)
    await page.getByRole('button', { name: '标签模板设置', exact: true }).click()
    await expect(page).toHaveURL('/assets/settings/label-templates')
    await expect.poll(() => page.locator('.standard-assets-page .asset-subnav').evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(scrollTopBeforeNavigation - 2)
  })

  test('模块切换复用已打开页面并保留现场', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '模块缓存与桌面侧栏切换在桌面项目执行')
    await openApp(page, '/assets')
    const listView = page.locator('.asset-directory-view')
    await listView.evaluate((element) => { element.setAttribute('data-cache-probe', 'kept') })
    await page.getByPlaceholder('搜索', { exact: true }).fill('测试笔记本')

    await page.getByRole('button', { name: '资产入库', exact: true }).click()
    await expect(page).toHaveURL('/assets/inbound')
    await page.getByRole('button', { name: '资产列表', exact: true }).click()
    await expect(page).toHaveURL('/assets')
    await expect(page.locator('.asset-directory-view')).toHaveAttribute('data-cache-probe', 'kept')
    await expect(page.getByPlaceholder('搜索', { exact: true })).toHaveValue('测试笔记本')

    await page.getByRole('button', { name: '系统', exact: true }).click()
    await expect(page).toHaveURL('/system/employees')
    await page.getByRole('button', { name: '资产', exact: true }).click()
    await expect(page).toHaveURL('/assets')
    await page.getByRole('button', { name: '系统', exact: true }).click()
    await expect(page).toHaveURL('/system/employees')
  })

  test('当前一级模块锁定且重复点击不会跳转', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '一级侧栏导航在桌面项目执行')
    const cases = [
      { path: '/', label: '首页' },
      { path: '/assets', label: '资产' },
      { path: '/assets/settings/categories', label: '资产' },
      { path: '/requests', label: '审批' },
      { path: '/system/employees', label: '系统' },
      { path: '/workspace', label: '系统' }
    ] as const

    await installApiMocks(page)
    for (const item of cases) {
      await page.goto(item.path)
      await expect(page.locator('.standard-portal-shell')).toBeVisible()
      const activePrimary = page.getByRole('button', { name: item.label, exact: true }).first()
      await expect(activePrimary).toHaveAttribute('aria-current', 'page')
      await expect(activePrimary).toBeDisabled()
      await activePrimary.evaluate((element) => (element as HTMLButtonElement).click())
      await expect(page).toHaveURL(item.path)
    }
  })

  test('管理端铃铛展示待审批消息并可定位到对应审批单', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '管理端侧栏提醒在桌面项目执行')
    const state = await openApp(page, '/')

    let bell = page.getByRole('button', { name: '审批消息，1 条待处理', exact: true })
    await expect(bell).toBeVisible()
    await expect(bell.locator('.sidebar-notification-badge')).toHaveText('1')
    state.approvals.unshift({
      id: 'REQ-NOTICE-NEW', type: '资产退还', applicant: '王五', asset: '研发笔记本', reason: '',
      status: '待审批', system: '资产管理员审批', date: '2026-07-22', currentNode: '管理员审批'
    })
    await expect(page.locator('.el-notification')).toContainText('新增审批待办', { timeout: 5_000 })
    await expect(page.locator('.el-notification')).toContainText('王五提交了资产退还申请')
    bell = page.getByRole('button', { name: '审批消息，2 条待处理', exact: true })
    await expect(bell.locator('.sidebar-notification-badge')).toHaveText('2')
    await bell.click()

    const dialog = page.getByRole('dialog', { name: '消息通知' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('tab', { name: '审批消息 2', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog).toContainText('张三')
    await expect(dialog).toContainText('资产领用待审批')
    await expect(dialog).toContainText('王五')
    await dialog.getByRole('tab', { name: '业务待办', exact: true }).click()
    const originalTodo = dialog.locator('.approval-todo-item').filter({ hasText: 'REQ-001' })
    await expect(originalTodo.getByRole('button', { name: '去处理', exact: true })).toBeVisible()
    await originalTodo.getByRole('button', { name: '去处理', exact: true }).click()

    await expect(page).toHaveURL(/\/requests\?request=REQ-001/)
    await expect(page.locator('.approval-workspace tbody')).toContainText('REQ-001')
    await expect(page.locator('.approval-workspace tbody')).not.toContainText('REQ-002')
  })

  test('管理员保留员工端切换与员工视图', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '端模式导航在桌面项目执行')
    await openApp(page, '/')
    await expect(page.getByRole('button', { name: '审批消息，1 条待处理', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '测试管理员', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: '切换员工端', exact: true })).toBeVisible()
    await page.getByRole('menuitem', { name: '切换员工端', exact: true }).click()

    await expect(page.locator('body')).toHaveClass(/employee-terminal-view/)
    await expect(page.getByRole('button', { name: '首页', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '申请', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '资产', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '系统', exact: true })).toHaveCount(0)
    await expect(page.locator('.sidebar-notification-tool')).toHaveCount(0)
    await expect(page.locator('.nav-item')).toHaveCount(2)
    await expect(page.getByText('我的设备概览', { exact: true })).toBeVisible()
    await expect(page.getByText('资产总数', { exact: true })).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('assetPortalTerminalMode'))).toBe('employee')

    await page.goto('/assets')
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('button', { name: '资产', exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: '测试管理员', exact: true }).click()
    await page.getByRole('menuitem', { name: '切换管理端', exact: true }).click()
    await expect(page.getByRole('button', { name: '系统', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '审批消息，1 条待处理', exact: true })).toBeVisible()
    await expect(page.getByText('资产总数', { exact: true })).toBeVisible()
  })

  test('从员工签字页切回管理端会回到管理首页', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '端模式导航在桌面项目执行')
    await openApp(page, '/')

    await page.getByRole('button', { name: '测试管理员', exact: true }).click()
    await page.getByRole('menuitem', { name: '切换员工端', exact: true }).click()
    await page.getByRole('button', { name: '签字', exact: true }).click()
    await expect(page).toHaveURL('/signatures')
    await expect(page.getByRole('heading', { name: '签字', exact: true })).toBeVisible()

    await page.getByRole('button', { name: '测试管理员', exact: true }).click()
    await page.getByRole('menuitem', { name: '切换管理端', exact: true }).click()
    await expect(page).toHaveURL('/')
    await expect(page.locator('body')).not.toHaveClass(/employee-terminal-view/)
    await expect(page.getByRole('button', { name: '资产', exact: true })).toBeVisible()
    await expect(page.getByText('资产总数', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '签字', exact: true })).toHaveCount(0)
  })

  test('员工首页资产编码打开数据库资产详情', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '员工资产详情完整字段在桌面项目执行')
    await page.addInitScript(() => localStorage.setItem('assetPortalTerminalMode', 'employee'))
    await installApiMocks(page)
    await page.route('http://127.0.0.1:4174/api/assets', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [{
        id: 'AST-EMP-001', name: '员工显示器', status: '领用', category: 'IT设备', type: '设备',
        owner: '测试管理员', ownerSubject: 'E2E001', department: '研发部', company: '示例公司', ownerCompany: '资产所属公司',
        location: '杭州仓库', custodian: '资产管理员', brand: '测试品牌', model: 'M-1', sn: 'SN-1', condition: '正常',
        price: 5000, purchaseDate: '2026-07-01', receiveDate: '2026-07-21'
      }] })
    }))
    await page.goto('/')

    await page.getByRole('button', { name: '查看资产 AST-EMP-001 详情', exact: true }).click()
    const assetDetail = page.getByRole('dialog', { name: '资产详情' })
    await expect(assetDetail).toBeVisible()
    for (const value of ['员工显示器', 'AST-EMP-001', 'IT设备', '测试品牌 M-1', 'SN-1', '示例公司', '杭州仓库', '资产管理员', '2026-07-21', '正常']) {
      await expect(assetDetail.getByText(value, { exact: true }).first()).toBeVisible()
    }
    for (const label of ['资产分类', '设备序列号', '使用公司', '所在位置', '管理员', '领用日期', '资产状况']) {
      await expect(assetDetail.getByText(label, { exact: true })).toBeVisible()
    }
    const detailBounds = await assetDetail.locator('.employee-asset-detail-dialog').boundingBox()
    expect(detailBounds?.width).toBeLessThanOrEqual(520)
    await expect(assetDetail.getByRole('button', { name: '退还', exact: true })).toBeVisible()
    await expect(assetDetail.getByRole('button', { name: '交接', exact: true })).toBeVisible()
    await assetDetail.locator('.el-dialog__headerbtn').click()
    await expect(assetDetail).toBeHidden()
  })

  test('员工首页退还和交接直接打开已选资产的申请表单', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '员工首页快捷申请在桌面项目执行')
    await page.addInitScript(() => localStorage.setItem('assetPortalTerminalMode', 'employee'))
    const state = await installApiMocks(page)
    await page.route('http://127.0.0.1:4174/api/assets', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [{
        id: 'AST-EMP-001', name: '员工显示器', status: '领用', category: 'IT设备', type: '设备',
        owner: '测试管理员', ownerSubject: 'E2E001', department: '研发部', company: '示例公司',
        location: '杭州仓库', custodian: '资产管理员', brand: '测试品牌', model: 'M-1', sn: 'SN-1',
        price: 5000, purchaseDate: '2026-07-01', receiveDate: '2026-07-21'
      }] })
    }))
    await page.goto('/')

    await page.getByRole('button', { name: '退还', exact: true }).click()
    await expect(page).toHaveURL('/')
    let dialog = page.getByRole('dialog', { name: '资产退还' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('AST-EMP-001')
    for (const label of ['退库人', '所属公司', '所在部门', '退库后位置', '经办人', '退库日期', '退库备注', '选择退还资产', '已选择资产 1']) {
      await expect(dialog.getByText(label, { exact: true }).first()).toBeVisible()
    }
    await dialog.getByRole('button', { name: '取消', exact: true }).click()

    await page.getByRole('button', { name: '交接', exact: true }).click()
    await expect(page).toHaveURL('/')
    dialog = page.getByRole('dialog', { name: '资产交接' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('AST-EMP-001')
    for (const label of ['接收人', '接收公司', '接收部门', '接收位置', '交接日期', '经办人', '交接备注', '选择资产', '已选择资产 1']) {
      await expect(dialog.getByText(label, { exact: true }).first()).toBeVisible()
    }
    const receiver = dialog.getByPlaceholder('搜索姓名、工号或邮箱')
    await receiver.fill('员工2')
    await page.getByRole('option').filter({ hasText: '员工2' }).first().click()
    await expect(dialog.getByLabel('接收公司')).toHaveValue('示例公司')
    await expect(dialog.getByLabel('接收部门')).toHaveValue('综合部')
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
    await expect(dialog).toBeHidden()

    const submitted = state.requests.find((request) => request.method === 'POST' && request.path === '/api/business-data/requests')
    expect(submitted?.body).toMatchObject({
      type: '资产交接',
      details: {
        assetIds: ['AST-EMP-001'],
        receiverSubject: 'sub-2',
        receiverName: '员工2',
        receiverCompany: '示例公司',
        receiverDepartment: '综合部',
        handoverLocation: '杭州仓库'
      }
    })

    await page.getByRole('button', { name: '申请', exact: true }).click()
    await expect(page).toHaveURL('/requests')
    const createdCard = page.locator('.employee-request-card').filter({ hasText: 'REQ-NEW' })
    await expect(createdCard).toContainText('待审批')

    await page.getByText('自助交接', { exact: true }).click()
    const requestDialog = page.getByRole('dialog', { name: '资产交接' })
    await expect(requestDialog).toBeVisible()
    for (const label of ['接收人', '接收公司', '接收部门', '接收位置', '交接日期', '经办人', '交接备注', '选择资产']) {
      await expect(requestDialog.getByText(label, { exact: true }).first()).toBeVisible()
    }
  })

  test('员工申请列表支持翻页并可选择每页数量', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '员工申请分页完整交互在桌面项目执行')
    await page.addInitScript(() => localStorage.setItem('assetPortalTerminalMode', 'employee'))
    const approvals = Array.from({ length: 25 }, (_, index) => ({
      id: `REQ-PAGE-${String(index + 1).padStart(2, '0')}`,
      type: index % 2 === 0 ? '资产领用' : '资产借用',
      applicant: '测试管理员',
      company: '示例公司',
      department: '研发部',
      asset: `测试资产 ${index + 1}`,
      assetCount: 1,
      status: index % 3 === 0 ? '审批中' : '已完成',
      date: '2026-08-07'
    }))
    await openApp(page, '/requests', { approvals })

    const cards = page.locator('.employee-request-card')
    const pagination = page.locator('.employee-request-pagination')
    await expect(cards).toHaveCount(10)
    await expect(cards.first()).toContainText('REQ-PAGE-01')
    await expect(pagination).toBeVisible()
    await expect(pagination).toContainText('共 25 条')
    const listLayout = await page.locator('.employee-request-card-list').evaluate((element) => {
      const pagination = element.nextElementSibling?.querySelector('.employee-request-pagination') || element.nextElementSibling
      const paginationRect = pagination?.getBoundingClientRect()
      return {
        canScroll: element.scrollHeight > element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
        paginationBottom: paginationRect?.bottom || 0,
        viewportHeight: window.innerHeight
      }
    })
    expect(listLayout.canScroll, JSON.stringify(listLayout)).toBe(true)
    expect(listLayout.overflowY, JSON.stringify(listLayout)).toBe('auto')
    expect(listLayout.paginationBottom, JSON.stringify(listLayout)).toBeLessThanOrEqual(listLayout.viewportHeight + 1)

    await pagination.locator('.btn-next').click()
    await expect(cards).toHaveCount(10)
    await expect(cards.first()).toContainText('REQ-PAGE-11')

    const pageSize = pagination.locator('.el-select')
    await pageSize.click()
    for (const label of ['10 条/页', '20 条/页', '50 条/页', '100 条/页']) {
      await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible()
    }
    await page.getByRole('option', { name: '20 条/页', exact: true }).click()
    await expect(cards).toHaveCount(20)
    await expect(cards.first()).toContainText('REQ-PAGE-01')
  })

  test('自助退还按配置展示并支持名下领用资产批量申请', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '批量退还完整流程在桌面项目执行')
    await page.addInitScript(() => localStorage.setItem('assetPortalTerminalMode', 'employee'))
    const state = await installApiMocks(page)
    await page.route('http://127.0.0.1:4174/api/assets', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [
        { id: 'AST-RET-001', name: '待退还笔记本', status: '领用', category: 'IT设备', type: '设备', owner: '测试管理员', ownerSubject: 'E2E001', department: '研发部', company: '示例公司', location: '杭州仓库', custodian: '资产管理员', brand: '测试品牌', model: 'R-1', sn: 'RET-SN-1', price: 5000 },
        { id: 'AST-RET-002', name: '待退还显示器', status: '领用', category: 'IT设备', type: '设备', owner: '测试管理员', ownerSubject: 'E2E001', department: '研发部', company: '示例公司', location: '杭州仓库', custodian: '资产管理员', brand: '测试品牌', model: 'R-2', sn: 'RET-SN-2', price: 3000 }
      ] })
    }))
    await page.goto('/requests')

    await page.getByText('自助退还', { exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '资产退还' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('已选择资产 0', { exact: true })).toBeVisible()
    await dialog.locator('.handover-asset-card').filter({ hasText: 'AST-RET-001' }).click()
    await dialog.locator('.handover-asset-card').filter({ hasText: 'AST-RET-002' }).click()
    await expect(dialog.getByText('已选择资产 2', { exact: true })).toBeVisible()
    await choosePortalSelectOption(page, dialog.locator('.handover-request-fields .el-select'), '杭州仓库')
    await dialog.getByPlaceholder('请输入退库备注').fill('批量退还测试')
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
    await expect(dialog).toBeHidden()

    const submitted = state.requests.find((request) => request.method === 'POST' && request.path === '/api/business-data/requests')
    expect(submitted?.body).toMatchObject({
      type: '资产退还',
      reason: '批量退还测试',
      details: {
        assetIds: ['AST-RET-001', 'AST-RET-002'],
        assetCount: 2,
        returnLocation: '杭州仓库'
      }
    })
    const createdCard = page.locator('.employee-request-card').filter({ hasText: 'REQ-NEW' })
    await expect(createdCard).toContainText('自助退还')
    await expect(createdCard).toContainText('待审批')
    await expect(createdCard).toContainText('2')
  })

  test('自助归还只展示本人借用资产并提交待审批申请', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '自助归还完整表单在桌面项目执行')
    await page.addInitScript(() => localStorage.setItem('assetPortalTerminalMode', 'employee'))
    const state = await openApp(page, '/requests', {
      assets: [
        { id: 'AST-GIVE-BACK-001', name: '本人借用笔记本', status: '借用中', category: 'IT设备', type: '设备', owner: '测试管理员', ownerSubject: 'E2E001', department: '研发部', company: '示例公司', location: '会议室', custodian: '资产管理员', brand: '测试品牌', model: 'GB-1', sn: 'GIVE-BACK-SN-1', assetTag: '', price: 5000, borrowDate: '2026-07-10', expectedReturnDate: '2026-07-30' },
        { id: 'AST-GIVE-BACK-002', name: '他人借用笔记本', status: '借用中', category: 'IT设备', type: '设备', owner: '其他员工', ownerSubject: 'OTHER001', department: '综合部', company: '示例公司', location: '会议室', custodian: '资产管理员', brand: '测试品牌', model: 'GB-2', sn: 'GIVE-BACK-SN-2', assetTag: '', price: 4500, borrowDate: '2026-07-11', expectedReturnDate: '2026-07-31' },
        { id: 'AST-GIVE-BACK-003', name: '本人领用显示器', status: '领用', category: 'IT设备', type: '设备', owner: '测试管理员', ownerSubject: 'E2E001', department: '研发部', company: '示例公司', location: '工位', custodian: '资产管理员', brand: '测试品牌', model: 'GB-3', sn: 'GIVE-BACK-SN-3', assetTag: '', price: 3000 }
      ]
    })

    await expect(page.locator('.employee-request-action-icon svg')).toHaveCount(5)
    await page.getByRole('button', { name: '资产归还', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '资产归还' })
    await expect(dialog).toBeVisible()
    for (const label of ['归还人', '所属公司', '所在部门', '归还后位置', '经办人', '归还日期', '归还备注', '选择归还资产']) {
      await expect(dialog.getByText(label, { exact: true }).first()).toBeVisible()
    }
    await expect(dialog).toContainText('AST-GIVE-BACK-001')
    await expect(dialog).toContainText('借用日期：2026-07-10')
    await expect(dialog).toContainText('预计归还日期：2026-07-30')
    await expect(dialog).not.toContainText('AST-GIVE-BACK-002')
    await expect(dialog).not.toContainText('AST-GIVE-BACK-003')

    await dialog.locator('.handover-asset-card').filter({ hasText: 'AST-GIVE-BACK-001' }).click()
    await expect(dialog.getByText('已选择资产 1', { exact: true })).toBeVisible()
    await choosePortalSelectOption(page, dialog.locator('.handover-request-fields .el-select'), '杭州仓库')
    await dialog.getByPlaceholder('请输入归还备注').fill('设备已使用完毕')
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
    await expect(dialog).toBeHidden()

    const submitted = state.requests.find((request) => request.method === 'POST' && request.path === '/api/business-data/requests')
    expect(submitted?.body).toMatchObject({
      type: '资产归还',
      reason: '设备已使用完毕',
      details: {
        assetIds: ['AST-GIVE-BACK-001'],
        assetCount: 1,
        returnLocation: '杭州仓库',
        returnDate: '2026-07-22'
      }
    })
    const createdCard = page.locator('.employee-request-card').filter({ hasText: 'REQ-NEW' })
    await expect(createdCard).toContainText('自助归还')
    await expect(createdCard).toContainText('待审批')
  })

  test('自助领用按配置分类展示空闲资产并支持扫码提交待审批申请', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '自助领用完整表单在桌面项目执行')
    await page.addInitScript(() => localStorage.setItem('assetPortalTerminalMode', 'employee'))
    const state = await openApp(page, '/requests', {
      receiveApprovalRequired: true,
      receiveCategories: ['IT设备'],
      locationTree: [{ id: 'loc-hz', code: 'HZ', name: '杭州公司', enabled: true, children: [
        { id: 'loc-hz-19-1', code: 'HZ-19-1', name: '19幢1楼', enabled: true, children: [] }
      ] }],
      assets: [
        { id: 'AST-RECEIVE-001', name: '可领用笔记本', status: '空闲', category: 'IT设备', type: '设备', owner: '未分配', ownerSubject: '', department: '', company: '示例公司', location: '杭州仓库', custodian: '资产管理员', brand: '测试品牌', model: 'R-1', sn: 'RECEIVE-SN-1', assetTag: 'TAG-RECEIVE-1', price: 5000 },
        { id: 'AST-RECEIVE-002', name: '未配置分类显示器', status: '空闲', category: '显示器', type: '设备', owner: '未分配', ownerSubject: '', department: '', company: '示例公司', location: '杭州仓库', custodian: '资产管理员', brand: '测试品牌', model: 'R-2', sn: 'RECEIVE-SN-2', assetTag: '', price: 3000 },
        { id: 'AST-RECEIVE-003', name: '非空闲笔记本', status: '闲置', category: 'IT设备', type: '设备', owner: '未分配', ownerSubject: '', department: '', company: '示例公司', location: '杭州仓库', custodian: '资产管理员', brand: '测试品牌', model: 'R-3', sn: 'RECEIVE-SN-3', assetTag: '', price: 4500 }
      ]
    })

    await page.getByRole('button', { name: '资产领用', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '资产领用' })
    await expect(dialog).toBeVisible()
    await expect(page.locator('.el-select-dropdown:visible')).toHaveCount(0)
    for (const label of ['领用人', '领用类型', '所属公司', '所在部门', '领用后位置', '经办人', '领用日期', '领用备注', '资产分类', '选择领用资产']) {
      await expect(dialog.getByText(label, { exact: true }).first()).toBeVisible()
    }
    await expect(dialog.getByLabel('领用类型')).toHaveValue('个人领用')
    const operatorSelect = dialog.locator('.el-form-item').filter({ hasText: '经办人' }).locator('.el-select')
    await expect(operatorSelect.locator('input')).toHaveValue('')
    await operatorSelect.click()
    await expect(page.getByRole('option', { name: '资产管理员甲', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: '资产管理员乙', exact: true })).toBeVisible()
    await page.getByRole('option', { name: '资产管理员乙', exact: true }).click()
    await expect(operatorSelect.locator('input')).toHaveValue('资产管理员乙')
    await expect(dialog).toContainText('AST-RECEIVE-001')
    await expect(dialog).not.toContainText('AST-RECEIVE-002')
    await expect(dialog).not.toContainText('AST-RECEIVE-003')

    await dialog.getByRole('button', { name: '扫码精确查询', exact: true }).click()
    const scanInput = dialog.getByRole('textbox', { name: '扫码内容', exact: true })
    await scanInput.fill('TAG-RECEIVE-1')
    await scanInput.press('Enter')
    await expect(dialog.getByText('已选择资产 1', { exact: true })).toBeVisible()
    const locationSelect = dialog.locator('.el-form-item').filter({ hasText: '领用后位置' }).locator('.el-select')
    await locationSelect.click()
    await expect(page.locator('.el-select-dropdown:visible .el-tree-node.is-expanded')).toHaveCount(0)
    await page.getByRole('option', { name: '杭州公司', exact: true }).last().click()
    await dialog.getByPlaceholder('请输入领用备注').fill('项目办公领用')
    await dialog.getByRole('button', { name: '确认提交', exact: true }).click()
    await expect(dialog).toBeHidden()
    const requestSubmission = state.requests.find((item) => item.method === 'POST' && item.path === '/api/business-data/requests')
    expect(requestSubmission?.body).toMatchObject({ details: { operatorSubject: 'admin-2' } })

    const submitted = state.requests.find((request) => request.method === 'POST' && request.path === '/api/business-data/requests')
    expect(submitted?.body).toMatchObject({
      type: '资产领用',
      reason: '项目办公领用',
      details: {
        assetIds: ['AST-RECEIVE-001'],
        assetCount: 1,
        receiveType: '个人领用',
        receiveLocation: '杭州公司'
      }
    })
    const createdCard = page.locator('.employee-request-card').filter({ hasText: 'REQ-NEW' })
    await expect(createdCard).toContainText('自助领用')
    await expect(createdCard).toContainText('待审批')
  })

  test('免审批自助领用立即生效并出现在我的资产', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '自助领用即时落账在桌面项目执行')
    await page.addInitScript(() => localStorage.setItem('assetPortalTerminalMode', 'employee'))
    await openApp(page, '/requests', {
      receiveApprovalRequired: false,
      receiveCategories: ['IT设备'],
      assets: [{ id: 'AST-RECEIVE-NOW', name: '即时领用笔记本', status: '空闲', category: 'IT设备', type: '设备', owner: '未分配', ownerSubject: '', department: '', company: '示例公司', location: '杭州仓库', custodian: '资产管理员', brand: '测试品牌', model: 'NOW-1', sn: 'NOW-SN-1', assetTag: '', price: 6000 }]
    })

    await page.getByRole('button', { name: '资产领用', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '资产领用' })
    await dialog.locator('.handover-asset-card').filter({ hasText: 'AST-RECEIVE-NOW' }).click()
    await choosePortalSelectOption(page, dialog.locator('.handover-request-fields .el-select'), '杭州仓库')
    await dialog.getByRole('button', { name: '确认提交', exact: true }).click()
    await expect(dialog).toBeHidden()

    const createdCard = page.locator('.employee-request-card').filter({ hasText: 'REQ-NEW' })
    await expect(createdCard).toContainText('自助领用')
    await expect(createdCard).toContainText('已同意')
    await page.getByRole('button', { name: '首页', exact: true }).click()
    const receivedDevice = page.locator('.device-card').filter({ hasText: 'AST-RECEIVE-NOW' })
    await expect(receivedDevice).toContainText('即时领用笔记本')
    await expect(receivedDevice).toContainText('AST-RECEIVE-NOW')
  })

  test('自助借用按配置分类展示空闲资产并支持扫码提交待审批申请', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '自助借用完整表单在桌面项目执行')
    await page.addInitScript(() => localStorage.setItem('assetPortalTerminalMode', 'employee'))
    const state = await openApp(page, '/requests', {
      borrowApprovalRequired: true,
      borrowCategories: ['IT设备'],
      assets: [
        { id: 'AST-BORROW-001', name: '可借用笔记本', status: '空闲', category: 'IT设备', type: '设备', owner: '未分配', ownerSubject: '', department: '', company: '示例公司', location: '杭州仓库', custodian: '资产管理员', brand: '测试品牌', model: 'B-1', sn: 'BORROW-SN-1', assetTag: 'TAG-BORROW-1', price: 5000 },
        { id: 'AST-BORROW-002', name: '未配置分类显示器', status: '空闲', category: '显示器', type: '设备', owner: '未分配', ownerSubject: '', department: '', company: '示例公司', location: '杭州仓库', custodian: '资产管理员', brand: '测试品牌', model: 'B-2', sn: 'BORROW-SN-2', assetTag: '', price: 3000 },
        { id: 'AST-BORROW-003', name: '非空闲笔记本', status: '闲置', category: 'IT设备', type: '设备', owner: '未分配', ownerSubject: '', department: '', company: '示例公司', location: '杭州仓库', custodian: '资产管理员', brand: '测试品牌', model: 'B-3', sn: 'BORROW-SN-3', assetTag: '', price: 4500 }
      ]
    })

    await page.getByRole('button', { name: '资产借用', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '资产借用' })
    await expect(dialog).toBeVisible()
    for (const label of ['借用人', '所属公司', '所在部门', '借用后位置', '经办人', '借用日期', '预计归还日期', '借用备注', '资产分类', '选择借用资产']) {
      await expect(dialog.getByText(label, { exact: true }).first()).toBeVisible()
    }
    await expect(dialog).toContainText('AST-BORROW-001')
    await expect(dialog).not.toContainText('AST-BORROW-002')
    await expect(dialog).not.toContainText('AST-BORROW-003')

    const expectedReturnField = dialog.locator('.el-form-item').filter({ hasText: '预计归还日期' })
    await expectedReturnField.locator('input').click()
    const datePanel = page.locator('.el-picker-panel:visible').last()
    await expect(datePanel).toBeVisible()
    const datePanelGeometry = await datePanel.evaluate((element) => {
      const panel = element.getBoundingClientRect()
      const table = element.querySelector('.el-date-table')?.getBoundingClientRect()
      return {
        panelWidth: panel.width,
        panelRight: panel.right,
        tableWidth: table?.width || 0,
        viewportWidth: document.documentElement.clientWidth
      }
    })
    expect(datePanelGeometry.panelWidth).toBeLessThanOrEqual(360)
    expect(datePanelGeometry.tableWidth).toBeLessThanOrEqual(datePanelGeometry.panelWidth + 1)
    expect(datePanelGeometry.panelRight).toBeLessThanOrEqual(datePanelGeometry.viewportWidth + 1)
    await page.keyboard.press('Escape')

    await dialog.getByRole('button', { name: '扫码精确查询', exact: true }).click()
    const scanInput = dialog.getByRole('textbox', { name: '扫码内容', exact: true })
    await scanInput.fill('TAG-BORROW-1')
    await scanInput.press('Enter')
    await expect(dialog.getByText('已选择资产 1', { exact: true })).toBeVisible()
    await choosePortalSelectOption(page, dialog.locator('.handover-request-fields .el-select'), '杭州仓库')
    const expectedReturnInput = dialog.locator('.el-form-item').filter({ hasText: '预计归还日期' }).locator('input')
    await expectedReturnInput.fill('2026-08-22')
    await expectedReturnInput.press('Enter')
    await dialog.getByPlaceholder('请输入借用备注').fill('项目临时借用')
    await dialog.getByRole('button', { name: '确认提交', exact: true }).click()
    await expect(dialog).toBeHidden()

    const submitted = state.requests.find((request) => request.method === 'POST' && request.path === '/api/business-data/requests')
    expect(submitted?.body).toMatchObject({
      type: '资产借用',
      reason: '项目临时借用',
      details: {
        assetIds: ['AST-BORROW-001'],
        assetCount: 1,
        borrowLocation: '杭州仓库',
        borrowDate: '2026-07-22',
        expectedReturnDate: '2026-08-22'
      }
    })
    const createdCard = page.locator('.employee-request-card').filter({ hasText: 'REQ-NEW' })
    await expect(createdCard).toContainText('自助借用')
    await expect(createdCard).toContainText('待审批')
  })

  test('免审批自助借用立即生效并出现在我的资产', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '自助借用即时落账在桌面项目执行')
    await page.addInitScript(() => localStorage.setItem('assetPortalTerminalMode', 'employee'))
    await openApp(page, '/requests', {
      borrowApprovalRequired: false,
      borrowCategories: ['IT设备'],
      assets: [{ id: 'AST-BORROW-NOW', name: '即时借用笔记本', status: '空闲', category: 'IT设备', type: '设备', owner: '未分配', ownerSubject: '', department: '', company: '示例公司', location: '杭州仓库', custodian: '资产管理员', brand: '测试品牌', model: 'BORROW-NOW', sn: 'BORROW-NOW-SN', assetTag: '', price: 6000 }]
    })

    await page.getByRole('button', { name: '资产借用', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '资产借用' })
    await dialog.locator('.handover-asset-card').filter({ hasText: 'AST-BORROW-NOW' }).click()
    await choosePortalSelectOption(page, dialog.locator('.handover-request-fields .el-select'), '杭州仓库')
    const expectedReturnInput = dialog.locator('.el-form-item').filter({ hasText: '预计归还日期' }).locator('input')
    await expectedReturnInput.fill('2026-08-22')
    await expectedReturnInput.press('Enter')
    await dialog.getByRole('button', { name: '确认提交', exact: true }).click()
    await expect(dialog).toBeHidden()

    const createdCard = page.locator('.employee-request-card').filter({ hasText: 'REQ-NEW' })
    await expect(createdCard).toContainText('自助借用')
    await expect(createdCard).toContainText('已同意')
    await page.getByRole('button', { name: '首页', exact: true }).click()
    const borrowedDevice = page.locator('.device-card').filter({ hasText: 'AST-BORROW-NOW' })
    await expect(borrowedDevice).toContainText('即时借用笔记本')
    await expect(borrowedDevice).toContainText('AST-BORROW-NOW')
  })

  test('管理员未开放员工自助时功能菜单为空', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '员工自助入口配置在桌面项目执行')
    await page.addInitScript(() => localStorage.setItem('assetPortalTerminalMode', 'employee'))
    await openApp(page, '/requests', { selfServiceEnabled: false })
    await expect(page.locator('.employee-request-action')).toHaveCount(0)
    await expect(page.getByText('当前未开放自助申请', { exact: true })).toBeVisible()
  })

  test('管理员可配置自助领用审批方式和资产分类范围', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '员工自助管理配置在桌面项目执行')
    await openApp(page, '/system/self-service')

    const receiveBlock = page.locator('.self-service-config-block').filter({ hasText: '自助资产领用' })
    await expect(receiveBlock).toBeVisible()
    const approvalRow = receiveBlock.locator('.self-service-config-row').filter({ hasText: '需要管理员审批' })
    await expect(approvalRow.locator('.el-switch')).toHaveClass(/is-checked/)
    const categoryRow = receiveBlock.locator('.self-service-config-row').filter({ hasText: '自助申请资产类别' })
    await expect(categoryRow).toContainText('IT设备')
  })

  test('管理员可配置自助借用审批方式和资产分类范围', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '员工自助管理配置在桌面项目执行')
    await openApp(page, '/system/self-service')

    const borrowBlock = page.locator('.self-service-config-block').filter({ hasText: '自助资产借用' })
    await expect(borrowBlock).toBeVisible()
    const approvalRow = borrowBlock.locator('.self-service-config-row').filter({ hasText: '需要管理员审批' })
    await expect(approvalRow.locator('.el-switch')).toHaveClass(/is-checked/)
    const categoryRow = borrowBlock.locator('.self-service-config-row').filter({ hasText: '自助申请资产类别' })
    await expect(categoryRow).toContainText('IT设备')
  })

  test('签字设置菜单可以展开和收回', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '签字设置菜单交互在桌面项目执行')
    await openApp(page, '/system/self-service')

    const signButton = page.getByRole('button', { name: '签字设置', exact: true })
    const signChildren = page.locator('.self-service-children')
    await expect(signButton).toHaveAttribute('aria-expanded', 'false')
    await expect(signChildren).not.toBeVisible()

    await signButton.click()
    await expect(signButton).toHaveAttribute('aria-expanded', 'true')
    await expect(signChildren).toBeVisible()

    await signButton.click()
    await expect(signButton).toHaveAttribute('aria-expanded', 'false')
    await expect(signChildren).not.toBeVisible()
  })

  test('管理员关闭自助退还后员工入口隐藏', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '员工自助入口配置在桌面项目执行')
    await page.addInitScript(() => localStorage.setItem('assetPortalTerminalMode', 'employee'))
    await openApp(page, '/requests', { returnEnabled: false })
    await expect(page.getByText('自助退还', { exact: true })).toHaveCount(0)
  })

  test('办公设备申领开关控制员工入口和多设备追加', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '办公设备申领配置在桌面项目执行')
    await page.addInitScript(() => localStorage.setItem('assetPortalTerminalMode', 'employee'))
    await openApp(page, '/requests', { deviceRequestEnabled: true, allowEmployeeAddDevice: false })

    await page.getByRole('button', { name: '办公设备申领', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '办公设备申领' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: '添加设备', exact: true })).toHaveCount(0)
    await expect(dialog.getByText('管理员当前仅允许每张申请单填写一项设备。', { exact: true })).toBeVisible()
    await expect(dialog.locator('.device-request-item')).toHaveCount(1)
  })

  test('备注必填和提示语同步到员工申请表单', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '员工自助备注策略在桌面项目执行')
    await page.addInitScript(() => localStorage.setItem('assetPortalTerminalMode', 'employee'))
    await openApp(page, '/requests', {
      receiveRemarkRequired: true,
      receiveRemarkPrompt: '请填写领用用途和项目名称',
      assets: [{ id: 'AST-REMARK', name: '备注测试设备', status: '空闲', category: 'IT设备', type: '设备', owner: '未分配', ownerSubject: '', department: '', company: '示例公司', location: '杭州仓库', custodian: '资产管理员', brand: '测试品牌', model: 'R1', sn: 'R1-SN', assetTag: '', price: 5000 }]
    })

    await page.getByRole('button', { name: '资产领用', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '资产领用' })
    const remark = dialog.locator('.el-form-item').filter({ hasText: '领用备注' })
    await expect(remark).toHaveClass(/is-required/)
    await expect(remark.locator('textarea')).toHaveAttribute('placeholder', '请填写领用用途和项目名称')
  })

  test('首页保留迁移前的统计与仪表盘板块', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '仪表盘完整板块在桌面项目执行')
    await openApp(page, '/')
    for (const text of ['资产总数', '领用资产', '待处理单据', '资产原值', '资产状态占比', '资产分布情况', '领用资产统计', '资产分类统计']) {
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible()
    }
    await expect(page.getByText('最近资产', { exact: true })).toHaveCount(0)
    await expect(page.getByText('最近审批', { exact: true })).toHaveCount(0)
    const bars = page.locator('.asset-distribution-bar:has(strong)')
    await expect(bars).toHaveCount(5)
    const barLayout = await bars.evaluateAll((elements) => elements.map((element) => {
      const fill = element.querySelector('span')
      const value = element.querySelector('strong')
      return {
        heightVariable: getComputedStyle(element).getPropertyValue('--bar-height').trim(),
        fillHeight: fill?.getBoundingClientRect().height || 0,
        valueBottom: value ? getComputedStyle(value).bottom : 'auto'
      }
    }))
    expect(barLayout.every((item) => item.heightVariable.endsWith('%')), JSON.stringify(barLayout)).toBe(true)
    expect(barLayout.every((item) => item.fillHeight > 0), JSON.stringify(barLayout)).toBe(true)
    expect(barLayout.every((item) => item.valueBottom !== 'auto'), JSON.stringify(barLayout)).toBe(true)
    const chartTooltip = page.getByTestId('dashboard-chart-tooltip')
    const barFills = page.locator('.asset-distribution-bar:has(strong) > span')
    await barFills.first().hover()
    await expect(chartTooltip).toBeVisible()
    await expect(chartTooltip).not.toHaveClass(/compact/)
    await expect(chartTooltip).toContainText('资产分布情况：')
    const donutSegments = page.locator('.donut-ring-segment')
    expect(await donutSegments.count()).toBeGreaterThan(0)
    const donutBox = await donutSegments.first().boundingBox()
    expect(donutBox).not.toBeNull()
    await page.mouse.move(donutBox!.x + donutBox!.width, donutBox!.y + donutBox!.height / 2)
    await expect(chartTooltip).toHaveClass(/compact/)
    await expect(chartTooltip).toContainText(/：\d+\(\d+%\)/)
    await expectPortalSelectOpensBelow(page, page.locator('.dashboard-card-filters .el-select').first())
  })

  test('首页总数排除已处置资产且状态占比保留处置记录', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '仪表盘状态口径在桌面项目执行')
    await openApp(page, '/', {
      assets: [
        { id: 'AST-ACTIVE-1', name: '领用设备', status: '领用', category: 'IT设备', owner: '张三', price: 5000 },
        { id: 'AST-ACTIVE-2', name: '空闲设备', status: '空闲', category: 'IT设备', owner: '未分配', price: 3000 }
      ],
      disposedCount: 1
    })

    const totalCard = page.locator('.stat-card').filter({ hasText: '资产总数' })
    await expect(totalCard.locator('.stat-value')).toHaveText('2')

    const statusCard = page.locator('.dashboard-status-card')
    await expect(statusCard.locator('.dashboard-donut strong')).toHaveText('3')
    const disposedLegend = statusCard.locator('.chart-legend > div').filter({ hasText: '已处置' })
    await expect(disposedLegend.locator('strong')).toHaveText('1')
    await expect(statusCard.locator('.donut-ring-disposed')).toHaveCount(1)
  })

  test('审批列表为空时首页待处理单据不显示审批中', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '首页统计卡片在桌面项目执行')
    await openApp(page, '/', { approvals: [] })

    const pendingCard = page.locator('.stat-card').filter({ hasText: '待处理单据' })
    await expect(pendingCard.locator('.stat-value')).toHaveText('0')
    await expect(pendingCard.getByText('审批中', { exact: true })).toHaveCount(0)

    await page.getByText('审批', { exact: true }).click()
    await expect(page.getByText('暂无审批单据。', { exact: true })).toBeVisible()
  })

  test('资产搜索、分页、详情和高级筛选可用', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '密集表格业务流在桌面项目执行，移动项目负责布局回归')
    await openApp(page, '/assets')
    for (const text of ['＋ 新增', '操作', '编辑', '导入/导出', '打印标签', '资产状态', '品牌', '型号', '设备序列号', '手机号', '电子邮箱', '领用日期', '购置方式', '使用信息']) {
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible()
    }
    const search = page.getByPlaceholder('搜索', { exact: true })
    await search.fill('测试笔记本')
    await expect(page.getByText('测试笔记本', { exact: true })).toBeVisible()
    await expect(page.getByText('测试显示器 2', { exact: true })).toHaveCount(0)
    await search.clear()
    await search.fill('AST-0002')
    const idleRow = page.locator('.asset-list-table tbody tr').filter({ hasText: 'AST-0002' })
    await expect(idleRow).toContainText('闲置 / -')
    await expect(idleRow).not.toContainText('历史使用部门')
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

    await page.locator('.asset-table-actions .link').filter({ hasText: '高级搜索' }).click()
    const advancedDrawer = page.locator('.asset-advanced-search-drawer:visible').last()
    await expect(advancedDrawer).toBeVisible()
    await expect(advancedDrawer.getByText('列表操作', { exact: true })).toBeVisible()
    await expect(advancedDrawer.getByRole('heading', { name: '高级搜索', exact: true })).toBeVisible()
    await expect(advancedDrawer.getByRole('button', { name: '高级搜索', exact: true })).toBeVisible()
    await expect(advancedDrawer.getByRole('button', { name: '自定义列', exact: true })).toBeVisible()
    for (const label of ['资产状态', '资产编码', '资产名称', '资产分类', '品牌/类型', '型号', '设备序列号', '使用人', '所属部门', '所在位置', '供应商', '风险状态', '资产标签']) {
      await expect(advancedDrawer.getByText(label, { exact: true })).toBeVisible()
    }
    const advancedLayout = await advancedDrawer.evaluate((element) => {
      const fields = Array.from(element.querySelectorAll('.advanced-filter-field')).slice(0, 2).map((field) => field.getBoundingClientRect())
      return { width: element.getBoundingClientRect().width, firstLeft: fields[0]?.left, secondLeft: fields[1]?.left, firstBottom: fields[0]?.bottom, secondTop: fields[1]?.top }
    })
    expect(advancedLayout.width).toBeGreaterThanOrEqual(500)
    expect(advancedLayout.width).toBeLessThanOrEqual(540)
    expect(Math.abs((advancedLayout.firstLeft || 0) - (advancedLayout.secondLeft || 0))).toBeLessThanOrEqual(1)
    expect(advancedLayout.secondTop || 0).toBeGreaterThanOrEqual(advancedLayout.firstBottom || 0)
    await advancedDrawer.getByRole('button', { name: '自定义列', exact: true }).click()
    await expect(advancedDrawer.getByRole('heading', { name: '自定义列', exact: true })).toBeVisible()
    await expect(advancedDrawer.getByText('表格密度', { exact: true })).toBeVisible()
    for (const label of ['品牌', '型号', '设备序列号']) {
      const option = advancedDrawer.locator('.custom-column-list label').filter({ hasText: label })
      await expect(option).toBeVisible()
      await expect(option.locator('input[type="checkbox"]')).toBeChecked()
    }
    await advancedDrawer.getByRole('button', { name: '高级搜索', exact: true }).click()
    const categorySelect = advancedDrawer.locator('.advanced-filter-field').filter({ hasText: '资产分类' }).locator('.el-select')
    await expectPortalSelectOpensBelow(page, categorySelect)
    await choosePortalSelectOption(page, categorySelect, '显示器')
    await expect(page.getByText('测试笔记本', { exact: true })).toBeVisible()
    await advancedDrawer.getByRole('button', { name: '查询', exact: true }).click()
    await expect(page.getByText('测试笔记本', { exact: true })).toHaveCount(0)
    await page.locator('.asset-table-actions .link').filter({ hasText: '高级搜索' }).click()
    await advancedDrawer.getByRole('button', { name: '重置', exact: true }).click()
    await expect(page.getByText('测试笔记本', { exact: true })).toBeVisible()
  })

  test('各资产单据板块使用各自的高级搜索字段', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '密集单据筛选在桌面项目执行')
    const cases = [
      { path: '/assets/inbound', labels: ['入库状态', '入库单号', '入库类型', '入库日期', '入库人', '采购人', '所属公司'] },
      { path: '/assets/receive-return', labels: ['领用状态', '领用单号', '领用日期', '经办人', '领用人', '领用后使用公司', '领用后使用部门', '领用后所在位置', '领用备注', '资产编码', '资产名称', '品牌', '型号', '设备序列号', '管理员', '所属/承租公司'] },
      { path: '/assets/borrow-return', labels: ['借用状态', '借用单号', '经办人', '借用人', '借用日期', '预计归还', '资产编码', '设备序列号', '借用人公司', '借用人部门', '工号', '手机号', '邮箱', '借用后位置'] }
    ]
    await installApiMocks(page)
    for (const item of cases) {
      await page.goto(item.path)
      await page.locator('.asset-table-actions .link').filter({ hasText: '高级搜索' }).click()
      const drawer = page.locator('.asset-advanced-search-drawer:visible').last()
      for (const label of item.labels) await expect(drawer.locator('.advanced-filter-field > span').filter({ hasText: label }).first()).toBeVisible()
      const statusSelect = drawer.locator('.advanced-filter-field').filter({ hasText: item.labels[0] }).locator('.el-select')
      await expect(statusSelect).toBeVisible()
      await expectPortalSelectOpensBelow(page, statusSelect)
      if (item.path === '/assets/borrow-return') {
        await expectPortalSelectOpensBelow(page, drawer.locator('.borrow-return-advanced-fields .advanced-filter-field:last-child .el-select'))
      }
      await drawer.locator('.advanced-filter-field').filter({ hasText: item.labels[1] }).locator('input').fill('NO-MATCH')
      await drawer.getByRole('button', { name: '查询', exact: true }).click()
      await expect(page.locator('.asset-list-table .empty-row')).toBeVisible()
      await page.locator('.asset-table-actions .link').filter({ hasText: '高级搜索' }).click()
      await drawer.getByRole('button', { name: '重置', exact: true }).click()
      await expect(page.locator('.asset-list-table .empty-row')).toHaveCount(0)
      await page.keyboard.press('Escape')
    }
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
    await expectPortalSelectOpensBelow(page, dialog.locator('.el-form-item').filter({ hasText: '使用公司' }).first().locator('.el-select'))
    const administratorField = dialog.locator('.el-form-item').filter({ hasText: '管理员' }).first()
    await administratorField.locator('.el-select').click()
    await expect(page.getByRole('option', { name: '资产管理员甲', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: '资产管理员乙', exact: true })).toBeVisible()
    await page.getByRole('option', { name: '资产管理员乙', exact: true }).click()
    const personField = dialog.locator('.el-form-item').filter({ hasText: '人员姓名' })
    const departmentField = dialog.locator('.el-form-item').filter({ hasText: '使用部门' })
    const personInput = personField.locator('input')
    const personWrapper = personField.locator('.el-input__wrapper')
    const neutralShadow = await personWrapper.evaluate((element) => getComputedStyle(element).boxShadow)
    await expect(departmentField.locator('input')).toHaveValue('')
    await expect(departmentField.locator('.el-select__wrapper')).toHaveClass(/is-disabled/)
    await departmentField.locator('.el-select__wrapper').click({ force: true })
    await expect(page.getByRole('option', { name: '研发部', exact: true })).toHaveCount(0)
    await personInput.click()
    await page.waitForTimeout(400)
    await expect(page.locator('.el-autocomplete-suggestion li')).toHaveCount(0)
    expect(state.requests.some((item) => item.path.startsWith('/api/ecp/directory/users'))).toBe(false)
    await expect(personWrapper).toHaveCSS('box-shadow', neutralShadow)
    await personInput.fill('张三')
    await expect(page.getByRole('option', { name: /张三/ })).toBeVisible()
    await page.getByRole('option', { name: /张三/ }).click()
    await expect(personInput).toHaveValue('张三')
    await expect(departmentField.locator('.el-select__wrapper')).not.toHaveClass(/is-disabled/)
    await expect(departmentField.getByText('研发部', { exact: true })).toBeVisible()
    expect(state.requests.some((item) => item.path.startsWith('/api/ecp/directory/users?') && item.path.includes('query=%E5%BC%A0%E4%B8%89'))).toBe(true)
    await departmentField.locator('.el-select').click()
    await expect(departmentField.locator('.el-select__input')).toHaveCSS('box-shadow', 'none')
    await page.keyboard.press('Escape')
    const alignment = await dialog.evaluate((element) => {
      const items = Array.from(element.querySelectorAll('.asset-form-grid .el-form-item'))
      const offsets = items.map((item) => {
        const label = item.querySelector('.el-form-item__label')?.getBoundingClientRect()
        const control = item.querySelector('.el-input__wrapper, .el-select__wrapper')?.getBoundingClientRect()
        return label && control ? Math.abs((label.top + label.height / 2) - (control.top + control.height / 2)) : 0
      })
      const overflowingLabels = items.filter((item) => {
        const label = item.querySelector<HTMLElement>('.el-form-item__label')
        return Boolean(label && label.scrollWidth > label.clientWidth + 1)
      }).length
      return { maxOffset: Math.max(0, ...offsets), overflowingLabels }
    })
    expect(alignment.maxOffset, JSON.stringify(alignment)).toBeLessThanOrEqual(1)
    expect(alignment.overflowingLabels, JSON.stringify(alignment)).toBe(0)
    const columnWidths = await dialog.evaluate((element) => {
      const visible = (node: Element): boolean => {
        const rect = node.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      }
      const fields = Array.from(element.querySelectorAll('.asset-form-grid .el-form-item')).filter(visible)
      const labels = fields.map((field) => field.querySelector<HTMLElement>('.el-form-item__label')?.getBoundingClientRect().width || 0)
      const controls = fields.map((field) => field.querySelector<HTMLElement>('.el-input, .el-select, .el-autocomplete, .el-date-editor, .asset-unit-control')?.getBoundingClientRect().width || 0)
      return {
        labelSpread: Math.max(...labels) - Math.min(...labels),
        controlSpread: Math.max(...controls) - Math.min(...controls),
        labels,
        controls
      }
    })
    expect(columnWidths.labelSpread, JSON.stringify(columnWidths)).toBeLessThanOrEqual(1)
    expect(columnWidths.controlSpread, JSON.stringify(columnWidths)).toBeLessThanOrEqual(1)
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
    expect(createRequest?.body).toMatchObject({ item: { name: '新测试设备', category: 'IT设备', type: 'IT设备', custodian: '资产管理员乙', brand: '测试品牌', condition: '正常', location: '杭州仓库', purchaseMethod: '采购' } })
  })

  test('新增资产的分类和位置树默认收起并可按需展开', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '表单业务流在桌面项目执行')
    await openApp(page, '/assets/inbound', {
      categoryTree: [{ id: 'cat-it', code: '01', name: 'IT设备', enabled: true, children: [{ id: 'cat-laptop', code: '0101', name: '笔记本电脑', enabled: true, unit: '台', usefulLife: '36', children: [] }] }],
      locationTree: [{ id: 'loc-hz', code: 'HZ', name: '杭州公司', enabled: true, children: [{ id: 'loc-store', code: 'STORE', name: '封存仓库', enabled: true, children: [] }] }]
    })
    await page.getByRole('button', { name: /^新增/ }).click()
    await page.getByRole('menuitem', { name: '新增资产', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新增资产' })

    const categoryField = dialog.locator('.el-form-item').filter({ hasText: '资产分类' })
    await categoryField.locator('.el-select').click()
    let tree = page.locator('.el-select-dropdown:visible .el-tree').last()
    await expect(tree.getByText('IT设备', { exact: true })).toBeVisible()
    await expect(tree.getByText('笔记本电脑', { exact: true })).not.toBeVisible()
    await tree.locator('.el-tree-node__content').filter({ hasText: 'IT设备' }).first().locator('.el-tree-node__expand-icon').click()
    await expect(tree.getByText('笔记本电脑', { exact: true })).toBeVisible()
    await tree.getByText('笔记本电脑', { exact: true }).click()
    await expect(categoryField.locator('.el-select__selected-item').last()).toContainText('笔记本电脑')

    const locationField = dialog.locator('.el-form-item').filter({ hasText: '所在位置' })
    await locationField.locator('.el-select').click()
    tree = page.locator('.el-select-dropdown:visible .el-tree').last()
    await expect(tree.getByText('杭州公司', { exact: true })).toBeVisible()
    await expect(tree.getByText('封存仓库', { exact: true })).not.toBeVisible()
    await tree.locator('.el-tree-node__content').filter({ hasText: '杭州公司' }).first().locator('.el-tree-node__expand-icon').click()
    await expect(tree.getByText('封存仓库', { exact: true })).toBeVisible()
    await tree.getByText('封存仓库', { exact: true }).click()
    await expect(locationField.locator('.el-select__selected-item').last()).toContainText('封存仓库')
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

  test('资产导入校验分类树中的父级分类并拦截未知分类', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '资产导入校验在桌面项目执行')
    const categoryTree = [{
      id: 'cat-mobile', code: '03', name: '移动设备', enabled: true, children: [{
        id: 'cat-phone', code: '0303', name: '手机', enabled: true, children: [
          { id: 'cat-iphone', code: '030303', name: '苹果手机', enabled: true, children: [] },
          { id: 'cat-android', code: '030301', name: '安卓手机', enabled: true, children: [] }
        ]
      }]
    }]
    const workbook = (category: string): Buffer => Buffer.from(`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="资产导入"><Table><Row><Cell><Data ss:Type="String">资产名称</Data></Cell><Cell><Data ss:Type="String">资产分类</Data></Cell><Cell><Data ss:Type="String">品牌</Data></Cell><Cell><Data ss:Type="String">购置方式</Data></Cell><Cell><Data ss:Type="String">所属/承租公司</Data></Cell><Cell><Data ss:Type="String">购置/起租日期</Data></Cell><Cell><Data ss:Type="String">所在位置</Data></Cell><Cell><Data ss:Type="String">使用公司</Data></Cell></Row><Row><Cell><Data ss:Type="String">测试手机</Data></Cell><Cell><Data ss:Type="String">${category}</Data></Cell><Cell><Data ss:Type="String">测试品牌</Data></Cell><Cell><Data ss:Type="String">采购</Data></Cell><Cell><Data ss:Type="String">示例公司</Data></Cell><Cell><Data ss:Type="String">2026-08-20</Data></Cell><Cell><Data ss:Type="String">杭州仓库</Data></Cell><Cell><Data ss:Type="String">示例公司</Data></Cell></Row></Table></Worksheet></Workbook>`)

    await openApp(page, '/assets', { categoryTree })
    await page.getByRole('button', { name: '导入/导出', exact: true }).click()
    await page.getByRole('menuitem', { name: '资产导入', exact: true }).click()
    const importDialog = page.getByRole('dialog', { name: '资产导入' })
    const input = importDialog.locator('input[type="file"]')

    await input.setInputFiles({ name: '手机分类.xls', mimeType: 'application/vnd.ms-excel', buffer: workbook('手机') })
    await expect(importDialog.locator('.asset-import-status')).toHaveText('可导入 1 条，错误 0 条。')
    await expect(importDialog.getByText('可导入', { exact: true })).toBeVisible()

    await input.setInputFiles({ name: '未知分类.xls', mimeType: 'application/vnd.ms-excel', buffer: workbook('不存在的分类') })
    await expect(importDialog.locator('.asset-import-status')).toContainText('可导入 0 条，错误 1 条。')
    await expect(importDialog.locator('.standard-import-error')).toHaveText('资产分类“不存在的分类”不存在')
  })

  test('资产退还或编辑成功后回到未筛选的资产主列表', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '资产主列表回退在桌面项目执行')
    const contextAssets = [
      {
        id: 'AST-CONTEXT-RETURN', name: '袁其博的笔记本', status: '领用', category: 'IT设备', type: '设备',
        owner: '袁其博', ownerSubject: 'E2E-YQB', department: '研发部', company: '示例公司', ownerCompany: '示例公司',
        location: '杭州仓库', custodian: '资产管理员', brand: '测试品牌', model: 'T14', sn: 'CONTEXT-RETURN-SN', assetTag: '',
        supplier: '测试供应商', price: 5000, purchaseDate: '2026-07-01', warrantyDate: '2029-07-01', purchaseMethod: '采购', condition: '正常', note: ''
      },
      {
        id: 'AST-CONTEXT-OTHER', name: '其他空闲显示器', status: '空闲', category: '显示器', type: '设备',
        owner: '未分配', ownerSubject: '', department: '', company: '示例公司', ownerCompany: '示例公司',
        location: '杭州仓库', custodian: '资产管理员', brand: '测试品牌', model: 'U27', sn: 'CONTEXT-OTHER-SN', assetTag: '',
        supplier: '测试供应商', price: 3000, purchaseDate: '2026-07-01', warrantyDate: '2029-07-01', purchaseMethod: '采购', condition: '正常', note: ''
      }
    ]
    await openApp(page, '/assets', { assets: contextAssets })

    const search = page.getByRole('searchbox', { name: '搜索资产', exact: true })
    const expectMainList = async (): Promise<void> => {
      await expect(page).toHaveURL('/assets')
      await expect(search).toHaveValue('')
      await expect(page.getByText('共 2 条', { exact: true })).toBeVisible()
      await expect(page.getByText('其他空闲显示器', { exact: true })).toBeVisible()
    }

    await search.fill('袁其博')
    await expect(page.getByText('袁其博的笔记本', { exact: true })).toBeVisible()
    await page.getByLabel('选择AST-CONTEXT-RETURN').check()
    await page.getByRole('button', { name: '操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '领用退还', exact: true }).click()
    const returnDialog = page.getByRole('dialog', { name: '新增退库单' })
    await returnDialog.getByRole('button', { name: '保存并提交', exact: true }).click()
    await expect(returnDialog).toBeHidden()
    await expectMainList()

    await search.fill('袁其博')
    await page.getByLabel('选择AST-CONTEXT-RETURN').check()
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await page.getByRole('menuitem', { name: '修改', exact: true }).click()
    const editDialog = page.getByRole('dialog', { name: '编辑资产' })
    await editDialog.getByRole('button', { name: '确定', exact: true }).click()
    await expect(editDialog).toBeHidden()
    await expectMainList()
  })

  test('领用退库新增入口的位置选择默认收起且员工申领不提供新增', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '密集流程表单在桌面项目执行')
    await openApp(page, '/assets/receive-return')

    for (const entry of [
      { tab: '领用', title: '新增领用单', label: '领用后位置', placeholder: '请选择领用后位置' },
      { tab: '退库', title: '新增退库单', label: '退库后位置', placeholder: '请选择退库后位置' }
    ]) {
      await page.locator('.receive-return-tab').filter({ hasText: entry.tab }).click()
      await page.getByRole('button', { name: '＋ 新增', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: entry.title })
      await expect(dialog).toBeVisible()
      const locationSelect = dialog.locator('.el-form-item').filter({ hasText: entry.label }).locator('.el-select')
      const combobox = locationSelect.getByRole('combobox')
      await expect(locationSelect.locator('.el-select__placeholder')).toHaveText(entry.placeholder)
      await expect(combobox).toHaveAttribute('aria-expanded', 'false')
      await expect(page.locator('.el-select-dropdown:visible')).toHaveCount(0)
      await locationSelect.click()
      await expect(combobox).toHaveAttribute('aria-expanded', 'true')
      await expect(page.locator('.el-select-dropdown:visible .el-tree-node.is-expanded')).toHaveCount(0)
      await locationSelect.click()
      await expect(combobox).toHaveAttribute('aria-expanded', 'false')
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
      await expect(dialog).toBeHidden()
    }

    await page.locator('.receive-return-tab').filter({ hasText: '员工申领' }).click()
    await expect(page.locator('.receive-return-toolbar').getByRole('button', { name: '＋ 新增', exact: true })).toHaveCount(0)
  })

  test('领用与借用表单保留资产明细和逐项日期', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '密集流程表单在桌面项目执行')
    const state = await openApp(page, '/assets/receive-return')
    await page.getByRole('button', { name: '＋ 新增', exact: true }).click()
    const receiveDialog = page.getByRole('dialog', { name: '新增领用单' })
    await expect(receiveDialog).toBeVisible()
    await expect(page.getByRole('dialog', { name: '选择领用资产' })).toHaveCount(0)
    await receiveDialog.getByRole('button', { name: '选择资产', exact: true }).click()
    let picker = page.getByRole('dialog', { name: '选择领用资产' })
    await picker.locator('tbody tr').filter({ hasText: 'AST-0002' }).locator('.el-checkbox').click()
    await picker.getByRole('button', { name: '下一步', exact: true }).click()
    for (const label of ['领用人', '所属公司', '所在部门', '领用日期', '领用后位置', '经办人', '领用备注']) await expect(receiveDialog.getByText(label, { exact: false }).first()).toBeVisible()
    await expect(receiveDialog.getByText('AST-0002', { exact: true })).toBeVisible()
    await expectUnifiedControlFrames(receiveDialog)
    const receivePerson = receiveDialog.locator('.el-form-item').filter({ hasText: '领用人' })
    const receiveDepartment = receiveDialog.locator('.el-form-item').filter({ hasText: '所在部门' }).locator('input')
    await expect(receiveDepartment).toHaveValue('')
    await expectNeutralAutocompleteFocus(receivePerson)
    await receivePerson.locator('input').fill('张三')
    await page.locator('.el-autocomplete-suggestion li').filter({ hasText: '张三' }).first().click()
    await expect(receiveDepartment).toHaveValue('研发部')
    await receiveDialog.locator('.el-form-item').filter({ hasText: '领用后位置' }).locator('.el-select').click()
    await page.getByRole('option', { name: '杭州仓库', exact: true }).click()
    await receiveDialog.getByRole('button', { name: '保存并提交', exact: true }).click()
    await expect(receiveDialog).toBeHidden()
    const receiveRequest = state.requests.find((item) => item.method === 'POST' && item.path === '/api/assets/commands/receive')
    expect(receiveRequest?.body).toMatchObject({ assetIds: ['AST-0002'], fields: { receiver: '张三', receiverSubject: 'sub-1', company: '示例公司', department: '研发部', location: '杭州仓库' } })

    await page.goto('/assets/borrow-return')
    await page.getByRole('button', { name: '＋ 新增', exact: true }).click()
    const borrowDialog = page.getByRole('dialog', { name: '新增借用单' })
    await expect(borrowDialog).toBeVisible()
    await expect(page.getByRole('dialog', { name: '选择借用资产' })).toHaveCount(0)
    await borrowDialog.getByRole('button', { name: '选择资产', exact: true }).click()
    picker = page.getByRole('dialog', { name: '选择借用资产' })
    await picker.locator('tbody tr').filter({ hasText: 'AST-0002' }).locator('.el-checkbox').click()
    await picker.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(borrowDialog.getByText('资产详情', { exact: true })).toBeVisible()
    await expect(borrowDialog.getByText('AST-0002', { exact: true })).toBeVisible()
    await expectUnifiedControlFrames(borrowDialog)
    await expect(borrowDialog.locator('.asset-flow-table .el-date-editor')).toHaveCount(1)
    const detailDate = borrowDialog.locator('.asset-flow-table .asset-flow-date-input')
    const detailDateFrame = await detailDate.evaluate((element) => {
      const wrapper = element.querySelector('.el-input__wrapper')
      return {
        width: Math.round(element.getBoundingClientRect().width),
        height: Math.round(element.getBoundingClientRect().height),
        outerBorder: getComputedStyle(element).borderTopWidth,
        outerShadow: getComputedStyle(element).boxShadow,
        wrapperHeight: wrapper ? Math.round(wrapper.getBoundingClientRect().height) : 0
      }
    })
    expect(detailDateFrame, JSON.stringify(detailDateFrame)).toMatchObject({ width: 132, height: 30, outerBorder: '0px', outerShadow: 'none', wrapperHeight: 30 })
    const borrowPerson = borrowDialog.locator('.el-form-item').filter({ hasText: '借用人' })
    await expect(borrowDialog.locator('.el-form-item').filter({ hasText: '所在部门' }).locator('input')).toHaveValue('')
    await expectNeutralAutocompleteFocus(borrowPerson)
    await borrowDialog.getByRole('button', { name: '取消', exact: true }).click()

    await page.locator('.receive-return-toolbar').getByRole('button', { name: '打印', exact: true }).click()
    await page.getByRole('menuitem', { name: '打印借用归还单', exact: true }).click()
    await expect(page.locator('.el-message').filter({ hasText: '已生成借用归还单打印预览' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: '打印借用归还单' })).toHaveCount(0)

    await page.locator('.receive-return-tab').filter({ hasText: '归还' }).click()
    await page.getByRole('button', { name: '＋ 新增', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '新增借用单' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: '选择借用资产' })).toHaveCount(0)
    await page.getByRole('dialog', { name: '新增借用单' }).getByRole('button', { name: '取消', exact: true }).click()

    await page.goto('/assets/receive-return')
    await page.locator('.receive-return-tab').filter({ hasText: '交接' }).click()
    await page.getByRole('button', { name: '＋ 新增', exact: true }).click()
    const handoverDialog = page.getByRole('dialog', { name: '新增交接单' })
    await expect(handoverDialog).toBeVisible()
    await expect(page.getByRole('dialog', { name: '选择交接资产' })).toHaveCount(0)
    await handoverDialog.getByRole('button', { name: '选择资产', exact: true }).click()
    picker = page.getByRole('dialog', { name: '选择交接资产' })
    await picker.locator('tbody tr').filter({ hasText: 'AST-0001' }).locator('.el-checkbox').click()
    await picker.getByRole('button', { name: '下一步', exact: true }).click()
    const handoverPerson = handoverDialog.locator('.el-form-item').filter({ hasText: '接收人' })
    const handoverDepartment = handoverDialog.locator('.el-form-item').filter({ hasText: '接收部门' })
    await expect(handoverDepartment.locator('input')).toHaveValue('')
    await expect(handoverDepartment).not.toContainText('研发部')
    await expect(handoverDepartment.locator('.el-select__wrapper')).toHaveClass(/is-disabled/)
    await expectNeutralAutocompleteFocus(handoverPerson)
    await handoverPerson.locator('input').fill('张三')
    await page.locator('.el-autocomplete-suggestion li').filter({ hasText: '张三' }).first().click()
    await expect(handoverDepartment).toContainText('研发部')
    await expect(handoverDepartment.locator('.el-select__wrapper')).not.toHaveClass(/is-disabled/)
    await handoverDialog.getByRole('button', { name: '取消', exact: true }).click()

    await page.locator('.receive-return-tab').filter({ hasText: '退库' }).click()
    await page.getByRole('button', { name: '＋ 新增', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '新增退库单' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: '选择退库资产' })).toHaveCount(0)
    await page.getByRole('dialog', { name: '新增退库单' }).getByRole('button', { name: '取消', exact: true }).click()

    await page.locator('.receive-return-tab').filter({ hasText: '员工申领' }).click()
    await expect(page.locator('.receive-return-toolbar').getByRole('button', { name: '＋ 新增', exact: true })).toHaveCount(0)
  })

  test('入库单打印恢复资产信息预览并与标签打印区分', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '入库打印预览在桌面项目执行')
    await openApp(page, '/assets/inbound')
    await page.getByRole('button', { name: '打印', exact: true }).click()
    await page.getByRole('menuitem', { name: '打印入库单', exact: true }).click()
    const orderDialog = page.getByRole('dialog', { name: '打印入库单' })
    await expect(orderDialog.getByText('入库单打印预览', { exact: true })).toBeVisible()
    await expect(orderDialog.getByText('入库单数', { exact: true })).toBeVisible()
    await expect(orderDialog.getByText('RK-001', { exact: true })).toBeVisible()
    await expect(orderDialog.getByText('AST-0001', { exact: true })).toBeVisible()
    await expect(orderDialog.locator('svg.asset-label-qr')).toHaveCount(0)
    await orderDialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(orderDialog).toBeHidden()

    await page.locator('.asset-inbound-toolbar').getByRole('button', { name: '打印', exact: true }).click()
    await page.getByRole('menuitem', { name: '打印资产标签', exact: true }).click()
    const labelDialog = page.getByRole('dialog', { name: '打印资产标签' })
    await expect(labelDialog.locator('svg.asset-label-qr')).toHaveCount(1)
    await expect(labelDialog.getByText('入库单打印预览', { exact: true })).toHaveCount(0)
  })

  test('资产标签打印保持迁移前模板、分页和二维码', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '标签物理尺寸与打印预览在桌面项目执行')
    await openApp(page, '/assets')
    await page.getByRole('checkbox', { name: '选择AST-0001' }).check()
    await page.getByRole('button', { name: '打印标签', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '打印标签' })
    await expect(dialog.locator('.asset-label-print-workspace.direct-label-print')).toBeVisible()
    await expect(dialog.getByRole('button', { name: '打 印', exact: true })).toBeVisible()
    await expect(dialog.getByText('共 1 张 / 1 页', { exact: true })).toBeVisible()
    await expect(dialog.locator('.asset-label-sheet')).toHaveCount(1)
    await expect(dialog.locator('.asset-print-label')).toHaveCount(1)
    const qr = dialog.locator('svg.asset-label-qr')
    await expect(qr).toHaveCount(1)
    await expect(qr.locator('path')).toHaveAttribute('d', /M\d/)
    const panel = dialog.locator('.el-dialog.asset-label-print-dialog')
    await expect(panel).toHaveCount(1)
    await expect(panel).toHaveCSS('background-color', 'rgb(17, 17, 17)')
  })

  test('资产各主列表支持拖拽调整列宽并持久化', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '列宽拖拽在桌面项目执行')
    await openApp(page, '/assets')

    const handle = page.getByRole('button', { name: '调整资产状态列宽' })
    await expect(handle).toBeVisible()
    const header = handle.locator('xpath=..')
    const before = await header.evaluate((element) => element.getBoundingClientRect().width)
    const box = await handle.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width / 2 + 72, box!.y + box!.height / 2)
    await page.mouse.up()
    const resized = await header.evaluate((element) => element.getBoundingClientRect().width)
    expect(resized).toBeGreaterThan(before + 50)
    await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('asset-table-column-widths:assets:list')))).toBe(true)

    await page.reload()
    const persisted = await page.getByRole('button', { name: '调整资产状态列宽' }).locator('xpath=..').evaluate((element) => element.getBoundingClientRect().width)
    expect(persisted).toBeGreaterThan(before + 50)

    for (const [path, selector] of [
      ['/assets/inbound', '.inbound-order-table'],
      ['/assets/receive-return', '.receive-return-table'],
      ['/assets/borrow-return', '.borrow-return-table'],
      ['/assets/stocktake', '.stocktake-view table'],
      ['/assets/settings/locations', '.location-settings-table'],
      ['/assets/settings/categories', '.asset-category-settings-table']
    ] as const) {
      await page.goto(path)
      await expect(page.locator(`${selector} .column-resize-handle`).first()).toBeVisible()
    }
  })

  test('审批搜索与处理弹窗保持可操作', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '审批业务流在桌面项目执行')
    const state = await openApp(page, '/requests')
    const approvalTable = page.locator('.approval-manager-table')
    await expect(approvalTable.locator('thead')).toContainText('申请单号')
    await expect(approvalTable.locator('thead')).toContainText('所属公司')
    await expect(approvalTable.locator('thead')).toContainText('所在部门')
    await expect(approvalTable.locator('thead')).not.toContainText('关联物品')
    await expect(page.getByRole('button', { name: '调整申请单号列宽' })).toBeVisible()

    const initialRow = approvalTable.locator('tbody tr').filter({ hasText: 'REQ-001' })
    const whiteSpaceValues = await initialRow.evaluate((element) => Array.from((element as HTMLTableRowElement).cells)
      .map((cell) => getComputedStyle(cell).whiteSpace))
    expect(whiteSpaceValues.every((value) => value === 'nowrap')).toBe(true)
    const initialRowBox = await initialRow.boundingBox()
    expect(initialRowBox).not.toBeNull()
    expect(initialRowBox?.height || 0).toBeLessThanOrEqual(44)
    const actionCell = initialRow.locator('.approval-actions-cell')
    await expect(actionCell).toBeVisible()
    await expect(actionCell).toHaveCSS('position', 'sticky')
    await expect(actionCell).toHaveCSS('right', '0px')
    const tableWrap = page.locator('.approval-table-wrap')
    await tableWrap.evaluate((element) => { element.scrollLeft = element.scrollWidth })
    const [wrapBox, actionBox] = await Promise.all([tableWrap.boundingBox(), actionCell.boundingBox()])
    expect(wrapBox).not.toBeNull()
    expect(actionBox).not.toBeNull()
    expect(Math.abs(((wrapBox?.x || 0) + (wrapBox?.width || 0)) - ((actionBox?.x || 0) + (actionBox?.width || 0)))).toBeLessThanOrEqual(2)
    await tableWrap.evaluate((element) => { element.scrollLeft = 0 })

    await initialRow.getByRole('button', { name: 'REQ-001', exact: true }).click()
    const detailDialog = page.getByRole('dialog', { name: '资产领用' })
    await expect(detailDialog).toContainText('申请信息')
    await expect(detailDialog).toContainText('申请明细')
    await expect(detailDialog).toContainText('审批信息')
    await expect(detailDialog).toContainText('AST-0001')
    await expect(detailDialog).toContainText('测试品牌')
    await expect(detailDialog).toContainText('M-1')
    await expect(detailDialog).toContainText('SN-1')
    await expect(detailDialog).toContainText('示例公司')
    await expect(detailDialog).toContainText('研发部')
    await expect(detailDialog).toContainText('杭州仓库')
    const drawerBox = await detailDialog.boundingBox()
    expect(drawerBox).not.toBeNull()
    expect(Math.abs((page.viewportSize()?.width || 0) - ((drawerBox?.x || 0) + (drawerBox?.width || 0)))).toBeLessThanOrEqual(1)
    await detailDialog.getByRole('button', { name: '关闭', exact: true }).click()

    await page.getByRole('button', { name: '已完成', exact: true }).click()
    await expect(page.locator('.approval-workspace tbody')).toContainText('REQ-002')
    await expect(page.locator('.approval-workspace tbody')).not.toContainText('REQ-001')
    await page.getByRole('button', { name: '待处理', exact: true }).click()
    await page.getByPlaceholder('搜索申请编号、类型、申请人或资产').fill('REQ-001')
    const row = page.locator('.approval-workspace tbody tr').filter({ hasText: 'REQ-001' })
    await row.getByRole('button', { name: '同意', exact: true }).click()
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
    await expect(page.locator('.stocktake-view .hero')).toHaveCount(0)
    await expect(page.locator('.stocktake-view .toolbar')).toContainText('新建盘点')
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
    await expect(page.locator('.approvals-view .hero')).toHaveCount(0)
    await expect(page.locator('.approvals-view .approval-workspace-tabs')).toContainText('待处理')
    await expect(page.locator('.approvals-view .approval-toolbar-actions')).toContainText('刷新')
    await expect(page.getByRole('button', { name: '新建申请', exact: true })).toHaveCount(0)
    await expect(page.locator('.approvals-view .approval-workspace table')).toContainText('当前节点')

    await page.goto('/system/self-service')
    await expect(page.locator('.self-service-panel')).toContainText('签字设置')
    await expect(page.locator('.self-service-config-panel')).toContainText('自助资产领用')

    await page.goto('/system/integrations')
    await expect(page.locator('.account-management-panel, .system-content .panel').first()).toContainText('系统对接')

    await page.goto('/system/forms')
    await expect(page.locator('.system-content .panel')).toContainText('表单管理')
  })

  test('主要业务工作区铺满目录内容区并在内部滚动', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '桌面工作区高度在桌面项目执行')
    await installApiMocks(page)

    for (const [path, selector] of [
      ['/assets', '.asset-list-page'],
      ['/assets/inbound', '.asset-inbound-ledger'],
      ['/assets/receive-return', '.receive-return-ledger'],
      ['/assets/borrow-return', '.receive-return-ledger'],
      ['/assets/stocktake', '.stocktake-view'],
      ['/assets/settings/locations', '.location-settings-shell'],
      ['/assets/settings/categories', '.asset-category-settings-shell'],
      ['/assets/settings/code-rules', '.asset-code-rule-page'],
      ['/assets/settings/label-templates', '.asset-label-template-page'],
      ['/requests', '.approvals-view'],
      ['/system/employees', '.employee-directory-feature'],
      ['/system/integrations', '.standard-system-content > .system-content'],
      ['/system/forms', '.standard-system-content > .system-content']
    ] as const) {
      await page.goto(path)
      const workspace = page.locator(selector).first()
      await expect(workspace).toBeVisible()
      const bottomGap = await workspace.evaluate((element) => {
        const content = element.closest('.standard-system-content, .standard-main-content, .page')
        if (!(content instanceof HTMLElement)) throw new Error('缺少标准目录内容区')
        return Math.round(content.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom)
      })
      expect(bottomGap, path).toBeGreaterThanOrEqual(0)
      expect(bottomGap, path).toBeLessThanOrEqual(26)
    }

    await page.goto('/assets')
    await expect(page.locator('.asset-table-scroll')).toHaveCSS('max-height', 'none')
    await expect(page.locator('.asset-table-scroll')).toHaveCSS('overflow-y', 'auto')

    for (const path of ['/assets', '/assets/inbound']) {
      await page.goto(path)
      const pageSizeSelect = page.locator('.asset-list-pagination .asset-page-size-select').first()
      const selectBox = await pageSizeSelect.boundingBox()
      expect(selectBox, path).not.toBeNull()
      await pageSizeSelect.click()
      const popper = page.locator('.el-select__popper:visible').last()
      await expect(popper).toBeVisible()
      const popperBox = await popper.boundingBox()
      expect(popperBox, path).not.toBeNull()
      expect(popperBox!.y + popperBox!.height, path).toBeLessThanOrEqual(selectBox!.y + 1)
      const lastOptionBox = await popper.getByRole('option', { name: '50 条/页' }).boundingBox()
      expect(lastOptionBox, path).not.toBeNull()
      expect(lastOptionBox!.y, path).toBeGreaterThanOrEqual(popperBox!.y)
      expect(lastOptionBox!.y + lastOptionBox!.height, path).toBeLessThanOrEqual(popperBox!.y + popperBox!.height)
      await page.keyboard.press('Escape')
    }
  })

  test('资产分类树默认收起且超出可视区后可独立滚动', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '分类树的桌面滚动区域在桌面项目执行')
    const categoryTree = Array.from({ length: 32 }, (_, index) => ({
      id: `cat-${index}`,
      code: String(index + 1).padStart(2, '0'),
      name: index === 0 ? 'IT设备' : `分类${index + 1}`,
      enabled: true,
      children: index === 0 ? [{ id: 'cat-child', code: '0101', name: '笔记本电脑', enabled: true, children: [] }] : []
    }))
    await openApp(page, '/assets/settings/categories', { categoryTree })

    const tree = page.locator('.asset-category-tree-list')
    await expect(tree.locator('.el-tree-node.is-expanded')).toHaveCount(0)
    const overflow = await tree.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY
    }))
    expect(overflow.overflowY).toBe('auto')
    expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight)

    const firstNode = tree.locator('.el-tree-node').first()
    await firstNode.locator(':scope > .el-tree-node__content .el-tree-node__expand-icon').click()
    await expect(firstNode).toHaveClass(/is-expanded/)
    await firstNode.locator(':scope > .el-tree-node__content .el-tree-node__expand-icon').click()
    await expect(firstNode).not.toHaveClass(/is-expanded/)

    const tableWrap = page.locator('.asset-category-table-wrap')
    await tableWrap.evaluate((element) => { element.scrollTop = 80 })
    const headerLayer = await tableWrap.locator('thead th').first().evaluate((element) => {
      const style = getComputedStyle(element)
      return { position: style.position, top: style.top, zIndex: Number(style.zIndex), backgroundColor: style.backgroundColor }
    })
    expect(headerLayer).toMatchObject({ position: 'sticky', top: '0px' })
    expect(headerLayer.zIndex).toBeGreaterThanOrEqual(3)
    expect(headerLayer.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  })

  test('资产分类编码开关可保存状态并提交真实目录节点', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '资产分类设置在桌面项目执行')
    const state = await openApp(page, '/assets/settings/categories')
    const toggle = page.getByRole('button', { name: '关闭IT设备分类编码', exact: true })

    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await toggle.click()
    const disabledToggle = page.getByRole('button', { name: '开启IT设备分类编码', exact: true })
    await expect(disabledToggle).toHaveAttribute('aria-pressed', 'false')
    await expect(disabledToggle.locator('.asset-code-switch')).toHaveClass(/off/)
    await expect(page.getByText('已关闭“IT设备”的资产编码', { exact: true })).toBeVisible()

    const request = [...state.requests].reverse().find((item) => item.method === 'PUT' && item.path === '/api/config/catalog/categories')
    expect(request?.body).toMatchObject({ value: [{ id: 'cat-it', name: 'IT设备', enabled: false }] })
  })

  test('盘点与资产设置表单保留迁移前结构和层级逻辑', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), '密集设置表单在桌面项目执行')
    const state = await openApp(page, '/assets/stocktake')
    const stocktakeToolbar = page.locator('.stocktake-toolbar')
    await expect(stocktakeToolbar.locator(':scope > *')).toHaveCount(1)
    await expect(page.getByPlaceholder('盘点任务名称')).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: '盘点状态' })).toHaveCount(0)
    await expect(page.locator('.stocktake-view .table-wrap th').first()).toHaveCSS('font-size', '12px')

    await page.getByRole('button', { name: '新建盘点', exact: true }).click()
    const stocktakeDialog = page.getByRole('dialog', { name: '新建盘点' })
    await expect(stocktakeDialog.locator('.business-form')).toHaveCSS('grid-template-columns', /.+ .+/)
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
    await choosePortalSelectOption(page, locationDialog.locator('.location-form-row').filter({ hasText: '上级位置' }).locator('.el-select'), '杭州仓库')
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
    await choosePortalSelectOption(page, categoryDialog.locator('.location-form-row').filter({ hasText: '上级分类' }).locator('.el-select'), 'IT设备')
    await categoryDialog.locator('.location-form-row').filter({ hasText: '使用期限' }).locator('input').fill('48')
    await categoryDialog.getByRole('button', { name: '确定', exact: true }).click()
    await expect(categoryDialog).toBeHidden()
    const categoryRequest = [...state.requests].reverse().find((item) => item.method === 'PUT' && item.path === '/api/config/catalog/categories')
    expect(categoryRequest?.body).toMatchObject({ value: [{ id: 'cat-it', children: [{ name: '笔记本电脑', code: '0101', usefulLife: '48', unit: '台' }] }] })

    await page.goto('/assets/settings/label-templates')
    const labelPage = page.locator('.asset-label-template-page')
    await expect(labelPage.locator('.asset-label-template-left')).toBeVisible()
    await expect(labelPage.locator('.asset-label-template-right')).toBeVisible()
    await expect(labelPage.locator('.asset-label-template-card')).toHaveCount(3)
    await expect(labelPage.getByText('40*30mm', { exact: true })).toBeVisible()
    await expect(labelPage.getByText('标准资产标签', { exact: true })).toBeVisible()
    await expect(labelPage.getByText('默认资产标签', { exact: true })).toHaveCount(0)
    await expect(labelPage.getByText('配置1', { exact: false })).toBeVisible()
    for (const section of ['标签logo设置', '标签尺寸', '位置调整', '字段', '打印排列']) {
      await expect(labelPage.getByText(section, { exact: true })).toBeVisible()
    }
    await expect(labelPage.getByRole('heading', { name: /扫码展示字段/ })).toBeVisible()
    await expect(labelPage.getByRole('button', { name: /上传 Logo/ })).toBeVisible()
    await expect(labelPage.getByRole('slider', { name: 'logo缩放（%）' })).toHaveValue('80')
    await expect(labelPage.getByRole('slider', { name: '内容缩放（%）' })).toHaveValue('80')
    const generatedQrPath = await labelPage.locator('.first-label-preview-qr .asset-label-qr path').getAttribute('d')
    expect(generatedQrPath?.length).toBeGreaterThan(1_000)
    const rightPanel = labelPage.locator('.asset-label-template-right')
    const rightPanelDimensions = await rightPanel.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }))
    expect(rightPanelDimensions.scrollHeight).toBeGreaterThan(rightPanelDimensions.clientHeight)
    await rightPanel.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => rightPanel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await expect(labelPage.getByRole('button', { name: '保 存', exact: true })).toBeVisible()
    await expect(labelPage.locator('.asset-label-template-field-row')).toHaveCount(3)
    await expect(labelPage.getByRole('checkbox', { name: '隐藏字段名' })).toHaveCount(3)
    await labelPage.locator('.asset-label-template-field-row').first().getByRole('button', { name: '＋', exact: true }).click()
    await expect(labelPage.getByRole('spinbutton', { name: '第1行字号' })).toHaveValue('13')
    await labelPage.getByRole('button', { name: '保 存', exact: true }).click()
    const labelRequest = [...state.requests].reverse().find((item) => item.method === 'POST' && item.path === '/api/store')
    expect(labelRequest?.body).toMatchObject({ entries: { assetLabelPrintSettingsV2: { templateKey: 'standard', fieldFontSizes: [13, 12, 12] } }, operation: 'save' })

    await labelPage.getByRole('button', { name: '选择小型二维码标签', exact: true }).click()
    await expect(labelPage.locator('.asset-label-template-field-row')).toHaveCount(4)
    await labelPage.getByRole('button', { name: '选择大号信息标签', exact: true }).click()
    await expect(labelPage.locator('.asset-label-template-field-row')).toHaveCount(2)
    await expect(page.locator('.asset-subnav-parent')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.asset-subnav-child.active')).toHaveText('标签模板设置')
    await expectNoPageOverflow(page)
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
    await expect(page.getByRole('button', { name: '高级搜索', exact: true })).toHaveCount(0)
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
    await expect(dialog.locator('.business-form .field')).toHaveCount(5)
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
